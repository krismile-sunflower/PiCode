import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../lib/types';
import { controller } from '../app/controller';
import { Icon } from './Icon';

const STORAGE_KEY = 'picode:onboarded';

const PERMISSION_CHOICES = [
  ['ask', '请求确认', '读取自动放行；写文件或执行命令前询问。推荐。'],
  ['read-only', '只读', '只允许读取、搜索、列目录。'],
  ['full-access', '完全访问', '不再询问，直接执行。仅用于可信任务。'],
] as const;

const MODE_NOTES = [
  ['直接改工作区', '最快，适合小改动和你会立刻审阅的任务。'],
  ['独立副本（worktree）', '改动留在隔离检出里，可以同时跑多个任务，审阅后再合并。'],
  ['只读调研', '以计划模式开始，只看不改，适合先摸清情况。'],
] as const;

/**
 * First-run walkthrough.
 *
 * The three decisions that actually shape how PiCode behaves — which model,
 * how much authority it has, and whether it edits your tree — were each buried
 * in a different corner of Settings. A new user could not have known any of
 * them existed, let alone that they were choices.
 */
export function Onboarding({ snapshot }: { snapshot: AppSnapshot }) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!done) void controller.loadModels({ tryRefresh: false });
  }, [done]);

  if (done) return null;

  const finish = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // A blocked storage just means the guide appears again next launch.
    }
    setDone(true);
  };

  const models = snapshot.models.slice(0, 24);
  const mode = snapshot.settings?.permissionMode || 'ask';

  return (
    <div className="fixed inset-0 z-[620] flex items-center justify-center bg-[rgba(4,6,10,0.58)] p-6 backdrop-blur-[4px]" role="presentation">
      <div className="max-h-[82vh] w-[min(600px,100%)] overflow-auto rounded-lg border border-line-hover bg-panel p-[22px] shadow-lg" role="dialog" aria-modal="true" aria-label="PiCode 快速设置">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <span className="eyebrow">开始使用 PiCode</span>
            <strong className="block text-sm text-primary">三个决定，之后随时可改</strong>
          </div>
          <button className="icon-btn" type="button" aria-label="跳过引导" onClick={finish}>×</button>
        </div>

        <ol className="onboarding-steps mb-4 flex list-none gap-3 p-0" aria-label="步骤">
          {['选模型', '选权限', '选工作方式'].map((label, index) => (
            <li className={`${index === step ? 'active' : index < step ? 'done' : ''} flex items-center gap-1.5 text-[11px] text-dim`} key={label}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-line-bright text-[9px]">{index + 1}</span>{label}
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <div className="mb-4 flex flex-col gap-3">
            <p className="hint">PiCode 不锁定供应商：任何 OpenAI 兼容、Anthropic、Google 接口都能用，还能按任务类型分别路由。</p>
            {models.length ? (
              <div className="grid max-h-[210px] grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-1.5 overflow-auto">
                {models.map((model) => (
                  <button
                    className={`flex flex-col items-start rounded-lg border border-line bg-glass px-2.5 py-1.5 text-left text-[11px] text-primary${model.id === snapshot.currentModelId ? ' onboarding-model active' : ' onboarding-model'}`}
                    type="button"
                    key={`${model.provider || ''}:${model.id}`}
                    onClick={() => void controller.setModel(model)}
                  >
                    <span>{model.id}</span>
                    {model.provider ? <small className="text-[9px] text-dim">{model.provider}</small> : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-secondary">
                还没有可用模型。<button className="border-0 bg-transparent text-accent-text underline" type="button" onClick={() => { finish(); controller.setView('settings'); }}>去配置供应商</button>
              </div>
            )}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mb-4 flex flex-col gap-3">
            <p className="hint">这决定 Pi 能替你做多少事。“本会话允许”只覆盖当前会话内的同一类操作，换会话即失效。</p>
            <div className="permission-mode-grid" role="radiogroup" aria-label="权限模式">
              {PERMISSION_CHOICES.map(([value, title, description]) => (
                <button
                  className={`permission-mode-card${mode === value ? ' active' : ''}${value === 'full-access' ? ' caution' : ''}`}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  key={value}
                  onClick={() => void controller.setPermissionMode(value)}
                >
                  <span className="permission-mode-title">{title}</span>
                  <span className="permission-mode-description">{description}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mb-4 flex flex-col gap-3">
            <p className="hint">新建会话时（会话栏「+」旁的菜单）可以三选一：</p>
            <div className="flex flex-col gap-2">
              {MODE_NOTES.map(([title, description]) => (
                <div className="flex items-start gap-2 text-[11px] text-secondary" key={title}>
                  <Icon name="check" width={13} height={13} />
                  <div><strong className="block text-xs text-primary">{title}</strong><span>{description}</span></div>
                </div>
              ))}
            </div>
            <p className="hint">改完之后按 <kbd>⌘⇧G</kbd> 打开变更审阅：逐段暂存或撤销，逐行留意见再交回给 Pi。</p>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button className="settings-action-btn" type="button" onClick={finish}>跳过</button>
          {step > 0 ? <button className="settings-action-btn" type="button" onClick={() => setStep(step - 1)}>上一步</button> : null}
          {step < 2
            ? <button className="settings-action-btn primary" type="button" onClick={() => setStep(step + 1)}>下一步</button>
            : <button className="settings-action-btn primary" type="button" onClick={finish}>开始使用</button>}
        </div>
      </div>
    </div>
  );
}
