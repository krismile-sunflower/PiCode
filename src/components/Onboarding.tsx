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
    <div className="onboarding-overlay" role="presentation">
      <div className="onboarding-card" role="dialog" aria-modal="true" aria-label="PiCode 快速设置">
        <div className="onboarding-head">
          <div>
            <span className="eyebrow">开始使用 PiCode</span>
            <strong>三个决定，之后随时可改</strong>
          </div>
          <button className="icon-btn" type="button" aria-label="跳过引导" onClick={finish}>×</button>
        </div>

        <ol className="onboarding-steps" aria-label="步骤">
          {['选模型', '选权限', '选工作方式'].map((label, index) => (
            <li className={index === step ? 'active' : index < step ? 'done' : ''} key={label}>
              <span>{index + 1}</span>{label}
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <div className="onboarding-body">
            <p className="hint">PiCode 不锁定供应商：任何 OpenAI 兼容、Anthropic、Google 接口都能用，还能按任务类型分别路由。</p>
            {models.length ? (
              <div className="onboarding-models">
                {models.map((model) => (
                  <button
                    className={`onboarding-model${model.id === snapshot.currentModelId ? ' active' : ''}`}
                    type="button"
                    key={`${model.provider || ''}:${model.id}`}
                    onClick={() => void controller.setModel(model)}
                  >
                    <span>{model.id}</span>
                    {model.provider ? <small>{model.provider}</small> : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="onboarding-empty">
                还没有可用模型。<button type="button" onClick={() => { finish(); controller.setView('settings'); }}>去配置供应商</button>
              </div>
            )}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="onboarding-body">
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
          <div className="onboarding-body">
            <p className="hint">新建会话时（会话栏「+」旁的菜单）可以三选一：</p>
            <div className="onboarding-modes">
              {MODE_NOTES.map(([title, description]) => (
                <div className="onboarding-mode" key={title}>
                  <Icon name="check" width={13} height={13} />
                  <div><strong>{title}</strong><span>{description}</span></div>
                </div>
              ))}
            </div>
            <p className="hint">改完之后按 <kbd>⌘⇧G</kbd> 打开变更审阅：逐段暂存或撤销，逐行留意见再交回给 Pi。</p>
          </div>
        ) : null}

        <div className="onboarding-actions">
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
