import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSnapshot,
  Automation,
  GitChange,
  GitChangeArea,
  GitReviewScope,
  ModelRole,
  ModelsConfig,
  ModelsProviderConfig,
  ModelsProviderModel,
  PiExtensionInfo,
  PiPackageInfo,
  PiPromptTemplate,
  ProjectInfo,
  ThemeId,
} from '../lib/types';
import { basename, formatRelativeTime } from '../lib/utils';
import { applyTheme, getCurrentTheme, themes } from '../lib/theme';
import { invoke } from '@tauri-apps/api/core';
import { controller } from '../app/controller';
import { notify } from '../app/controller-contracts';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  LayoutGrid,
  Plus,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { confirmDialog } from './ConfirmDialog';
import { DiffView } from './DiffView';
import { DEFAULT_OPTIMIZE_INSTRUCTION, readOptimizeTemplatePref } from '../lib/prompt-optimizer';
import { DEFAULT_REASONING_PROFILE, migrateReasoningConfig, PI_REASONING_LEVELS, REASONING_UI_LABELS } from '../lib/reasoning';
import { Select } from './Select';
import { THINKING_LEVELS, thinkingLevelLabel } from '../lib/thinking';

const API_OPTIONS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const;

function emptyProvider(): ModelsProviderConfig {
  return {
    baseUrl: '',
    api: 'openai-completions',
    apiKey: '',
    models: [],
    // This is an explicit preset attached to a newly-created OpenAI-compatible
    // provider; no model receives it until the user selects it on that model.
    reasoningProfiles: {
      'openai-gpt': structuredClone(DEFAULT_REASONING_PROFILE),
    },
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}

function cloneConfig(config: ModelsConfig | null | undefined): ModelsConfig {
  return migrateReasoningConfig(JSON.parse(JSON.stringify(config || { providers: {} })) as ModelsConfig);
}

function configSignature(config: ModelsConfig | null | undefined): string {
  try {
    return JSON.stringify(config || { providers: {} });
  } catch {
    return '';
  }
}

function maskApiKey(value?: string): string {
  if (!value) return '未配置';
  if (value.startsWith('!') || value.startsWith('$')) return value;
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

function knownModelSetting(value?: string): string {
  const normalized = String(value || '').trim();
  return normalized && !['unknown', 'undefined', 'null'].includes(normalized.toLowerCase()) ? normalized : '';
}

const normalizeProjectPath = (value: string): string => value.replace(/[\\/]+$/, '').toLowerCase();

/** 当前窗口（accent）与仅运行中（success）共用一枚状态徽章，词汇与侧栏一致。 */
function LiveBadge({ state }: { state: 'current' | 'running' }) {
  return (
    <span className={`inline-flex flex-none items-center gap-1 text-[9px] [font-weight:650] before:inline-block before:h-[5px] before:w-[5px] before:rounded-full before:bg-current before:content-[''] ${state === 'current' ? 'text-accent-text' : 'text-success'}`}>
      {state === 'current' ? '当前窗口' : '运行中'}
    </span>
  );
}

export function ProjectsView({ snapshot }: { snapshot: AppSnapshot }) {
  const [query, setQuery] = useState('');
  const runningPaths = useMemo(
    () => new Set(
      snapshot.liveInstances
        .map((instance) => normalizeProjectPath(instance.projectPath || instance.project_path || ''))
        .filter(Boolean),
    ),
    [snapshot.liveInstances],
  );
  const projects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...snapshot.projects]
      .sort((left, right) => {
        if (left.active !== right.active) return left.active ? -1 : 1;
        return Number(right.lastActive || 0) - Number(left.lastActive || 0);
      })
      .filter((project) => !normalized || `${project.name || ''} ${project.path}`.toLowerCase().includes(normalized));
  }, [query, snapshot.projects]);

  const openProject = (project: ProjectInfo) => {
    if (project.active) controller.returnToChat();
    else void controller.launchProject(project.path);
  };

  return (
    <section className="absolute inset-x-0 top-(--header-height) bottom-0 z-20 overflow-auto bg-canvas pt-[26px] pb-12 px-[clamp(16px,3vw,36px)] max-compact:pt-[30px] max-compact:pb-[50px] max-compact:px-[14px]" aria-label="项目">
      <div className="mx-auto w-full max-w-[1120px]">
        <div className="pane-header">
          <div className="pane-header-copy">
            <span className="eyebrow">工作区</span>
            <h2>项目与对话</h2>
            <p className="pane-header-subtitle">项目绑定一个仓库，Pi 可以改代码；对话不绑定仓库，以只读方式开始。</p>
          </div>
          <div className="pane-header-actions">
            <button
              className="inline-flex h-8 flex-1 items-center rounded-lg border border-line bg-glass px-3 text-[12px] font-semibold text-secondary transition-colors duration-[var(--duration-fast)] hover:border-line-hover hover:bg-elevated hover:text-primary"
              type="button"
              onClick={() => snapshot.noFolderActive ? controller.returnToChat() : void controller.launchChat()}
            >新建对话</button>
            <button
              className="inline-flex h-8 flex-1 items-center rounded-lg border border-accent-strong bg-accent-strong px-3 text-[12px] font-semibold text-white transition-colors duration-[var(--duration-fast)] hover:border-accent-hover hover:bg-accent-hover hover:text-white"
              type="button"
              onClick={() => void controller.addProject()}
            >添加项目</button>
            {snapshot.hasActivePiSession ? <button className="pane-close" type="button" title="返回聊天" aria-label="返回聊天" onClick={() => controller.returnToChat()}><X size={16} /></button> : null}
          </div>
        </div>
        {snapshot.projectError ? <div className="mb-3.5 rounded-[10px] border border-[color-mix(in_srgb,var(--error)_35%,var(--border))] bg-[color-mix(in_srgb,var(--error)_7%,transparent)] px-2.5 py-[9px] text-[11px] text-error">{snapshot.projectError}</div> : null}
        <label className="mb-3.5 flex h-9 items-center gap-2 rounded-[9px] border border-line bg-panel px-[11px] text-dim focus-within:border-accent focus-within:shadow-[0_0_0_2px_var(--accent-subtle)]">
          <Search size={15} />
          <input type="search" placeholder="搜索项目名称或路径" value={query} onChange={(event) => setQuery(event.target.value)} className="h-full w-full min-w-0 border-0 bg-transparent text-[12.5px] text-primary outline-none" />
        </label>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2.5 max-compact:grid-cols-1">
          {!query || '对话 chat 无文件夹 no folder'.includes(query.toLowerCase()) ? (
            <article className={`group grid cursor-pointer grid-cols-[36px_minmax(0,1fr)] items-start gap-x-[11px] gap-y-1.5 rounded-[11px] border border-transparent bg-panel p-3.5 text-primary shadow-sm transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] hover:border-line-hover hover:bg-elevated hover:shadow-md${snapshot.noFolderActive ? ' border-[color-mix(in_srgb,var(--accent)_38%,transparent)]' : ''}`}>
              <div className="grid h-9 w-9 place-items-center rounded-[9px] bg-muted text-secondary">
                <Eye size={20} />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-[7px] overflow-hidden text-[13px] text-primary [font-weight:680] tracking-[-0.015em] text-ellipsis whitespace-nowrap">对话 {snapshot.noFolderActive ? <LiveBadge state="current" /> : null}</div>
                {/* Projects and chats are a deliberate split: a project is bound
                    to a repository and may change it; a chat is bound to
                    nothing and starts read-only. */}
                <div className="mt-[3px] overflow-hidden font-mono text-[10px] leading-[1.4] text-dim text-ellipsis whitespace-nowrap">不绑定仓库，以只读的计划模式开始</div>
                <div className="mt-1.5 flex gap-2.5 text-[10px] text-ghost"><span>适合提问、调研和临时任务</span></div>
              </div>
              <div className="col-span-2 mt-0.5 flex items-center justify-end gap-[5px]">
                <button className="inline-flex h-7 items-center justify-center rounded-[7px] border border-transparent bg-accent-subtle px-[11px] text-[11px] font-semibold text-accent-text transition-colors duration-[var(--duration-fast)] group-hover:bg-accent-strong group-hover:text-white disabled:opacity-50" type="button" disabled={Boolean(snapshot.projectBusyPath)} onClick={() => snapshot.noFolderActive ? controller.returnToChat() : void controller.launchChat()}>
                  {snapshot.projectBusyPath === '__no_folder__' ? '正在启动…' : snapshot.noFolderActive ? '返回会话' : '开始对话'}
                </button>
              </div>
            </article>
          ) : null}
          {projects.map((project) => {
            const isCurrent = project.active;
            const isRunning = runningPaths.has(normalizeProjectPath(project.path));
            return (
            <article className={`group grid cursor-pointer grid-cols-[36px_minmax(0,1fr)] items-start gap-x-[11px] gap-y-1.5 rounded-[11px] border border-transparent bg-panel p-3.5 text-primary shadow-sm transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] hover:border-line-hover hover:bg-elevated hover:shadow-md${isCurrent ? ' border-[color-mix(in_srgb,var(--accent)_38%,transparent)]' : isRunning ? ' border-[color-mix(in_srgb,var(--success)_38%,transparent)]' : ''}`} key={project.path} onClick={() => openProject(project)}>
              <div className="grid h-9 w-9 place-items-center rounded-[9px] bg-accent-subtle text-accent-text">
                <Folder size={20} />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-[7px] overflow-hidden text-[13px] text-primary [font-weight:680] tracking-[-0.015em] text-ellipsis whitespace-nowrap">{project.name || basename(project.path) || '未命名项目'} {isCurrent ? <LiveBadge state="current" /> : isRunning ? <LiveBadge state="running" /> : null}</div>
                <div className="mt-[3px] overflow-hidden font-mono text-[10px] leading-[1.4] text-dim text-ellipsis whitespace-nowrap" title={project.path}>{project.path}</div>
                <div className="mt-1.5 flex gap-2.5 text-[10px] text-ghost"><span>{Number(project.sessionCount || 0)} 个会话</span><span>{formatRelativeTime(project.lastActive) || '尚未使用'}</span></div>
              </div>
              <div className="col-span-2 mt-0.5 flex items-center justify-end gap-[5px]">
                <button className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] border border-line bg-glass p-0 text-secondary transition-colors duration-[var(--duration-fast)] group-hover:border-line-hover group-hover:text-primary disabled:opacity-50" type="button" title="在新窗口打开" disabled={Boolean(snapshot.projectBusyPath)} onClick={(event) => { event.stopPropagation(); void controller.openProjectWindow(project.path); }}><ExternalLink size={13} /></button>
                <button className="inline-flex h-7 items-center justify-center rounded-[7px] border border-transparent bg-accent-subtle px-[11px] text-[11px] font-semibold text-accent-text transition-colors duration-[var(--duration-fast)] group-hover:bg-accent-strong group-hover:text-white disabled:opacity-50" type="button" disabled={Boolean(snapshot.projectBusyPath)} onClick={(event) => { event.stopPropagation(); openProject(project); }}>
                  {snapshot.projectBusyPath === project.path ? '正在启动…' : project.active ? '返回会话' : '打开'}
                </button>
              </div>
            </article>
            );
          })}
          {!snapshot.projectsLoading && projects.length === 0 && query ? <div className="mx-auto mt-20 max-w-[520px] rounded-2xl border border-dashed border-line-hover bg-panel p-10"><strong className="text-primary">没有匹配的项目</strong><p className="hint mt-2 text-[11px] text-dim">尝试搜索其他名称或路径。</p></div> : null}
          {snapshot.projectsLoading ? <div className="grid min-h-[50vh] place-items-center text-[13px] text-dim">正在加载项目…</div> : null}
        </div>
      </div>
    </section>
  );
}

function gitChangeLabel(indexStatus: string, worktreeStatus: string): string {
  const status = `${indexStatus}${worktreeStatus}`;
  if (status.includes('A') || status === '??') return '新增';
  if (status.includes('D')) return '删除';
  if (status.includes('R')) return '重命名';
  return '修改';
}

function isStagedGitChange(change: GitChange): boolean {
  return change.indexStatus !== ' ' && change.indexStatus !== '?';
}

function isUnstagedGitChange(change: GitChange): boolean {
  return (change.indexStatus === '?' && change.worktreeStatus === '?') || change.worktreeStatus !== ' ';
}

function gitChangePaths(change: GitChange): string[] {
  return change.originalPath ? [change.originalPath, change.path] : [change.path];
}

function gitAreaChangeLabel(change: GitChange, area: GitChangeArea): string {
  if (area === 'unstaged' && change.indexStatus === '?' && change.worktreeStatus === '?') return '新增';
  return area === 'staged'
    ? gitChangeLabel(change.indexStatus, ' ')
    : gitChangeLabel(' ', change.worktreeStatus);
}

const SCOPES: Array<[GitReviewScope, string, string]> = [
  ['unstaged', '未暂存', '工作区里尚未暂存的改动'],
  ['staged', '已暂存', '暂存区中等待提交的改动'],
  ['head', '未提交', '相对上一次提交的全部改动'],
  ['base', '与基线分支比', '相对所选分支的全部改动'],
  ['turn', '本轮改动', '相对本轮任务开始时的快照'],
];

function reviewScopeLabel(scope: GitReviewScope, area: GitChangeArea | null, baseRef: string): string {
  if (scope === 'head') return '相对 HEAD';
  if (scope === 'base') return `相对 ${baseRef || '基线分支'}`;
  if (scope === 'turn') return '本轮改动';
  return area === 'staged' ? '暂存区' : '工作区';
}

export function ChangesView({ snapshot }: { snapshot: AppSnapshot }) {
  const git = snapshot.gitStatus;
  const selected = snapshot.selectedGitPath;
  const selectedArea = snapshot.selectedGitArea;
  const changeCount = git?.changes.length || 0;
  const stagedChanges = (git?.changes || []).filter(isStagedGitChange);
  const unstagedChanges = (git?.changes || []).filter(isUnstagedGitChange);
  const [commitMessage, setCommitMessage] = useState('');
  const [gitAction, setGitAction] = useState<'pull' | 'commit' | 'push' | 'stage' | 'unstage' | null>(null);
  const busy = snapshot.gitLoading || Boolean(gitAction);
  // Staging a hunk means applying it to the index; reverting means undoing it
  // in the worktree. Both are only meaningful on an index-relative diff, so the
  // range scopes (base branch / this turn) offer review notes only.
  const rangeScope = snapshot.gitReviewScope === 'base' || snapshot.gitReviewScope === 'turn';
  const hunkActions = rangeScope ? [] : [
    ...(selectedArea === 'staged'
      ? [{
          label: '取消暂存',
          title: '把这一段从暂存区移除',
          run: (patch: string) => void controller.applyGitPatch(patch, { cached: true, reverse: true }),
        }]
      : [{
          label: '暂存',
          title: '只暂存这一段',
          run: (patch: string) => void controller.applyGitPatch(patch, { cached: true }),
        }, {
          label: '撤销',
          title: '丢弃这一段改动（不可恢复）',
          run: (patch: string) => void controller.applyGitPatch(patch, { reverse: true }),
        }]),
  ];
  const runGitAction = async (action: 'pull' | 'commit' | 'push' | 'stage' | 'unstage', operation: () => Promise<boolean>) => {
    setGitAction(action);
    try {
      const completed = await operation();
      if (completed && action === 'commit') setCommitMessage('');
    } finally {
      setGitAction(null);
    }
  };
  const renderChange = (change: GitChange, area: GitChangeArea) => {
    const label = gitAreaChangeLabel(change, area);
    const active = selected === change.path && selectedArea === area;
    const actionLabel = area === 'staged' ? `取消暂存 ${change.path}` : `暂存 ${change.path}`;
    return (
      <div className={`group flex items-center border-b border-b-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-transparent hover:bg-glass-hover${active ? ' bg-glass-hover' : ''}`} key={`${area}:${change.path}`}>
        <button className="flex min-w-0 flex-1 items-start gap-2.5 border-0 bg-transparent py-[11px] pl-[13px] pr-2 text-left text-secondary cursor-pointer group-hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent" type="button" onClick={() => void controller.selectGitChange(change.path, area)}>
          <span className={`min-w-[30px] flex-none pt-px text-[10px] font-bold ${label === '新增' ? 'text-success' : label === '删除' ? 'text-error' : label === '重命名' ? 'text-accent' : 'text-warning'}`}>{label}</span>
          <span className="flex min-w-0 flex-col gap-[3px]"><strong className="overflow-hidden font-mono text-[11px] leading-[1.35] text-ellipsis whitespace-nowrap">{change.path}</strong>{change.originalPath ? <small className="overflow-hidden text-[10px] text-dim text-ellipsis whitespace-nowrap">{change.originalPath}<ArrowRight size={10} className="mx-1 inline-block align-[-1px]" aria-hidden="true" />{change.path}</small> : null}</span>
        </button>
        <button className="mr-2 grid h-7 w-7 flex-none place-items-center rounded-md border border-transparent bg-transparent p-0 text-dim opacity-70 cursor-pointer enabled:hover:border-line-hover enabled:hover:bg-elevated enabled:hover:text-accent-text enabled:hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30" type="button" aria-label={actionLabel} title={actionLabel} disabled={busy} onClick={() => void runGitAction(area === 'staged' ? 'unstage' : 'stage', () => area === 'staged' ? controller.unstageGit(gitChangePaths(change)) : controller.stageGit(gitChangePaths(change)))}>
          {area === 'staged' ? <X size={13} /> : <Plus size={13} />}
        </button>
      </div>
    );
  };
  return (
    <section className="absolute inset-x-0 top-(--header-height) bottom-0 z-20 overflow-auto bg-canvas pt-[26px] pb-12 px-[clamp(16px,3vw,36px)] max-compact:pt-[30px] max-compact:pb-[50px] max-compact:px-[14px]">
      <div className="pane-header gap-[18px]">
        <div className="pane-header-copy">
          <span className="eyebrow">工作区</span>
          <h2>变更审阅</h2>
          <p className="pane-header-subtitle">按范围审阅改动，可逐段暂存/撤销，也可逐行留下意见后交给 Pi 修改。</p>
        </div>
        <div className="pane-header-actions">
          <div className="review-scope inline-flex overflow-hidden rounded-[8px] border border-line" role="group" aria-label="查看范围">
            {SCOPES.map(([scope, label, hint]) => (
              <button
                className={`border-0 border-r border-r-line bg-transparent px-2.5 py-[5px] text-[11px] text-dim last:border-r-0 enabled:hover:bg-glass-hover enabled:hover:text-primary disabled:opacity-40${snapshot.gitReviewScope === scope ? ' bg-accent-subtle text-accent-text' : ''}`}
                type="button"
                key={scope}
                title={hint}
                disabled={scope === 'turn' && !snapshot.gitTurnBaseline}
                onClick={() => void controller.setGitReviewScope(scope)}
              >
                {label}
              </button>
            ))}
          </div>
          {snapshot.gitReviewScope === 'base' ? (
            <Select
              variant="compact"
              className="w-[160px]"
              ariaLabel="比较基线分支"
              value={snapshot.gitBaseRef}
              options={(snapshot.gitBranches.length ? snapshot.gitBranches : [snapshot.gitBaseRef].filter(Boolean)).map((branch) => ({ value: branch, label: branch }))}
              onChange={(branch) => void controller.setGitReviewScope('base', branch)}
            />
          ) : null}
          <button className="settings-action-btn" type="button" onClick={() => void controller.loadGitStatus()} disabled={busy}>
            {snapshot.gitLoading ? '刷新中…' : '刷新'}
          </button>
          <button className="pane-close" type="button" aria-label="关闭变更中心" title="关闭变更中心" onClick={() => controller.returnToChat()}><X size={16} /></button>
        </div>
      </div>

      {snapshot.gitError ? <div className="mx-[clamp(20px,4vw,56px)] mt-6 rounded-[10px] border border-[color-mix(in_srgb,var(--error)_38%,var(--border))] bg-muted px-[15px] py-[13px] text-[12px] text-error">{snapshot.gitError}</div> : null}
      {!snapshot.gitLoading && !snapshot.gitError && git && !git.isRepository ? <div className="mx-[clamp(20px,4vw,56px)] mt-6 rounded-[10px] border border-line bg-muted px-[15px] py-[13px] text-[12px] text-secondary">当前文件夹不是 Git 仓库。</div> : null}
      {git?.isRepository ? (
        <>
          <div className="mt-6 grid gap-2.5 rounded-xl border border-line bg-panel p-[13px] shadow-sm">
            <div className="flex min-w-0 items-center justify-between gap-3 max-compact:flex-col max-compact:items-stretch">
              <div className="flex min-w-0 flex-col gap-[3px]">
                <strong className="overflow-hidden font-mono text-[12px] leading-[1.3] font-semibold text-primary text-ellipsis whitespace-nowrap">{git.branch || 'HEAD'}</strong>
                <span className="overflow-hidden font-mono text-[10px] leading-[1.3] text-dim text-ellipsis whitespace-nowrap">{git.upstream ? (<>{git.upstream} · <ArrowUp size={11} className="inline-block align-[-1px]" /> {git.ahead} · <ArrowDown size={11} className="inline-block align-[-1px]" /> {git.behind}</>) : '尚未设置上游分支'}</span>
              </div>
              <div className="flex flex-none gap-[7px] max-compact:w-full max-compact:[&>button]:flex-1">
                <button type="button" className="min-h-8 rounded-[7px] border border-line-hover bg-elevated px-3 text-[11px] font-semibold text-secondary cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45" disabled={busy || !git.upstream} title={git.upstream ? '仅快进拉取上游分支' : '需要先设置上游分支'} onClick={() => void runGitAction('pull', () => controller.pullGit())}>{gitAction === 'pull' ? '拉取中…' : '拉取'}</button>
                <button type="button" className="min-h-8 rounded-[7px] border border-line-hover bg-elevated px-3 text-[11px] font-semibold text-secondary cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45" disabled={busy} onClick={() => void runGitAction('push', () => controller.pushGit())}>{gitAction === 'push' ? '推送中…' : '推送'}</button>
              </div>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3 border-t border-t-line pt-2.5 max-compact:flex-col max-compact:items-stretch">
              <span className="text-[10px] text-dim">{stagedChanges.length} 个已暂存 · {unstagedChanges.length} 个未暂存</span>
              <div className="flex gap-[7px] max-compact:w-full max-compact:[&>button]:flex-1">
                <button type="button" className="min-h-[29px] rounded-[7px] border border-line bg-transparent px-2.5 text-[10px] text-secondary cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-[0.42]" disabled={busy || !unstagedChanges.length} onClick={() => void runGitAction('stage', () => controller.stageAllGit())}>全部暂存</button>
                <button type="button" className="min-h-[29px] rounded-[7px] border border-line bg-transparent px-2.5 text-[10px] text-secondary cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-[0.42]" disabled={busy || !stagedChanges.length} onClick={() => void runGitAction('unstage', () => controller.unstageAllGit())}>取消全部暂存</button>
              </div>
            </div>
            <form className="flex min-w-0 items-center justify-between gap-3 max-compact:flex-col max-compact:items-stretch" onSubmit={(event) => {
              event.preventDefault();
              if (!commitMessage.trim() || !stagedChanges.length || busy) return;
              void runGitAction('commit', () => controller.commitGit(commitMessage));
            }}>
              <input className="min-h-[34px] min-w-0 flex-1 rounded-[7px] border border-line bg-muted px-2.5 text-[11px] text-primary outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-subtle)]" value={commitMessage} maxLength={500} disabled={busy || !stagedChanges.length} onChange={(event) => setCommitMessage(event.target.value)} placeholder={stagedChanges.length ? '输入提交说明' : '请先暂存需要提交的改动'} aria-label="Git 提交说明" />
              <button type="submit" className="flex-none min-h-8 rounded-[7px] border border-[color-mix(in_srgb,var(--accent)_48%,var(--border))] bg-accent-subtle px-3 text-[11px] font-semibold text-accent-text cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 max-compact:flex-1" disabled={busy || !stagedChanges.length || !commitMessage.trim()}>{gitAction === 'commit' ? '提交中…' : `提交暂存 (${stagedChanges.length})`}</button>
            </form>
          </div>
          <div className="mt-6 grid min-h-[min(620px,calc(100vh_-_230px))] grid-cols-[minmax(230px,31%)_minmax(0,1fr)] overflow-hidden rounded-xl border border-line bg-muted max-compact:mt-3 max-compact:grid-cols-1">
            <aside className="min-w-0 max-h-[260px] overflow-auto border-b border-b-line bg-[var(--bg-base)] max-compact:max-h-[260px]">
              <div className="flex items-center justify-between gap-2 border-b border-b-line px-[13px] py-[13px] text-[11px] text-dim">
                <span className="overflow-hidden font-mono font-semibold text-primary text-ellipsis whitespace-nowrap">{git.branch || 'HEAD'}</span>
                <span>{changeCount ? `${changeCount} 个文件有改动` : '工作区干净'}</span>
              </div>
              <div className="flex min-h-8 items-center justify-between gap-2 border-b border-b-line bg-panel px-[13px] py-[7px] text-[10px] font-bold tracking-[0.035em] text-dim"><span>暂存的更改</span><strong className="font-mono text-[10px] leading-none text-secondary">{stagedChanges.length}</strong></div>
              {stagedChanges.length ? stagedChanges.map((change) => renderChange(change, 'staged')) : <div className="p-[13px] text-[10px] text-dim">还没有暂存的改动。</div>}
              <div className="flex min-h-8 items-center justify-between gap-2 border-b border-b-line bg-panel px-[13px] py-[7px] text-[10px] font-bold tracking-[0.035em] text-dim"><span>更改</span><strong className="font-mono text-[10px] leading-none text-secondary">{unstagedChanges.length}</strong></div>
              {unstagedChanges.length ? unstagedChanges.map((change) => renderChange(change, 'unstaged')) : <div className="p-[13px] text-[10px] text-dim">没有未暂存的改动。</div>}
            </aside>
            <article className="flex min-w-0 flex-col bg-muted">
              {!selected ? <div className="p-[22px] text-[12px] text-dim">选择左侧文件以查看 diff。</div> : null}
              {snapshot.gitDiffLoading ? <div className="p-[22px] text-[12px] text-dim">正在读取 diff…</div> : null}
              {selected && !snapshot.gitDiffLoading && snapshot.gitDiff ? (
                <>
                  <div className="flex justify-between gap-3 border-b border-b-line px-4 py-[13px] text-[11px] text-dim">
                    <strong className="overflow-hidden font-mono text-primary text-ellipsis whitespace-nowrap">{snapshot.gitDiff.path}</strong>
                    <span>{reviewScopeLabel(snapshot.gitReviewScope, selectedArea, snapshot.gitBaseRef)}</span>
                  </div>
                  {snapshot.gitDiff.diff ? (
                    <DiffView
                      diff={snapshot.gitDiff.diff}
                      className="m-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-[1.6] text-secondary whitespace-pre-wrap"
                      hunkActions={hunkActions}
                      onComment={(line, text) => controller.addReviewComment({
                        path: snapshot.gitDiff?.path || selected,
                        line: line.line,
                        side: line.side,
                        code: line.code,
                        text,
                      })}
                    />
                  ) : (
                    <div className="p-[22px] text-[12px] text-dim">新建的未跟踪文件或二进制文件没有可展示的文本 diff。</div>
                  )}
                </>
              ) : null}
              {snapshot.reviewComments.length ? (
                <div className="shrink-0 border-t border-line bg-panel px-3.5 py-2.5" aria-label="审阅意见">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-primary">
                    <strong>审阅意见 {snapshot.reviewComments.length}</strong>
                    <div className="flex gap-2">
                      <button className="settings-action-btn" type="button" onClick={() => controller.clearReviewComments()}>清空</button>
                      <button className="settings-action-btn primary" type="button" onClick={() => controller.sendReviewComments()}>交给 Pi 修改</button>
                    </div>
                  </div>
                  {snapshot.reviewComments.map((comment) => (
                    <div className="flex items-start gap-2 py-1 text-[11px] text-secondary" key={comment.id}>
                      <span className="shrink-0 font-mono text-[10px] text-dim">{comment.path}:{comment.line}</span>
                      <span className="min-w-0 flex-1">{comment.text}</span>
                      <button className="icon-btn" type="button" aria-label="删除这条意见" onClick={() => controller.removeReviewComment(comment.id)}><X size={12} /></button>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Toggle({ enabled, label, onChange, disabled = false }: { enabled: boolean; label: string; onChange(value: boolean): void; disabled?: boolean }) {
  return <button className={`settings-toggle${enabled ? ' on' : ''}`} type="button" aria-label={label} aria-pressed={enabled} disabled={disabled} onClick={() => onChange(!enabled)} />;
}

function runtimeSource(snapshot: AppSnapshot): string {
  const info = snapshot.runtimeInfo;
  if (!info) return '正在检查…';
  if (info.bundled) return '应用内置';
  return ({ system: '系统安装', override: '自定义路径', web: 'Web 模式', unknown: '未知' } as Record<string, string>)[info.source || 'unknown'] || info.source || '未知';
}

const SETTINGS_SECTIONS = [
  ['appearance', '外观', '主题与界面外观'],
  ['agent', '智能体', 'Pi 的思考与上下文行为'],
  ['instructions', '项目', 'AGENTS.md 与隔离副本'],
  ['permissions', '权限', '工具执行授权与项目信任'],
  ['models', '模型', 'API 供应商、模型与推理预设'],
  ['runtime', '运行时', 'Pi 运行时、桌面端与连接'],
] as const;

const MODEL_ROLES: Array<[ModelRole, string, string]> = [
  ['plan', '规划', '进入计划模式时使用'],
  ['build', '编码', '确认计划开始执行时使用'],
  ['search', '检索', '大范围代码检索/长上下文任务'],
];

/**
 * Model routing by task type.
 *
 * `models.json` already supports any provider; what was missing is the idea
 * that different jobs deserve different models. A single-vendor client cannot
 * offer this at all, which makes it one of the few things PiCode can do that
 * Codex structurally cannot.
 */
function ModelRoutingSection({ snapshot }: { snapshot: AppSnapshot }) {
  const routes = snapshot.settings?.modelRoutes || {};
  const options = snapshot.models;

  return (
    <div className="pane-section">
      <div className="pane-section-head">
        <div>
          <div className="pane-section-title">模型路由</div>
          <p className="pane-section-note">按任务类型指定模型：规划用推理强的，编码用改代码稳的，检索用上下文长的。切换在对应动作发生时自动生效。</p>
        </div>
      </div>
      {options.length ? MODEL_ROLES.map(([role, label, hint]) => {
        const current = routes[role];
        const value = current ? `${current.provider || ''}::${current.modelId}` : '';
        return (
          <div className="flex items-center justify-between gap-3 border-b border-b-line py-2 last:border-b-0" key={role}>
            <div className="flex min-w-0 flex-col">
              <strong className="text-xs text-primary">{label}</strong>
              <span className="overflow-hidden text-[10px] text-dim text-ellipsis whitespace-nowrap">{hint}</span>
            </div>
            <Select
              variant="compact"
              className="w-[200px]"
              ariaLabel={`${label}任务使用的模型`}
              value={value}
              options={[
                { value: '', label: '跟随当前模型' },
                ...options.map((model) => ({
                  value: `${model.provider || ''}::${model.id}`,
                  label: model.provider ? `${model.provider} · ${model.id}` : model.id,
                })),
              ]}
              onChange={(raw) => {
                if (!raw) return void controller.setModelRoute(role, null);
                const [provider = '', modelId = ''] = raw.split('::');
                void controller.setModelRoute(role, { provider, modelId });
              }}
            />
          </div>
        );
      }) : <div className="settings-help">还没有加载到可用模型，请先在下方配置供应商。</div>}
    </div>
  );
}

/**
 * Host-app updates.
 *
 * The signing key ships with the bundle (that is what makes an update
 * verifiable), while the release feed is a setting — a fork or a self-hosted
 * build can point somewhere else without recompiling.
 */
function AppUpdateSection({ snapshot }: { snapshot: AppSnapshot }) {
  const update = snapshot.appUpdate;
  const [endpoint, setEndpoint] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (window.tauDesktop.isTauri && !snapshot.appUpdate) void controller.checkAppUpdate(true);
  }, [snapshot.appUpdate]);

  useEffect(() => {
    if (!editing) setEndpoint(String(snapshot.settings?.updateEndpoint || update?.endpoint || ''));
  }, [editing, snapshot.settings?.updateEndpoint, update?.endpoint]);

  return (
    <div className="pane-section">
      <div className="pane-section-head">
        <div>
          <div className="pane-section-title">PiCode 应用更新</div>
          <p className="pane-section-note">安装包会用内置公钥校验签名后再执行；未通过校验的更新不会被安装。</p>
        </div>
        <div className="pane-section-actions">
          <button
            className="settings-action-btn"
            type="button"
            disabled={!window.tauDesktop.isTauri || snapshot.appUpdateChecking}
            onClick={() => void controller.checkAppUpdate()}
          >
            {snapshot.appUpdateChecking ? '检查中…' : '检查更新'}
          </button>
          <button
            className="settings-action-btn primary"
            type="button"
            disabled={!window.tauDesktop.isTauri || snapshot.appUpdateChecking || !update?.available}
            onClick={() => void confirmDialog({
              title: `安装 PiCode ${update?.newVersion}？`,
              message: 'Windows 会在安装后自动重启；macOS / Linux 需要手动重新打开。',
              confirmLabel: '下载并安装',
            }).then((ok) => { if (ok) void controller.installAppUpdate(); })}
          >
            安装更新
          </button>
        </div>
      </div>

      <div className="settings-kv-grid">
        <div className="settings-kv">
          <span className="settings-kv-label">当前版本</span>
          <span className="settings-kv-value">{update?.currentVersion || '未知'}</span>
        </div>
        <div className="settings-kv">
          <span className="settings-kv-label">可用版本</span>
          <span className={`settings-kv-value ${update?.available ? 'text-warning!' : update?.configured ? 'text-success!' : ''}`}>
            {update?.available ? `${update.newVersion} · 可更新` : update?.configured ? '已是最新' : '未配置更新通道'}
          </span>
        </div>
      </div>
      {update?.notes ? <div className="mt-0.5 overflow-hidden rounded-lg border border-line bg-muted px-2.5 py-[9px] font-mono text-[10px] leading-[1.5] text-dim text-ellipsis whitespace-nowrap">{update.notes}</div> : null}
      {update?.error ? <div className="mt-[9px] rounded-lg border border-[color-mix(in_srgb,var(--warning)_28%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_7%,transparent)] px-2.5 py-2 text-[11px] text-warning">{update.error}</div> : null}

      <div className="settings-endpoint-row">
        <input
          className="settings-text-input"
          value={endpoint}
          placeholder="发布源地址，例如 https://example.com/picode/{{target}}/{{arch}}/{{current_version}}"
          aria-label="应用更新发布源地址"
          onFocus={() => setEditing(true)}
          onChange={(event) => setEndpoint(event.target.value)}
        />
        <button
          className="settings-action-btn"
          type="button"
          disabled={!window.tauDesktop.isTauri}
          onClick={() => { setEditing(false); void controller.setUpdateEndpoint(endpoint); }}
        >
          保存
        </button>
      </div>
      <p className="settings-help">
        地址需返回 Tauri updater 的 JSON 清单。签名公钥在 tauri.conf.json 的 plugins.updater.pubkey 中配置，留空则无法安装更新。
      </p>
    </div>
  );
}

/**
 * Isolated-copy management.
 *
 * Worktrees are cheap to create and easy to forget; without a list the only
 * evidence they exist is a growing directory under `~/.pi/agent/worktrees`.
 */
function WorktreeSection({ snapshot }: { snapshot: AppSnapshot }) {
  const projectPath = snapshot.workspace.noFolder ? '' : snapshot.workspace.path;

  useEffect(() => {
    if (projectPath) void controller.loadWorktrees();
  }, [projectPath]);

  if (!projectPath) return null;

  return (
    <div className="pane-section">
      <div className="pane-section-head">
        <div>
          <div className="pane-section-title">隔离副本（worktree）</div>
          <p className="pane-section-note">每个副本是仓库的独立检出，用于并行任务；审阅后再把改动合并回主检出。</p>
        </div>
        <div className="pane-section-actions">
          <button className="settings-action-btn" type="button" onClick={() => void controller.loadWorktrees()}>刷新</button>
        </div>
      </div>
      {snapshot.worktrees.length ? snapshot.worktrees.map((worktree) => (
        <div className="flex items-center justify-between gap-3 border-b border-b-line py-2 last:border-b-0" key={worktree.path}>
          <div className="flex min-w-0 flex-col">
            <strong className="text-xs text-primary">{worktree.name}{worktree.hasChanges ? <span className="text-[10px] text-warning"> · 有未提交改动</span> : null}</strong>
            <span className="overflow-hidden text-[10px] text-dim text-ellipsis whitespace-nowrap" title={worktree.path}>{worktree.path}</span>
          </div>
          <div className="pane-section-actions">
            <button className="settings-action-btn" type="button" onClick={() => void controller.launchProject(worktree.path)}>打开</button>
            <button
              className="settings-action-btn danger"
              type="button"
              onClick={() => void confirmDialog({
                title: `移除隔离副本 ${worktree.name}？`,
                message: worktree.hasChanges
                  ? '该副本仍有未提交改动，移除会一并丢弃。'
                  : '副本目录会被删除，仓库主检出不受影响。',
                detail: worktree.path,
                confirmLabel: worktree.hasChanges ? '丢弃并移除' : '移除',
              }).then((ok) => { if (ok) void controller.removeWorktree(worktree.path, worktree.hasChanges); })}
            >
              移除
            </button>
          </div>
        </div>
      )) : <div className="settings-help">还没有隔离副本。在会话栏「+」旁的菜单里选择「独立副本」即可创建。</div>}
    </div>
  );
}

/**
 * Editor for the project's `AGENTS.md`.
 *
 * Prompt templates are a user-level convenience; `AGENTS.md` is a repository
 * artifact every agent working in this project reads. Treating them as the
 * same thing hid the project-level one entirely.
 */
function ProjectInstructionsSection({ snapshot }: { snapshot: AppSnapshot }) {
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState('');
  const [path, setPath] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [error, setError] = useState('');
  const projectPath = snapshot.workspace.noFolder ? '' : snapshot.workspace.path;

  useEffect(() => {
    if (!projectPath || !window.tauDesktop.isTauri) {
      setContent('');
      setLoaded('');
      setPath('');
      return;
    }
    let cancelled = false;
    setState('loading');
    void invoke<{ path: string; exists: boolean; content: string }>('read_project_instructions', { path: projectPath })
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
        setLoaded(result.content);
        setPath(result.path);
        setError('');
      })
      .catch((cause) => !cancelled && setError(String(cause)))
      .finally(() => !cancelled && setState('idle'));
    return () => { cancelled = true; };
  }, [projectPath]);

  const save = async () => {
    if (!projectPath) return;
    setState('saving');
    try {
      const result = await invoke<{ path: string; content: string }>('write_project_instructions', {
        request: { path: projectPath, content },
      });
      setLoaded(result.content);
      setPath(result.path);
      setError('');
      notify('已保存 AGENTS.md', result.path, 'success');
    } catch (cause) {
      setError(String(cause));
      notify('保存失败', String(cause), 'error');
    } finally {
      setState('idle');
    }
  };

  if (!projectPath) {
    return (
      <div className="pane-section">
        <div className="pane-section-head"><div><div className="pane-section-title">项目指令</div>
          <p className="pane-section-note">打开一个本地项目后，可以在这里维护随仓库走的 AGENTS.md。</p></div></div>
      </div>
    );
  }

  return (
    <div className="pane-section">
      <div className="pane-section-head">
        <div>
          <div className="pane-section-title">项目指令 · AGENTS.md</div>
          <p className="pane-section-note">写给在这个仓库工作的所有 Agent：约定、禁区、验证方式。保存后对新一轮任务生效。</p>
        </div>
        <div className="pane-section-actions">
          <button className="settings-action-btn primary" type="button" disabled={state !== 'idle' || content === loaded} onClick={() => void save()}>
            {state === 'saving' ? '保存中…' : content === loaded ? '已保存' : '保存'}
          </button>
        </div>
      </div>
      {path ? <div className="settings-meta-chip" title={path}><span className="flex-none text-[10px] font-bold tracking-[0.04em] text-dim uppercase">文件</span><span className="min-w-0 overflow-hidden font-mono text-[10px] leading-[1.4] text-secondary text-ellipsis whitespace-nowrap">{path}</span></div> : null}
      {error ? <div className="mt-[9px] rounded-lg border border-[color-mix(in_srgb,var(--warning)_28%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_7%,transparent)] px-2.5 py-2 text-[11px] text-warning">{error}</div> : null}
      <textarea
        className="mt-2 min-h-[260px] w-full resize-y rounded-[10px] border border-line bg-[var(--code-bg)] p-3 text-[12px] leading-[1.65] text-[var(--code-fg)] outline-0 [font-family:var(--app-font-mono)] [tab-size:2] focus:border-accent"
        value={content}
        spellCheck={false}
        disabled={state === 'loading'}
        placeholder={'# 项目约定\n\n- 运行测试：pnpm test\n- 不要修改 dist/\n'}
        onChange={(event) => setContent(event.target.value)}
      />
    </div>
  );
}

type SettingsSection = (typeof SETTINGS_SECTIONS)[number][0];

const SETTINGS_SECTION_KEY = 'pi-studio:settings-section';

function initialSettingsSection(): SettingsSection {
  const saved = localStorage.getItem(SETTINGS_SECTION_KEY);
  return SETTINGS_SECTIONS.some(([id]) => id === saved) ? (saved as SettingsSection) : 'appearance';
}

export function SettingsView({ snapshot }: { snapshot: AppSnapshot }) {
  const [theme, setTheme] = useState<ThemeId>(() => getCurrentTheme());
  const [section, setSection] = useState<SettingsSection>(initialSettingsSection);
  const info = snapshot.runtimeInfo;
  const canUpdate = Boolean(info?.canUpdateSystem || info?.canUpdateBundled);
  const current = SETTINGS_SECTIONS.find(([id]) => id === section) || SETTINGS_SECTIONS[0];

  const selectSection = (next: SettingsSection) => {
    setSection(next);
    localStorage.setItem(SETTINGS_SECTION_KEY, next);
  };

  return (
    <section className="absolute inset-x-0 top-(--header-height) bottom-0 z-20 overflow-auto bg-canvas pt-[26px] pb-12 px-[clamp(16px,3vw,36px)] max-compact:pt-[30px] max-compact:pb-[50px] max-compact:px-[14px]">
      <div className="pane-layout">
        <nav className="pane-nav" aria-label="设置分类">
          <div className="pane-nav-title">设置</div>
          {SETTINGS_SECTIONS.map(([id, label]) => (
            <button
              className={`pane-nav-item${section === id ? ' bg-accent-subtle! text-accent-text! [font-weight:680]! before:absolute! before:inset-y-[7px]! before:left-0! before:w-0.5! before:rounded-r-[2px]! before:bg-accent! before:content-[""] max-narrow:border-[color-mix(in_srgb,var(--accent)_38%,var(--border))]! max-narrow:before:hidden!' : ''}`}
              type="button"
              key={id}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => selectSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="pane-content">
          <div className="pane-header">
            <div className="pane-header-copy">
              <h2>{current[1]}</h2>
              <p className="pane-header-subtitle">{current[2]}</p>
            </div>
            <div className="pane-header-actions">
              <button className="pane-close" type="button" aria-label="关闭设置" title="关闭设置" onClick={() => controller.returnToChat()}>
                <X size={16} />
              </button>
            </div>
          </div>

          {section === 'appearance' ? (
            <div className="pane-section">
              <div className="pane-section-head">
                <div>
                  <div className="pane-section-title">主题</div>
                  <p className="pane-section-note">切换后立即生效，并同步桌面端窗口标题栏。</p>
                </div>
              </div>
              <div className="theme-grid">
                {(Object.entries(themes) as Array<[ThemeId, (typeof themes)[ThemeId]]>).map(([id, value]) => (
                <button className={`theme-swatch${theme === id ? ' border-accent! shadow-[0_0_0_3px_var(--accent-subtle)]' : ''}`}
                    data-label={value.name}
                    aria-label={`切换为${value.name}主题`}
                    aria-pressed={theme === id}
                    type="button"
                    key={id}
                    onClick={() => { setTheme(applyTheme(id)); }}
                  >
                    <span className="swatch-colors">
                      {value.colors.map((color) => <span className="swatch-dot" style={{ background: color }} key={color} />)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {section === 'agent' ? (
            <div className="pane-section">
              <div className="pane-section-head">
                <div>
                  <div className="pane-section-title">对话行为</div>
                  <p className="pane-section-note">这些设置立即应用到当前会话。</p>
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-label">自动压缩上下文</span>
                <Toggle enabled={snapshot.autoCompactionEnabled} label="自动压缩上下文" onChange={(enabled) => void controller.setAutoCompaction(enabled)} />
              </div>
              <div className="settings-row">
                <span className="settings-label">思考级别</span>
                <Select
                  variant="compact"
                  className="w-[110px] font-mono"
                  ariaLabel="思考级别"
                  value={snapshot.thinkingLevel}
                  options={THINKING_LEVELS.map((level) => ({ value: level, label: thinkingLevelLabel(level) }))}
                  onChange={(level) => void controller.setThinkingLevel(level)}
                />
              </div>
              <div className="settings-row">
                <span className="settings-label">显示思考过程</span>
                <Toggle enabled={snapshot.showThinking} label="显示思考过程" onChange={(enabled) => controller.setShowThinking(enabled)} />
              </div>
            </div>
          ) : null}

          {section === 'instructions' ? <ProjectInstructionsSection snapshot={snapshot} /> : null}
          {section === 'instructions' ? <WorktreeSection snapshot={snapshot} /> : null}

          {section === 'permissions' ? (
            <div className="pane-section">
              <div className="pane-section-head">
                <div>
                  <div className="pane-section-title">工具执行权限</div>
                  <p className="pane-section-note">控制 Pi 读取、修改文件和运行命令时的授权方式；变更会立即应用到当前会话。</p>
                </div>
              </div>
              <div className="permission-mode-grid" role="radiogroup" aria-label="Pi 工具执行权限">
                {([
                  ['ask', '请求确认', '读取和搜索自动允许；修改文件或执行命令前询问。'],
                  ['read-only', '只读', '仅允许读取、搜索和列出文件；阻止修改及命令执行。'],
                  ['full-access', '完全访问', '不显示确认，直接执行 Pi 的全部工具操作。'],
                ] as const).map(([mode, title, description]) => {
                  const active = (snapshot.settings?.permissionMode || 'ask') === mode;
                  return (
                    <button
                      className={`permission-mode-card${active ? ' active' : ''}${mode === 'full-access' ? ' caution' : ''}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      key={mode}
                      disabled={!window.tauDesktop.isTauri || !snapshot.settings}
                      onClick={() => void controller.setPermissionMode(mode)}
                    >
                      <span className="permission-mode-title">{title}</span>
                      <span className="permission-mode-description">{description}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-between gap-[18px] border-t border-t-line pt-[15px] max-compact:flex-col max-compact:items-start">
                <div className="flex min-w-0 flex-col gap-1">
                  <strong className="text-[12px] text-primary">项目可信任</strong>
                  <span className="overflow-hidden text-[11px] leading-[1.45] text-dim text-ellipsis whitespace-nowrap" title={snapshot.workspace.path || undefined}>
                    {snapshot.workspace.noFolder || !snapshot.workspace.path
                      ? '无文件夹会话不加载项目级 .pi 资源。'
                      : '可信任后，Pi 可加载此项目中的 .pi 设置、扩展与技能。'}
                  </span>
                </div>
                {snapshot.workspace.noFolder || !snapshot.workspace.path ? null : (() => {
                  const trusted = (snapshot.settings?.trustedProjectPaths || []).includes(snapshot.workspace.path);
                  return <button className={`settings-action-btn${trusted ? ' danger' : ' primary'}`} type="button" onClick={() => void controller.setProjectTrusted(snapshot.workspace.path, !trusted)}>
                    {trusted ? '撤销可信任' : '信任此项目'}
                  </button>;
                })()}
              </div>
              {!snapshot.workspace.noFolder && snapshot.workspace.path ? <p className="settings-help">项目可信任变更会在下次启动该项目的 Pi 会话时生效。</p> : null}
              <div className="mt-4 flex items-center justify-between gap-[18px] border-t border-t-line pt-[15px] max-compact:flex-col max-compact:items-start">
                <div className="flex min-w-0 flex-col gap-1">
                  <strong className="text-[12px] text-primary">操作审计日志</strong>
                  <span className="overflow-hidden text-[11px] leading-[1.45] text-dim text-ellipsis whitespace-nowrap">记录每一次工具授权、会话删除、Git 写入与运行时更新，便于事后核查。</span>
                </div>
                <button className="settings-action-btn" type="button" onClick={() => void controller.openAuditLog()}>打开日志</button>
              </div>
            </div>
          ) : null}

          {section === 'models' ? <ModelRoutingSection snapshot={snapshot} /> : null}
          {section === 'models' ? <ModelsProvidersSection snapshot={snapshot} /> : null}

          {section === 'runtime' ? (
            <>
              <AppUpdateSection snapshot={snapshot} />
              <div className="pane-section">
                <div className="pane-section-head">
                  <div>
                    <div className="pane-section-title">Pi 运行时</div>
                    <p className="pane-section-note">检测版本、更新系统安装或内置 sidecar。</p>
                  </div>
                  <div className="pane-section-actions">
                    <button className="settings-action-btn" type="button" disabled={!window.tauDesktop.isTauri || snapshot.piUpdating} onClick={() => void controller.checkPiUpdate()}>
                      检查更新
                    </button>
                    <button className="settings-action-btn primary" type="button" disabled={!window.tauDesktop.isTauri || snapshot.piUpdating || !canUpdate} onClick={() => void controller.updatePiRuntime()}>
                      {snapshot.piUpdating ? '正在更新…' : '更新 Pi'}
                    </button>
                  </div>
                </div>

                <div className="settings-kv-grid">
                  <div className="settings-kv">
                    <span className="settings-kv-label">来源</span>
                    <span className={`settings-kv-value ${info?.bundled || ['system', 'override'].includes(info?.source || '') ? 'text-success!' : 'text-warning!'}`}>{runtimeSource(snapshot)}</span>
                  </div>
                  <div className="settings-kv">
                    <span className="settings-kv-label">当前版本</span>
                    <span className="settings-kv-value">{info?.piVersion || '不可用'}</span>
                  </div>
                  <div className="settings-kv">
                    <span className="settings-kv-label">最新版本</span>
                    <span className={`settings-kv-value ${info?.updateAvailable ? 'text-warning!' : info?.latestVersion ? 'text-success!' : ''}`}>
                      {info?.latestVersion || '未检查'}
                      {info?.updateAvailable ? ' · 可更新' : info?.latestVersion ? ' · 已是最新' : ''}
                    </span>
                  </div>
                  <div className="settings-kv">
                    <span className="settings-kv-label">Node</span>
                    <span className="settings-kv-value">{info?.nodeVersion || '不可用'}</span>
                  </div>
                  <div className="settings-kv">
                    <span className="settings-kv-label">平台</span>
                    <span className="settings-kv-value">{info?.platform || '未知'}</span>
                  </div>
                </div>

                {info?.command ? <div className="mt-0.5 overflow-hidden rounded-lg border border-line bg-muted px-2.5 py-[9px] font-mono text-[10px] leading-[1.5] text-dim text-ellipsis whitespace-nowrap" title={info.command}>{info.command}</div> : null}
                {info?.error ? <div className="mt-[9px] rounded-lg border border-[color-mix(in_srgb,var(--warning)_28%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_7%,transparent)] px-2.5 py-2 text-[11px] text-warning">{info.error}</div> : null}
                {snapshot.piUpdateMessage ? <div className="mt-[9px] rounded-lg border border-[color-mix(in_srgb,var(--warning)_28%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_7%,transparent)] px-2.5 py-2 text-[11px] text-warning">{snapshot.piUpdateMessage}</div> : null}
                <p className="settings-help">更新会停止当前 Pi 会话。系统安装走 npm 全局更新；内置版本会替换 binaries 中的 pi-package。</p>
              </div>

              <div className="pane-section">
                <div className="pane-section-head">
                  <div>
                    <div className="pane-section-title">桌面端</div>
                    <p className="pane-section-note">仅在桌面应用中可用。</p>
                  </div>
                </div>
                <div className="settings-row">
                  <span className="settings-label">开机自动启动</span>
                  <Toggle enabled={snapshot.autostartEnabled} label="开机自动启动" disabled={!window.tauDesktop.isTauri} onChange={(enabled) => void controller.setAutostart(enabled)} />
                </div>
                <div className="settings-row">
                  <span className="settings-label">连接方式</span>
                  <button className="settings-value-btn min-h-[30px] rounded-lg border border-line bg-muted px-[9px] font-mono text-[10px] leading-none text-primary cursor-pointer enabled:hover:border-line-hover enabled:hover:bg-elevated disabled:text-dim disabled:cursor-not-allowed disabled:opacity-[0.62]" type="button" disabled>
                    {!window.tauDesktop.isTauri ? 'Web 模式' : window.tauDesktop.transport === 'mirror' ? String(snapshot.settings?.tauPort || 3001) : '原生 RPC'}
                  </button>
                </div>
                {snapshot.authConfigured ? (
                  <div className="settings-row">
                    <span className="settings-label">需要登录</span>
                    <Toggle enabled={snapshot.authEnabled} label="需要登录" onChange={(enabled) => void controller.setAuth(enabled)} />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ModelsProvidersSection({ snapshot }: { snapshot: AppSnapshot }) {
  const [draft, setDraft] = useState<ModelsConfig>(() => cloneConfig(snapshot.modelsConfig));
  const [editing, setEditing] = useState<string | null>(null);
  const [newProviderName, setNewProviderName] = useState('');
  const [dirty, setDirty] = useState(false);
  // Name of the card to bring into view once it has rendered; cleared after use
  // so a later re-render never scrolls the pane again behind the user's back.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const lastSynced = useRef(configSignature(snapshot.modelsConfig));
  const desktop = Boolean(window.tauDesktop.isTauri);
  const trimmedNewProviderName = newProviderName.trim();

  useEffect(() => {
    if (!scrollTarget) return;
    setScrollTarget(null);
    const card = document.querySelector(`[data-provider-name="${CSS.escape(scrollTarget)}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [scrollTarget]);

  useEffect(() => {
    const nextSignature = configSignature(snapshot.modelsConfig);
    // Only reset local draft when server content actually changed and the user
    // is not mid-edit — avoids flash/collapse on silent refresh.
    if (nextSignature === lastSynced.current) return;
    if (dirty) return;
    lastSynced.current = nextSignature;
    setDraft(cloneConfig(snapshot.modelsConfig));
  }, [snapshot.modelsConfig, dirty]);

  const providers = useMemo(
    () => Object.entries(draft.providers || {}).sort(([left], [right]) => left.localeCompare(right)),
    [draft.providers],
  );
  const currentModelId = knownModelSetting(snapshot.currentModelId) || snapshot.defaultModel;
  const storedCurrentProvider = knownModelSetting(snapshot.currentModelProvider);
  const currentModel = snapshot.models.find((model) => model.id === currentModelId && (!storedCurrentProvider || model.provider === storedCurrentProvider));
  const currentProvider = storedCurrentProvider || currentModel?.provider || snapshot.defaultProvider;
  const selectedProvider = snapshot.defaultProvider || currentProvider;
  const selectedProviderModels = useMemo(() => {
    const result = new Map<string, { id: string; name?: string }>();
    for (const model of snapshot.models.filter((item) => item.provider === selectedProvider)) {
      result.set(model.id, { id: model.id, name: model.name });
    }
    for (const model of draft.providers?.[selectedProvider]?.models || []) {
      if (model.id && !result.has(model.id)) result.set(model.id, { id: model.id, name: model.name });
    }
    return [...result.values()];
  }, [draft.providers, selectedProvider, snapshot.models]);

  const switchProvider = async (providerName: string) => {
    if (!providerName) return;
    const available = snapshot.models.find((model) => model.provider === providerName);
    const configured = draft.providers?.[providerName]?.models?.find((model) => model.id);
    const modelId = providerName === snapshot.defaultProvider && snapshot.defaultModel
      ? snapshot.defaultModel
      : available?.id || configured?.id || '';
    if (!modelId) {
      window.dispatchEvent(new CustomEvent('pi-studio:toast', {
        detail: { title: '无法切换供应商', message: '该供应商还没有可用模型，请先在下方添加或拉取模型并保存。', type: 'warning' },
      }));
      return;
    }
    await controller.setDefaultModel(providerName, modelId);
  };

  if (!desktop) {
    return (
      <div className="pane-section">
        <div className="pane-section-title">模型供应商</div>
        <p className="pane-section-note">模型配置（~/.pi/agent/models.json）仅在桌面应用中可管理。</p>
      </div>
    );
  }

  const updateProvider = (name: string, next: ModelsProviderConfig) => {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      providers: {
        ...(current.providers || {}),
        [name]: next,
      },
    }));
  };

  const removeProvider = (name: string) => {
    setDirty(true);
    setDraft((current) => {
      const providers = { ...(current.providers || {}) };
      delete providers[name];
      return { ...current, providers };
    });
    if (editing === name) setEditing(null);
  };

  const addProvider = () => {
    const name = trimmedNewProviderName;
    if (!name) return;
    if (draft.providers?.[name]) {
      // The list is sorted alphabetically, so the existing card is often off
      // screen — without the toast + scroll this reads as "nothing happened".
      notify('该供应商已存在', `已为你展开 ${name} 的配置。`, 'warning');
      setEditing(name);
      setNewProviderName('');
      setScrollTarget(name);
      return;
    }
    setDirty(true);
    setDraft((current) => ({
      ...current,
      providers: {
        ...(current.providers || {}),
        [name]: emptyProvider(),
      },
    }));
    setEditing(name);
    setNewProviderName('');
    setScrollTarget(name);
  };

  const save = async () => {
    const ok = await controller.saveModelsConfig(draft);
    if (ok) {
      setDirty(false);
      lastSynced.current = configSignature(draft);
    }
  };

  const refresh = async () => {
    // Silent refresh keeps the list mounted; no "loading…" swap.
    await controller.loadModelsConfig({ silent: true });
  };

  return (
          <div className="pane-section flush">
            <div className="pane-section-head">
              <div>
                <div className="pane-section-title">模型供应商{dirty ? <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warning align-[1px]" title="有未保存更改" /> : null}</div>
                <p className="pane-section-note max-w-[680px]">
            管理 API 连接、兼容性和模型能力。保存后自动刷新可用模型
            {dirty ? ' · 有未保存更改' : ''}
          </p>
        </div>
        <div className="pane-section-actions">
          <button
            className="settings-action-btn"
            type="button"
            onClick={() => void refresh()}
            disabled={snapshot.modelsConfigLoading || snapshot.modelsConfigSaving}
          >
            {snapshot.modelsConfigLoading ? '刷新中…' : '刷新'}
          </button>
          <button className="settings-action-btn" type="button" onClick={() => void controller.openModelsConfig()}>打开文件</button>
          <button className="settings-action-btn" type="button" title="恢复上次保存前的备份" onClick={() => void confirmDialog({ title: '恢复 models.json 备份？', message: '当前内容会被上次保存前的副本覆盖。', confirmLabel: '恢复' }).then((ok) => { if (ok) void controller.restoreModelsConfig(); })}>恢复备份</button>
          <button className="settings-action-btn primary" type="button" onClick={() => void save()} disabled={snapshot.modelsConfigSaving}>
            {snapshot.modelsConfigSaving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {snapshot.modelsConfigPath ? (
        <div className="settings-meta-chip" title={snapshot.modelsConfigPath}>
          <span className="flex-none text-[10px] font-bold tracking-[0.04em] text-dim uppercase">配置文件</span>
          <span className="min-w-0 overflow-hidden font-mono text-[10px] leading-[1.4] text-secondary text-ellipsis whitespace-nowrap">{snapshot.modelsConfigPath}</span>
        </div>
      ) : null}
      {snapshot.modelsConfigError ? <div className="mt-[9px] rounded-lg border border-[color-mix(in_srgb,var(--warning)_28%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_7%,transparent)] px-2.5 py-2 text-[11px] text-warning">{snapshot.modelsConfigError}</div> : null}
      {/* First-load only: never blank the list during silent refresh. */}
      {snapshot.modelsConfigLoading && !snapshot.modelsConfig ? (
        <div className="settings-help">正在加载模型配置…</div>
      ) : null}

      <div className="mt-[18px] grid grid-cols-[minmax(0,1fr)_minmax(360px,500px)] items-center gap-[18px] rounded-[10px] border border-[color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color-mix(in_srgb,var(--accent-subtle)_42%,var(--bg-panel))] px-4 py-3.5 max-narrow:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-bold tracking-[0.04em] text-accent-text [font-weight:750]">PI 默认供应商</span>
          <strong className="overflow-hidden text-[14px] text-primary text-ellipsis whitespace-nowrap">{snapshot.defaultProvider || '尚未设置'}</strong>
          <span className="overflow-hidden text-[11px] text-dim text-ellipsis whitespace-nowrap">默认模型：{snapshot.defaultModel || '尚未设置'}{currentProvider && currentModelId ? ` · 当前会话：${currentProvider}/${currentModelId}` : ''}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 max-compact:grid-cols-1">
          <div className="flex flex-col gap-[5px] text-[10px] text-secondary">
            <span>默认供应商</span>
            <Select
              ariaLabel="默认供应商"
              value={selectedProvider}
              placeholder="选择供应商"
              disabled={!providers.length}
              options={[
                ...(snapshot.defaultProvider && !draft.providers?.[snapshot.defaultProvider] ? [{ value: snapshot.defaultProvider, label: snapshot.defaultProvider }] : []),
                ...providers.map(([name]) => ({ value: name, label: name })),
              ]}
              onChange={(value) => void switchProvider(value)}
            />
          </div>
          <div className="flex flex-col gap-[5px] text-[10px] text-secondary">
            <span>默认模型</span>
            <Select
              ariaLabel="默认模型"
              value={snapshot.defaultModel}
              placeholder="选择模型"
              disabled={!selectedProviderModels.length}
              options={[
                ...(snapshot.defaultModel && !selectedProviderModels.some((model) => model.id === snapshot.defaultModel) ? [{ value: snapshot.defaultModel, label: snapshot.defaultModel }] : []),
                ...selectedProviderModels.map((model) => ({ value: model.id, label: model.name || model.id })),
              ]}
              onChange={(value) => void controller.setDefaultModel(selectedProvider, value)}
            />
          </div>
        </div>
      </div>

      <div className="my-[22px] mb-4 grid grid-cols-[minmax(0,1fr)_minmax(320px,460px)] items-center gap-6 rounded-[10px] border border-line bg-panel px-3.5 py-3 max-narrow:grid-cols-1">
        <div className="flex flex-col gap-0.5">
          <strong className="text-[13px]">供应商列表</strong>
          <span className="text-[11px] text-dim">{providers.length ? `${providers.length} 个已配置` : '添加一个 API 供应商开始使用'}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 max-compact:grid-cols-1">
          <input
            className="settings-text-input"
            type="text"
            placeholder="输入名称，例如 ollama"
            value={newProviderName}
            onChange={(event) => setNewProviderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addProvider();
              }
            }}
          />
          <button
            className="settings-action-btn primary"
            type="button"
            onClick={addProvider}
            disabled={!trimmedNewProviderName}
            title={trimmedNewProviderName ? undefined : '请先在左侧输入供应商名称'}
          >
            添加供应商
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {providers.length === 0 ? (
          <div className="settings-empty-state">
            <strong>还没有自定义 provider</strong>
            <p>在上方输入名称添加，例如 ollama、openrouter。</p>
          </div>
        ) : null}
        {providers.map(([name, provider]) => (
          <ProviderCard
            key={name}
            name={name}
            provider={provider}
            thinkingLevel={snapshot.thinkingLevel || 'off'}
            expanded={editing === name}
            onToggle={() => setEditing((current) => (current === name ? null : name))}
            onChange={(next) => updateProvider(name, next)}
            onRemove={() => removeProvider(name)}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({
  name,
  provider,
  thinkingLevel,
  expanded,
  onToggle,
  onChange,
  onRemove,
}: {
  name: string;
  provider: ModelsProviderConfig;
  thinkingLevel: string;
  expanded: boolean;
  onToggle(): void;
  onChange(next: ModelsProviderConfig): void;
  onRemove(): void;
}) {
  const models = provider.models || [];
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingModelIndex, setTestingModelIndex] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { output?: string; error?: string }>>({});
  const [showApiKey, setShowApiKey] = useState(false);
  const updateModel = (index: number, patch: Partial<ModelsProviderModel>) => {
    const nextModels = models.map((model, modelIndex) => (modelIndex === index ? { ...model, ...patch } : model));
    onChange({ ...provider, models: nextModels });
  };
  const removeModel = (index: number) => {
    onChange({ ...provider, models: models.filter((_, modelIndex) => modelIndex !== index) });
  };
  const addModel = () => {
    onChange({
      ...provider,
      models: [...models, { id: '', name: '', reasoning: true }],
    });
  };
  const profiles = provider.reasoningProfiles || {};
  const addProfile = () => {
    let id = 'openai-standard';
    let suffix = 2;
    while (profiles[id]) id = `openai-standard-${suffix++}`;
    onChange({
      ...provider,
      compat: { ...(provider.compat || {}), supportsReasoningEffort: true },
      reasoningProfiles: { ...profiles, [id]: structuredClone(DEFAULT_REASONING_PROFILE) },
    });
  };
  const fetchModels = async () => {
    setFetchingModels(true);
    try {
      const fetched = await controller.fetchProviderModels(provider);
      if (!fetched.length) return;
      const existing = new Set(models.map((model) => model.id).filter(Boolean));
      const additions = fetched
        .filter((model) => model.id && !existing.has(model.id))
        .map((model) => ({
          id: model.id,
          name: model.name || model.id,
          // Provider catalog APIs don't report reasoning capability; default
          // pulled models to thinking-capable so the toggle actually cycles.
          reasoning: model.reasoning ?? true,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          input: model.input,
        }));
      if (additions.length) {
        onChange({
          ...provider,
          models: [...models, ...additions],
        });
      }
      window.dispatchEvent(new CustomEvent('pi-studio:toast', {
        detail: {
          title: additions.length ? '模型草稿已更新' : '模型列表已是最新',
          message: additions.length ? `已添加 ${additions.length} 个模型。请明确选择兼容性预设后保存。` : '没有发现新的模型。',
          type: 'success',
        },
      }));
    } finally {
      setFetchingModels(false);
    }
  };
  const testModel = async (index: number, model: ModelsProviderModel) => {
    setTestingModelIndex(index);
    setTestResults((current) => ({ ...current, [index]: {} }));
    try {
      const output = await controller.testProviderModel(provider, model.id || '', model.reasoningProfile, thinkingLevel, model.thinkingLevelMap);
      setTestResults((current) => ({ ...current, [index]: { output } }));
    } catch (error) {
      setTestResults((current) => ({ ...current, [index]: { error: String(error) } }));
    } finally {
      setTestingModelIndex(null);
    }
  };

  return (
    <article className={`overflow-hidden rounded-xl border bg-[color-mix(in_srgb,var(--bg-panel)_88%,transparent)] shadow-none transition-[border-color,box-shadow] duration-[var(--duration)] hover:border-line-hover${expanded ? ' border-[color-mix(in_srgb,var(--accent)_42%,var(--border))]! bg-muted!' : ' border-line'}`} data-provider-name={name}>
      <button className="flex min-h-[72px] w-full items-center justify-between gap-[13px] border-0 bg-transparent px-[15px] py-[13px] text-left text-inherit cursor-pointer hover:bg-glass-hover max-compact:items-start" type="button" onClick={onToggle}>
        <span className="inline-flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-[color-mix(in_srgb,var(--accent)_34%,var(--border))] bg-accent-subtle text-[13px] text-accent-text [font-weight:750]">{name.slice(0, 1).toUpperCase()}</span>
        <div className="flex min-w-0 flex-col gap-[5px]">
          <div className="flex min-w-0 flex-wrap items-center gap-[7px]">
            <strong className="text-[14px] text-primary">{name}</strong>
            <span className="inline-flex h-[18px] items-center rounded-full border border-line bg-panel px-1.5 text-[9px] font-semibold text-secondary">{models.length} 个模型</span>
            <span className="inline-flex h-[18px] items-center rounded-full border border-line bg-panel px-1.5 text-[9px] font-semibold text-dim">{provider.api || 'API 未设置'}</span>
          </div>
          <span className="overflow-hidden text-[11px] text-dim text-ellipsis whitespace-nowrap">
            {provider.baseUrl || '未设置 baseUrl'} · Key {maskApiKey(provider.apiKey)}
          </span>
        </div>
        <div className="ml-auto flex flex-none gap-[18px] border-r border-r-line px-4 max-compact:hidden" aria-hidden="true">
          <span className="flex min-w-8 flex-col items-center gap-px"><strong className="text-[13px] leading-[1.1] text-primary">{models.length}</strong><small className="text-[9px] text-dim">模型</small></span>
          <span className="flex min-w-8 flex-col items-center gap-px"><strong className="text-[13px] leading-[1.1] text-primary">{Object.keys(provider.reasoningProfiles || {}).length}</strong><small className="text-[9px] text-dim">预设</small></span>
        </div>
        <span className="flex-none text-[11px] font-semibold text-accent-text max-compact:ml-auto">{expanded ? '收起' : '配置'} {expanded ? <ChevronUp size={12} className="ml-1 inline-block align-[-1px]" aria-hidden="true" /> : <ChevronDown size={12} className="ml-1 inline-block align-[-1px]" aria-hidden="true" />}</span>
      </button>

      {expanded ? (
        <div className="border-t border-t-line px-[15px] pb-[18px]">
          <div className="mt-4">
            <div className="mb-[9px] flex items-baseline gap-2"><strong className="text-[12px]">连接配置</strong><span className="text-[10px] text-dim">请求地址和鉴权信息</span></div>
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2.5 max-narrow:grid-cols-1">
            <label className="flex flex-col gap-[5px] text-[11px] text-secondary">
              <span>Base URL</span>
              <input className="settings-text-input" value={provider.baseUrl || ''} onChange={(event) => onChange({ ...provider, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
            </label>
            <div className="flex flex-col gap-[5px] text-[11px] text-secondary">
              <span>API 类型</span>
              <Select
                ariaLabel="API 类型"
                value={provider.api || 'openai-completions'}
                options={API_OPTIONS.map((api) => ({ value: api, label: api }))}
                onChange={(api) => onChange({ ...provider, api })}
              />
            </div>
            <label className="col-span-full flex flex-col gap-[5px] text-[11px] text-secondary">
              <span>API Key</span>
              <span className="relative flex items-center">
                <input
                  className="settings-text-input pr-[58px]"
                  type={showApiKey ? 'text' : 'password'}
                  value={provider.apiKey || ''}
                  onChange={(event) => onChange({ ...provider, apiKey: event.target.value })}
                  placeholder={provider.apiKey ? maskApiKey(provider.apiKey) : '可选，支持 $ENV 或 !command；留空保留原值'}
                  autoComplete="off"
                />
                <button
                  className="absolute right-[5px] inline-flex h-[26px] min-w-12 items-center justify-center rounded-md border-0 bg-transparent px-[7px] text-[10px] font-bold text-accent-text cursor-pointer hover:bg-accent-subtle hover:text-accent-hover focus-visible:outline-offset-[-1px]"
                  type="button"
                  onClick={() => setShowApiKey((visible) => !visible)}
                  aria-label={showApiKey ? '隐藏 API Key' : '查看 API Key'}
                  title={showApiKey ? '隐藏 API Key' : '查看 API Key'}
                >
                  {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </label>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-[9px] flex items-baseline gap-2"><strong className="text-[12px]">兼容性设置</strong><span className="text-[10px] text-dim">根据供应商 API 行为调整请求格式</span></div>
            <div className="grid grid-cols-[repeat(3,minmax(150px,1fr))_repeat(2,minmax(145px,1fr))] gap-2.5 rounded-[10px] border border-line bg-panel p-3 max-narrow:grid-cols-2">
            <label className="inline-flex min-h-8 items-center gap-[7px] rounded-[7px] px-2 text-[11px] text-secondary cursor-pointer select-none hover:bg-glass-hover">
              <input
                type="checkbox"
                checked={provider.compat?.supportsDeveloperRole === false}
                onChange={(event) => onChange({
                  ...provider,
                  compat: {
                    ...(provider.compat || {}),
                    supportsDeveloperRole: event.target.checked ? false : true,
                  },
                })}
              />
              <span>禁用 developer 角色</span>
            </label>
            <label className="inline-flex min-h-8 items-center gap-[7px] rounded-[7px] px-2 text-[11px] text-secondary cursor-pointer select-none hover:bg-glass-hover">
              <input
                type="checkbox"
                checked={provider.compat?.supportsReasoningEffort === false}
                onChange={(event) => onChange({
                  ...provider,
                  compat: {
                    ...(provider.compat || {}),
                    supportsReasoningEffort: event.target.checked ? false : true,
                  },
                })}
              />
              <span>禁用 reasoning_effort</span>
            </label>
            <label className="inline-flex min-h-8 items-center gap-[7px] rounded-[7px] px-2 text-[11px] text-secondary cursor-pointer select-none hover:bg-glass-hover">
              <input
                type="checkbox"
                checked={provider.compat?.supportsUsageInStreaming !== false}
                onChange={(event) => onChange({
                  ...provider,
                  compat: { ...(provider.compat || {}), supportsUsageInStreaming: event.target.checked },
                })}
              />
              <span>流式响应包含 usage</span>
            </label>
            <div className="flex min-w-[150px] flex-col gap-1 text-[10px] text-secondary">
              <span>推理参数格式</span>
              <Select
                ariaLabel="推理参数格式"
                value={provider.compat?.thinkingFormat || ''}
                placeholder="Pi 默认"
                options={[
                  { value: '', label: 'Pi 默认' },
                  ...['reasoning_effort', 'openrouter', 'deepseek', 'together', 'zai', 'qwen', 'chat-template', 'qwen-chat-template'].map((format) => ({ value: format, label: format })),
                ]}
                onChange={(value) => {
                  const compat = { ...(provider.compat || {}) };
                  if (value) compat.thinkingFormat = value;
                  else delete compat.thinkingFormat;
                  onChange({ ...provider, compat });
                }}
              />
            </div>
            <div className="flex min-w-[150px] flex-col gap-1 text-[10px] text-secondary">
              <span>最大输出字段</span>
              <Select
                ariaLabel="最大输出字段"
                value={provider.compat?.maxTokensField || ''}
                placeholder="Pi 默认"
                options={[
                  { value: '', label: 'Pi 默认' },
                  { value: 'max_completion_tokens', label: 'max_completion_tokens' },
                  { value: 'max_tokens', label: 'max_tokens' },
                ]}
                onChange={(value) => {
                  const compat = { ...(provider.compat || {}) };
                  if (value) compat.maxTokensField = value;
                  else delete compat.maxTokensField;
                  onChange({ ...provider, compat });
                }}
              />
            </div>
            </div>
          </div>

          <div className="mt-[22px] flex items-center justify-between gap-2.5 text-[12px] text-primary">
            <div><strong>推理预设（Reasoning Profile）</strong><span className="ml-[7px] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-subtle align-middle text-[10px] font-bold text-accent-text">{Object.keys(profiles).length}</span></div>
            <button className="settings-action-btn" type="button" onClick={addProfile}>添加 OpenAI 标准预设</button>
          </div>
          <p className="settings-help settings-help-inline">GPT 5.5 请在模型行选择 “OpenAI 标准” 预设；当前聊天选择“高”时，会发送 <code>high</code>。测试按钮也按当前聊天强度发送。</p>
          <div className="mt-2 flex flex-col gap-[7px]">
            {Object.entries(profiles).map(([profileId, profile]) => (
              <div className="flex w-full min-h-[94px] flex-col gap-2.5 rounded-[9px] border border-line bg-panel p-2.5" key={profileId}>
                <div className="grid grid-cols-[minmax(220px,1fr)_auto] items-end gap-3 max-compact:grid-cols-1 max-compact:items-stretch">
                  <label className="flex max-w-[300px] min-w-0 flex-col gap-[5px] text-[11px] text-secondary max-compact:max-w-none"><span>预设名称</span><input className="settings-text-input" value={profile.name || profileId} onChange={(event) => onChange({ ...provider, reasoningProfiles: { ...profiles, [profileId]: { ...profile, name: event.target.value } } })} /></label>
                  <button className="settings-action-btn danger min-h-[34px]!" type="button" onClick={() => { const next = { ...profiles }; delete next[profileId]; onChange({ ...provider, reasoningProfiles: next, models: models.map((model) => model.reasoningProfile === profileId ? { ...model, reasoningProfile: undefined, reasoning: undefined } : model) }); }}>删除预设</button>
                </div>
                <div className="grid grid-cols-[repeat(6,minmax(0,1fr))] items-end gap-2 p-0 max-narrow:grid-cols-3 max-compact:grid-cols-2">
                  {THINKING_LEVELS.map((level) => (
                    <div className="flex min-w-0 flex-col gap-1 text-[10px] text-dim" key={level}>
                      <span>{level === 'off' ? REASONING_UI_LABELS.off : thinkingLevelLabel(level)}</span>
                      <Select
                        ariaLabel={`${thinkingLevelLabel(level)}强度映射`}
                        value={profile.levelMap[level]}
                        options={[
                          ...(level === 'off' ? [{ value: 'omit', label: REASONING_UI_LABELS.omit }] : []),
                          ...(level !== 'off' ? [{ value: 'unsupported', label: REASONING_UI_LABELS.unsupported }] : []),
                          ...PI_REASONING_LEVELS.filter((item) => item !== 'off').map((item) => ({ value: item, label: item })),
                        ]}
                        onChange={(value) => onChange({ ...provider, reasoningProfiles: { ...profiles, [profileId]: { ...profile, levelMap: { ...profile.levelMap, [level]: value } } } })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!Object.keys(profiles).length ? <div className="settings-help">没有预设也可以使用思考开关（级别由 Pi 管理，默认不发送参数）；若需要发送 reasoning_effort 等参数，请添加预设并在模型行选择。</div> : null}
          </div>

          <div className="mt-[22px] flex items-center justify-between gap-2.5 text-[12px] text-primary">
            <div>
              <strong>模型列表</strong>
              <span className="ml-[7px] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-subtle align-middle text-[10px] font-bold text-accent-text">{models.length}</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <button className="settings-action-btn" type="button" onClick={() => void fetchModels()} disabled={fetchingModels}>
                {fetchingModels ? '拉取中…' : '拉取模型'}
              </button>
              <button className="settings-action-btn" type="button" onClick={addModel}>添加模型</button>
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-[7px]">
            {models.length === 0 ? <div className="settings-help">还没有模型，点击“添加模型”。</div> : null}
            {models.length > 0 ? (
              <div className="grid grid-cols-[minmax(150px,1.3fr)_minmax(112px,1fr)_110px_110px_132px] items-center gap-2 px-0.5 text-[10px] font-semibold tracking-[0.03em] text-dim uppercase max-narrow:hidden">
                <span>模型 ID</span>
                <span>显示名</span>
                <span>Context</span>
                <span>推理预设</span>
                <span />
              </div>
            ) : null}
            {models.map((model, index) => (
              <div className="flex min-h-[94px] flex-col gap-[7px] rounded-[9px] border border-line bg-panel p-2.5 hover:border-line-hover" key={`${name}-model-${index}`}>
                <div className="grid grid-cols-[minmax(150px,1.3fr)_minmax(112px,1fr)_110px_110px_132px] items-center gap-2 max-narrow:grid-cols-1 [&>*]:min-w-0">
                  <input className="settings-text-input" value={model.id || ''} placeholder="model-id" onChange={(event) => updateModel(index, { id: event.target.value })} />
                  <input className="settings-text-input" value={model.name || ''} placeholder="可选" onChange={(event) => updateModel(index, { name: event.target.value })} />
                  <input
                    className="settings-text-input"
                    type="number"
                    min={1}
                    value={model.contextWindow || ''}
                    placeholder="按模型文档填写"
                    onChange={(event) => updateModel(index, { contextWindow: event.target.value ? Number(event.target.value) : undefined })}
                  />
                  <Select
                    ariaLabel="推理预设"
                    value={model.reasoningProfile || (model.thinkingLevelMap ? '__model-map__' : '__none__')}
                    options={[
                      { value: '__none__', label: '不发送额外参数（默认）' },
                      { value: '__model-map__', label: '模型强度映射' },
                      ...Object.entries(profiles).map(([profileId, profile]) => ({ value: profileId, label: profile.name || profileId })),
                    ]}
                    onChange={(selected) => {
                      const isProfile = selected !== '__model-map__' && selected !== '__none__';
                      const reasoningProfile = isProfile ? selected : undefined;
                      const nextModels = models.map((item, modelIndex) => {
                        if (modelIndex !== index) return item;
                        if (selected === '__model-map__') return { ...item, reasoningProfile: undefined, reasoning: true };
                        if (reasoningProfile) return { ...item, reasoningProfile, reasoning: true, thinkingLevelMap: undefined };
                        // Default: thinking level stays owned by Pi, no
                        // reasoning_effort-style params are sent.
                        return { ...item, reasoningProfile: undefined, reasoning: true, thinkingLevelMap: undefined };
                      });
                      onChange({ ...provider, compat: isProfile || selected === '__model-map__' ? { ...(provider.compat || {}), supportsReasoningEffort: true } : provider.compat, models: nextModels });
                    }}
                  />
                  <div className="inline-flex gap-1.5 whitespace-nowrap [&>.settings-action-btn]:min-w-0 [&>.settings-action-btn]:px-2 [&>.settings-action-btn]:whitespace-nowrap">
                    <button className="settings-action-btn" type="button" title={`按当前 Pi 强度「${thinkingLevelLabel(thinkingLevel)}」测试`} onClick={() => void testModel(index, model)} disabled={testingModelIndex !== null}>
                      {testingModelIndex === index ? '测试中…' : `测试·${thinkingLevelLabel(thinkingLevel)}`}
                    </button>
                    <button className="settings-action-btn danger" type="button" onClick={() => removeModel(index)}>删除</button>
                  </div>
                </div>
                <div className="mt-0.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-t border-t-[color-mix(in_srgb,var(--border)_72%,transparent)] pt-[7px] text-[10px] text-dim max-compact:grid-cols-1 max-compact:items-start">
                  {model.input?.length ? <span className="w-fit rounded-full bg-panel px-1.5 py-0.5">输入：{model.input.join('、')}</span> : null}
                  <label className="grid grid-cols-[auto_138px] items-center justify-end gap-[7px] whitespace-nowrap max-compact:grid-cols-[auto_minmax(120px,1fr)] max-compact:justify-start">
                    <span>最大输出 Token</span>
                    <input
                      className="settings-text-input w-[138px] min-h-7 text-[11px]"
                      type="number"
                      min={1}
                      value={model.maxTokens || ''}
                      placeholder="按模型文档填写"
                      onChange={(event) => updateModel(index, { maxTokens: event.target.value ? Number(event.target.value) : undefined })}
                    />
                  </label>
                </div>
                {!model.reasoningProfile && model.thinkingLevelMap ? (
                  <div className="grid grid-cols-[minmax(136px,1.4fr)_repeat(6,minmax(0,1fr))] items-end gap-2 rounded-[9px] border border-line bg-panel p-2.5 max-compact:grid-cols-2">
                    <span className="text-[11px] leading-[1.45] text-secondary">模型强度映射<br />直接配置，保存后按此映射发送</span>
                    {THINKING_LEVELS.map((level) => {
                      const configured = model.thinkingLevelMap?.[level];
                      const value = configured === null ? 'unsupported' : typeof configured === 'string' ? configured : level === 'off' ? 'omit' : 'unsupported';
                      return (
                        <div className="flex min-w-0 flex-col gap-1 text-[10px] text-dim" key={level}>
                          <span>{level === 'off' ? REASONING_UI_LABELS.off : thinkingLevelLabel(level)}</span>
                          <Select
                            ariaLabel={`${thinkingLevelLabel(level)}强度映射`}
                            value={value}
                            options={[
                              ...(level === 'off' ? [{ value: 'omit', label: REASONING_UI_LABELS.omit }] : []),
                              ...(level !== 'off' ? [{ value: 'unsupported', label: REASONING_UI_LABELS.unsupported }] : []),
                              ...PI_REASONING_LEVELS.filter((item) => item !== 'off').map((item) => ({ value: item, label: item })),
                            ]}
                            onChange={(selected) => {
                              updateModel(index, {
                                reasoning: true,
                                thinkingLevelMap: { ...(model.thinkingLevelMap || {}), [level]: selected === 'unsupported' ? null : selected },
                              });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {testResults[index] ? (
                  <div className={`rounded-[9px] border p-2.5 text-[11px] text-secondary ${testResults[index].error ? 'border-[color-mix(in_srgb,var(--error)_38%,var(--border))] bg-[color-mix(in_srgb,var(--error)_5%,var(--bg-panel))]' : 'border-[color-mix(in_srgb,var(--success)_32%,var(--border))] bg-[color-mix(in_srgb,var(--success)_5%,var(--bg-panel))]'}`}>
                    <strong>{testResults[index].error ? '测试失败' : '非流式响应'}</strong>
                    <pre className="mt-1.5 mb-0 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] text-primary">{testResults[index].error || testResults[index].output}</pre>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-3.5 flex justify-end">
            <button className="settings-action-btn danger" type="button" onClick={onRemove}>删除 Provider</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function shortenPath(path?: string): string {
  if (!path) return '';
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length <= 3 ? path : `...${separator}${parts.slice(-3).join(separator)}`;
}

function ExtensionRow({ item, installing }: { item: PiExtensionInfo; installing: boolean }) {
  return (
    <div className={`catalog-row${item.installed ? ' installed' : ''}`}>
      <div className="catalog-main">
        <div className="catalog-title-row">
          <div className="catalog-name">{item.name}</div>
          {item.installed ? <span className="catalog-tag ok">已安装</span> : null}
          {item.requiresDependencies ? <span className="catalog-tag">需要 npm 依赖</span> : null}
        </div>
        <div className="catalog-description">{item.description || 'Pi 扩展'}</div>
        <div className="catalog-meta">
          <span className="catalog-meta-item">{item.category}</span>
          <span className="catalog-meta-item">{item.source}</span>
          {item.installedPath ? <span className="catalog-meta-item" title={item.installedPath}>{shortenPath(item.installedPath)}</span> : null}
        </div>
      </div>
      <button className={`catalog-action${item.installed ? ' border-[color-mix(in_srgb,var(--success)_26%,var(--border))]! text-success! cursor-default! opacity-100!' : ''}`} type="button" disabled={item.installed || installing} onClick={() => void controller.installExtension(item.id)}>
        {item.installed ? <><Check size={14} /><span>已安装</span></> : installing ? <span>正在安装…</span> : <><Download size={14} /><span>安装</span></>}
      </button>
    </div>
  );
}

export function ExtensionsView({ snapshot }: { snapshot: AppSnapshot }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const extensions = snapshot.extensions?.extensions || [];
  const categories = ['All', 'Installed', ...new Set(extensions.map((item) => item.category).filter((value) => value && value !== 'Installed'))];
  const filtered = extensions.filter((item) => {
    const categoryMatch = category === 'All' || (category === 'Installed' && item.installed) || item.category === category;
    const textMatch = `${item.name} ${item.id} ${item.description} ${item.category} ${item.source}`.toLowerCase().includes(query.toLowerCase());
    return categoryMatch && textMatch;
  });
  const status = snapshot.extensionError || (snapshot.extensionsLoading ? '正在加载扩展…' : extensions.length ? `显示 ${filtered.length} / ${extensions.length} 个扩展 · 安装目录：${snapshot.extensions?.installDir || ''}` : '未找到 Pi 扩展目录，请重新运行 vendor 脚本或在本机安装 Pi。');

  return (
      <div className="pane-section flush">
        <div className="catalog-toolbar">
          <label className="catalog-search-wrap"><Search size={14} /><input type="search" className="catalog-search" placeholder="搜索扩展" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button className="catalog-icon-btn" type="button" title="刷新扩展" aria-label="刷新扩展" onClick={() => void controller.loadExtensions(true)}><RotateCw size={14} /></button>
        </div>
        <div className="catalog-filters">
          {categories.map((value) => <button className={`catalog-filter${category === value ? ' active' : ''}`} type="button" key={value} onClick={() => setCategory(value)}>{({ All: '全部', Installed: '已安装' } as Record<string, string>)[value] || value}</button>)}
        </div>
        <div className={`catalog-status${snapshot.extensionError ? ' border-[color-mix(in_srgb,var(--error)_28%,var(--border))]! text-error! whitespace-normal!' : ''}`}>{status}</div>
        <div className="catalog-list">
          {filtered.map((item) => <ExtensionRow item={item} installing={snapshot.extensionInstallingId === item.id} key={item.id} />)}
          {!snapshot.extensionsLoading && filtered.length === 0 ? (
            <div className="catalog-empty">
              <span className="catalog-empty-icon"><LayoutGrid size={15} /></span>
              <span>没有符合当前筛选条件的扩展。</span>
            </div>
          ) : null}
        </div>
      </div>
  );
}

/** `npm:foo@1.2.0` / `foo@1.2.0` / `@scope/foo` all collapse to the bare name. */
function packageKey(value: string): string {
  const bare = value.trim().replace(/^npm:/i, '');
  const version = bare.lastIndexOf('@');
  return (version > 0 ? bare.slice(0, version) : bare).toLowerCase();
}

interface PackageEntry {
  key: string;
  name: string;
  source: string;
  description?: string;
  packageType?: string;
  downloads?: string;
  version?: string;
  installed: boolean;
  enabled: boolean;
}

export function PackagesView({ snapshot }: { snapshot: AppSnapshot }) {
  const [packageSource, setPackageSource] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [pendingSource, setPendingSource] = useState('');

  const installed = useMemo(() => snapshot.packages?.packages || [], [snapshot.packages]);
  const results = snapshot.packageSearchResults;

  // One list: every catalog hit annotated with its real install state, plus any
  // installed package the catalog doesn't know about (git / local sources).
  const entries = useMemo<PackageEntry[]>(() => {
    const installedByKey = new Map<string, PiPackageInfo>();
    for (const item of installed) {
      installedByKey.set(packageKey(item.source), item);
      if (item.name) installedByKey.set(packageKey(item.name), item);
    }
    const catalogKeys = new Set<string>();
    const fromCatalog = results.map((item) => {
      const key = packageKey(item.name);
      catalogKeys.add(key);
      const match = installedByKey.get(key);
      return {
        key,
        name: item.name,
        source: match?.source || `npm:${item.name}`,
        description: item.description || match?.description,
        packageType: item.packageType,
        downloads: item.downloads,
        version: match?.version,
        installed: Boolean(match),
        enabled: match ? match.enabled : true,
      };
    });
    const extras = installed
      .filter((item) => !catalogKeys.has(packageKey(item.source)) && !(item.name && catalogKeys.has(packageKey(item.name))))
      .map((item) => ({
        key: packageKey(item.source),
        name: item.name || item.source,
        source: item.source,
        description: item.description,
        version: item.version,
        installed: true,
        enabled: item.enabled,
      }));
    return [...extras, ...fromCatalog];
  }, [installed, results]);

  const types = ['All', 'Installed', ...new Set(entries.map((item) => item.packageType).filter((value): value is string => Boolean(value)))];
  const visible = entries.filter((item) => filter === 'All' || (filter === 'Installed' ? item.installed : item.packageType === filter));
  const installedCount = entries.filter((item) => item.installed).length;

  const status = snapshot.packageSearchError
    || snapshot.packageError
    || (snapshot.packageSearchLoading || snapshot.packagesLoading ? '正在读取软件包…' : `显示 ${visible.length} / ${entries.length} 个软件包 · 已安装 ${installedCount} 个`);

  const install = (source: string) => {
    setPendingSource(source);
    void controller.installPackage(source).finally(() => setPendingSource(''));
  };

  return (
    <>
      <section className="pane-section flush">
        <div className="catalog-toolbar">
          <form className="catalog-search-wrap" onSubmit={(event) => { event.preventDefault(); void controller.searchPackages(query); }}>
            <Search size={14} />
            <input type="search" className="catalog-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索官方 Pi 软件包，回车确认" aria-label="搜索 Pi 软件包" />
          </form>
          <button className="catalog-icon-btn" type="button" title="刷新软件包" aria-label="刷新软件包" disabled={snapshot.packagesLoading || snapshot.packageSearchLoading} onClick={() => { void controller.loadPackages(true); void controller.searchPackages(query); }}>
            <RotateCw size={14} />
          </button>
        </div>
        <div className="catalog-filters">
          {types.map((value) => (
            <button className={`catalog-filter${filter === value ? ' active' : ''}`} type="button" key={value} onClick={() => setFilter(value)}>
              {({ All: '全部', Installed: `已安装${installedCount ? ` ${installedCount}` : ''}` } as Record<string, string>)[value] || value}
            </button>
          ))}
        </div>
        <div className={`catalog-status${snapshot.packageSearchError || snapshot.packageError ? ' border-[color-mix(in_srgb,var(--error)_28%,var(--border))]! text-error! whitespace-normal!' : ''}`}>{status}</div>
        <div className="catalog-list">
          {visible.map((item) => (
            <PackageRow
              item={item}
              key={item.key || item.source}
              installing={snapshot.packageInstalling && pendingSource === item.source}
              busy={snapshot.packageInstalling}
              removing={snapshot.packageRemovingSource === item.source}
              onInstall={() => install(item.source)}
            />
          ))}
          {!snapshot.packagesLoading && !snapshot.packageSearchLoading && visible.length === 0 ? (
            <div className="catalog-empty">{filter === 'Installed' ? '尚未安装全局 Pi 软件包。' : '没有符合当前筛选条件的软件包。'}</div>
          ) : null}
        </div>
      </section>

      <section className="pane-section">
        <div className="pane-section-head">
          <div>
            <div className="pane-section-title">手动添加</div>
            <p className="pane-section-note">目录里没有的来源：npm 包名、Git 仓库或本地路径。</p>
          </div>
        </div>
        <form className="flex gap-2 max-compact:flex-col" onSubmit={(event) => { event.preventDefault(); const source = packageSource.trim(); if (!source) return; install(source); setPackageSource(''); }}>
          <input className="settings-text-input min-w-0 flex-1" value={packageSource} onChange={(event) => setPackageSource(event.target.value)} placeholder="npm:包名、git:github.com/用户/仓库或本地路径" aria-label="Pi 软件包来源" />
          <button className="settings-action-btn primary" type="submit" disabled={!packageSource.trim() || snapshot.packageInstalling}>{snapshot.packageInstalling ? '正在安装…' : '安装软件包'}</button>
        </form>
        <p className="mt-2.5 mb-0 text-[11px] leading-[1.55] text-warning">第三方软件包可执行扩展代码。请仅安装你信任的来源。</p>
      </section>
    </>
  );
}

const emptyPromptDraft = { scope: 'user' as 'user' | 'project', name: '', description: '', argumentHint: '', body: '', optimize: false, originalPath: '' };

function scopeLabel(scope: string): string {
  return ({ user: '全局', project: '项目', package: '软件包' } as Record<string, string>)[scope] || scope;
}

function PromptRow({
  template,
  busy,
  inUse,
  onEdit,
  onDelete,
}: {
  template: PiPromptTemplate;
  busy: boolean;
  inUse?: boolean;
  onEdit(): void;
  onDelete(): void;
}) {
  return (
    <div className="catalog-row">
      <div className="catalog-main">
        <div className="catalog-title-row">
          <div className="catalog-name font-mono text-[12px]">/{template.name}</div>
          {inUse ? <span className="flex-none font-mono text-[10px] text-accent-text">使用中</span> : null}
          {template.argumentHint ? <span className="flex-none font-mono text-[10px] text-accent-text">{template.argumentHint}</span> : null}
          <span className={`catalog-tag${template.editable ? '' : ' warn'}`}>{scopeLabel(template.scope)}</span>
        </div>
        <div className="catalog-description">{template.description || '该模板没有提供描述。'}</div>
        <div className="catalog-meta">
          <span className="catalog-meta-item" title={template.filePath}>{template.filePath}</span>
          {template.scope === 'package' ? <span className="catalog-meta-item">{template.origin}</span> : null}
        </div>
      </div>
      <div className="catalog-actions">
        <button className="catalog-action" type="button" onClick={onEdit}>{template.editable ? '编辑' : '查看'}</button>
        {template.editable ? (
          <button
            className="catalog-action danger"
            type="button"
            disabled={busy}
            onClick={() => {
              void confirmDialog({ title: `删除提示模板 /${template.name}？`, detail: template.filePath }).then((ok) => {
                if (ok) onDelete();
              });
            }}
          >删除</button>
        ) : null}
      </div>
    </div>
  );
}

function PromptsView({ snapshot, mode = 'prompts' }: { snapshot: AppSnapshot; mode?: 'prompts' | 'optimize' }) {
  const [draft, setDraft] = useState<typeof emptyPromptDraft | null>(null);
  const [readOnlyPath, setReadOnlyPath] = useState('');
  const [query, setQuery] = useState('');
  const templates = snapshot.prompts?.templates || [];
  const projectDir = snapshot.prompts?.projectDir;
  // One catalog, two managers: rewrite instructions live in the dedicated
  // 「输入优化」 tab, regular /name templates in the general one.
  const optimizeCount = templates.filter((template) => template.optimize).length;
  const ownTemplates = mode === 'optimize'
    ? templates.filter((template) => template.optimize)
    : templates.filter((template) => !template.optimize);
  const visible = ownTemplates.filter((template) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${template.name} ${template.description}`.toLowerCase().includes(needle);
  });
  // The composer remembers the last picked optimizer; surface it in the list.
  const activeOptimizer = mode === 'optimize' ? readOptimizeTemplatePref() : '';
  // Break the count down so package-provided templates do not look like a bug.
  const ownCount = ownTemplates.filter((template) => template.editable).length;
  const packageOrigins = new Set(ownTemplates.filter((template) => template.scope === 'package').map((template) => template.origin));
  const promptSummary = [
    `${ownCount} 个自建`,
    packageOrigins.size ? `${ownTemplates.length - ownCount} 个来自软件包（${[...packageOrigins].join('、')}）` : '',
    mode === 'optimize' ? '在输入框「优化」按钮旁的菜单中切换使用' : '输入 /名称 即可调用',
    mode === 'prompts' && optimizeCount ? `${optimizeCount} 个输入优化模板在「输入优化」页管理` : '',
  ].filter(Boolean).join(' · ');

  const openEditor = (template?: PiPromptTemplate) => {
    setReadOnlyPath(template && !template.editable ? template.filePath : '');
    setDraft(
      template
        ? {
            scope: template.scope === 'project' ? 'project' : 'user',
            name: template.name,
            description: template.description,
            argumentHint: template.argumentHint || '',
            body: template.body,
            optimize: template.optimize === true,
            originalPath: template.editable ? template.filePath : '',
          }
        : { ...emptyPromptDraft, optimize: mode === 'optimize' },
    );
  };

  const save = async () => {
    if (!draft) return;
    const saved = await controller.savePrompt({
      scope: draft.scope,
      name: draft.name,
      description: draft.description,
      argumentHint: draft.argumentHint,
      body: draft.body,
      optimize: mode === 'optimize' || draft.optimize,
      originalPath: draft.originalPath,
    });
    if (saved) setDraft(null);
  };

  if (draft) {
    const readOnly = Boolean(readOnlyPath);
    return (
      <section className="pane-section">
        <div className="pane-section-head">
          <div>
            <div className="pane-section-title">{readOnly ? `查看 /${draft.name}` : draft.originalPath ? `编辑 /${draft.name}` : mode === 'optimize' ? '新建输入优化模板' : '新建提示模板'}</div>
            <p className="pane-section-note">
              {readOnly
                ? `该模板来自${scopeLabel(templates.find((item) => item.filePath === readOnlyPath)?.scope || 'package')}，只能查看。`
                : mode === 'optimize'
                  ? '正文即改写指令：正文中的 {{input}} 会被替换为输入框当前内容，未使用时输入会自动附在正文之后。'
                  : '文件名即命令名。正文支持 $1、$@/$ARGUMENTS、${1:-默认值} 与 ${@:2} 等参数占位符。'}
            </p>
          </div>
          <button className="settings-action-btn" type="button" onClick={() => setDraft(null)}>返回列表</button>
        </div>
        <div className="prompt-editor">
          <label className="prompt-field">
            <span>命令名</span>
            <input
              className="settings-text-input font-mono"
              value={draft.name}
              disabled={readOnly}
              placeholder="review"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <small>调用方式：/{draft.name.trim().replace(/^\//, '') || 'name'}</small>
          </label>
          <div className="prompt-field">
            <span>保存位置</span>
            <Select
              ariaLabel="保存位置"
              value={draft.scope}
              disabled={readOnly}
              options={[
                { value: 'user', label: `全局 · ${snapshot.prompts?.userDir || '~/.pi/agent/prompts'}` },
                {
                  value: 'project',
                  disabled: !projectDir || !snapshot.prompts?.projectTrusted,
                  label: `项目 · ${projectDir ? (snapshot.prompts?.projectTrusted ? projectDir : `${projectDir}（项目尚未信任）`) : '需要先打开一个项目'}`,
                },
              ]}
              onChange={(value) => setDraft({ ...draft, scope: value as 'user' | 'project' })}
            />
          </div>
          <label className="prompt-field">
            <span>描述</span>
            <input
              className="settings-text-input disabled:cursor-default disabled:opacity-[0.68]"
              value={draft.description}
              disabled={readOnly}
              placeholder="留空时 Pi 会取正文第一行"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          {mode === 'prompts' ? (
            <label className="prompt-field">
              <span>参数提示</span>
              <input
                className="settings-text-input font-mono disabled:cursor-default disabled:opacity-[0.68]"
                value={draft.argumentHint}
                disabled={readOnly}
                placeholder="<必填参数> [可选参数]"
                onChange={(event) => setDraft({ ...draft, argumentHint: event.target.value })}
              />
              <small>显示在斜杠命令补全里，尖括号表示必填、方括号表示可选。</small>
            </label>
          ) : null}
          <label className="prompt-field wide">
            <span>正文</span>
            <textarea
              className="settings-text-input min-h-[220px] resize-y px-[11px] py-2.5 leading-[1.65] font-mono disabled:cursor-default disabled:opacity-[0.68]"
              value={draft.body}
              disabled={readOnly}
              rows={14}
              placeholder={mode === 'optimize'
                ? '精简改写下述输入，保持原意、不要扩写：\n{{input}}'
                : '审查已暂存的改动（`git diff --cached`），重点关注：\n- 逻辑错误\n- 安全问题'}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </label>
        </div>
        {snapshot.promptError ? <div className="catalog-status border-[color-mix(in_srgb,var(--error)_28%,var(--border))]! text-error! whitespace-normal!">{snapshot.promptError}</div> : null}
        {!readOnly ? (
          <div className="mt-[13px] flex justify-end">
            <button
              className="settings-action-btn primary"
              type="button"
              disabled={!draft.name.trim() || !draft.body.trim() || snapshot.promptSaving}
              onClick={() => void save()}
            >{snapshot.promptSaving ? '正在保存…' : mode === 'optimize' ? '保存优化模板' : '保存模板'}</button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <>
      <section className="pane-section flush">
        <div className="catalog-toolbar">
          <div className="catalog-search-wrap">
            <Search size={14} />
            <input type="search" className="catalog-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === 'optimize' ? '搜索优化模板' : '搜索提示模板'} aria-label={mode === 'optimize' ? '搜索优化模板' : '搜索提示模板'} />
          </div>
          <button className="catalog-icon-btn" type="button" title="刷新模板" aria-label="刷新模板" disabled={snapshot.promptsLoading} onClick={() => void controller.loadPrompts(true)}>
            <RotateCw size={14} />
          </button>
          <button className="catalog-action primary" type="button" onClick={() => openEditor()}>{mode === 'optimize' ? '新建优化模板' : '新建模板'}</button>
        </div>
        <div className={`catalog-status${snapshot.promptError ? ' error' : ''}`}>
          {snapshot.promptError || (snapshot.promptsLoading ? '正在加载提示模板…' : promptSummary)}
        </div>
        <div className="catalog-list">
          {mode === 'optimize' ? (
            <div className="catalog-row">
              <div className="catalog-main">
                <div className="catalog-title-row">
                  <div className="catalog-name font-mono text-[12px]">默认优化</div>
                  {!activeOptimizer ? <span className="flex-none font-mono text-[10px] text-accent-text">使用中</span> : null}
                  <span className="catalog-tag warn">内置</span>
                </div>
                <div className="catalog-description">{DEFAULT_OPTIMIZE_INSTRUCTION}</div>
                <div className="catalog-meta">
                  <span className="catalog-meta-item">未选择自定义模板时使用；内置指令随应用提供，不可编辑或删除。</span>
                </div>
              </div>
            </div>
          ) : null}
          {visible.map((template) => (
            <PromptRow
              key={template.filePath}
              template={template}
              busy={snapshot.promptSaving}
              inUse={activeOptimizer === template.name}
              onEdit={() => openEditor(template)}
              onDelete={() => void controller.deletePrompt(template.filePath)}
            />
          ))}
          {!snapshot.promptsLoading && visible.length === 0 ? (
            <div className="catalog-empty">{query.trim()
              ? (mode === 'optimize' ? '没有匹配的优化模板。' : '没有匹配的提示模板。')
              : (mode === 'optimize' ? '还没有自定义优化模板。新建一个，之后在输入框「优化」按钮旁的菜单中选择。' : '还没有提示模板。新建一个，之后在输入框里用 /名称 调用。')}</div>
          ) : null}
        </div>
      </section>

      <section className="pane-section">
        <div className="pane-section-head">
          <div>
            <div className="pane-section-title">Pi 从哪里加载模板</div>
            <p className="pane-section-note">目录扫描不递归，只读取 <code>.md</code> 文件。</p>
          </div>
        </div>
        <ul className="m-0 list-none p-0">
          <li className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-2.5 border-b border-b-line py-1.5 last:border-b-0"><span className="text-[10px] text-dim">全局</span><code className="overflow-hidden font-mono text-[10px] leading-[1.6] text-secondary text-ellipsis whitespace-nowrap">{snapshot.prompts?.userDir || '~/.pi/agent/prompts'}</code></li>
          <li className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-2.5 border-b border-b-line py-1.5 last:border-b-0">
            <span className="text-[10px] text-dim">项目</span>
            <code className="overflow-hidden font-mono text-[10px] leading-[1.6] text-secondary text-ellipsis whitespace-nowrap">{projectDir || '<项目>/.pi/prompts'}{snapshot.prompts && !snapshot.prompts.projectTrusted ? '（项目尚未信任，Pi 不会加载）' : ''}</code>
          </li>
          <li className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-2.5 border-b border-b-line py-1.5 last:border-b-0"><span className="text-[10px] text-dim">软件包</span><code className="overflow-hidden font-mono text-[10px] leading-[1.6] text-secondary text-ellipsis whitespace-nowrap">settings.json 里 packages 声明的包：pi.prompts 或 prompts/ 目录</code></li>
        </ul>
        <p className="pane-section-note">
          settings.json 的 <code>prompts</code> 数组不是额外来源，而是对上面前两项的启用/禁用过滤器（只有 <code>!</code>、<code>+</code>、<code>-</code> 前缀的条目生效）。
        </p>
      </section>
    </>
  );
}

export function CustomizationView({ snapshot }: { snapshot: AppSnapshot }) {
  // A composer menu item can request this pane with the optimizer tab up;
  // consumePendingCustomizationTab() is that one-shot request (or null).
  const [tab, setTab] = useState<'extensions' | 'packages' | 'prompts' | 'optimize' | 'automations'>(() => controller.consumePendingCustomizationTab() || 'extensions');
  const extensionCount = snapshot.extensions?.extensions.length || 0;
  const packageCount = snapshot.packages?.packages.length || 0;
  const promptTemplates = snapshot.prompts?.templates || [];
  const promptCount = promptTemplates.filter((template) => !template.optimize).length;
  const optimizeCount = promptTemplates.filter((template) => template.optimize).length;
  const tabs = [
    { id: 'extensions' as const, label: '扩展', count: extensionCount, subtitle: '为 Pi 添加独立扩展，安装后在下次会话生效。' },
    { id: 'packages' as const, label: '软件包', count: packageCount, subtitle: '安装包含扩展、技能、提示模板和主题的软件包。' },
    { id: 'prompts' as const, label: '提示模板', count: promptCount, subtitle: '把常用提示存成 Markdown 模板，在输入框里用 /名称 调用。' },
    { id: 'optimize' as const, label: '输入优化', count: optimizeCount, subtitle: '管理输入框「AI 优化输入」的改写指令模板，正文支持 {{input}} 占位符。' },
    { id: 'automations' as const, label: '定时任务', count: snapshot.automations.length, subtitle: '让 Pi 按计划自己跑：每日简报、依赖检查、CI 失败分析。结果写进对应项目的会话。' },
  ];
  const current = tabs.find((item) => item.id === tab) || tabs[0];
  return (
    <section className="absolute inset-x-0 top-(--header-height) bottom-0 z-20 overflow-auto bg-canvas pt-[26px] pb-12 px-[clamp(16px,3vw,36px)] max-compact:pt-[30px] max-compact:pb-[50px] max-compact:px-[14px]" aria-label="定制">
      <div className="pane-layout">
        <nav className="pane-nav" aria-label="定制内容">
          <div className="pane-nav-title">定制</div>
          {tabs.map((item) => (
            <button
              className={`pane-nav-item${tab === item.id ? ' bg-accent-subtle! text-accent-text! [font-weight:680]! before:absolute! before:inset-y-[7px]! before:left-0! before:w-0.5! before:rounded-r-[2px]! before:bg-accent! before:content-[""] max-narrow:border-[color-mix(in_srgb,var(--accent)_38%,var(--border))]! max-narrow:before:hidden!' : ''}`}
              type="button"
              key={item.id}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              <span>{item.label}</span>
              {item.count ? <span className={`pane-nav-count${tab === item.id ? ' text-accent-text! opacity-80' : ''}`}>{item.count}</span> : null}
            </button>
          ))}
        </nav>

        <div className="pane-content">
          <div className="pane-header">
            <div className="pane-header-copy">
              <h2>{current.label}</h2>
              <p className="pane-header-subtitle">{current.subtitle}</p>
            </div>
            <div className="pane-header-actions">
              <button className="pane-close" type="button" aria-label="关闭定制" title="关闭定制" onClick={() => controller.returnToChat()}><X size={16} /></button>
            </div>
          </div>
          {tab === 'extensions' ? <ExtensionsView snapshot={snapshot} /> : null}
          {tab === 'packages' ? <PackagesView snapshot={snapshot} /> : null}
          {tab === 'prompts' ? <PromptsView snapshot={snapshot} /> : null}
          {tab === 'optimize' ? <PromptsView snapshot={snapshot} mode="optimize" /> : null}
          {tab === 'automations' ? <AutomationsView snapshot={snapshot} /> : null}
        </div>
      </div>
    </section>
  );
}

function newAutomation(projectPath: string): Automation {
  return {
    id: `auto-${Date.now().toString(36)}`,
    name: '每日代码简报',
    prompt: '总结这个项目今天的改动，指出值得注意的风险。',
    projectPath,
    kind: 'daily',
    minutes: 60,
    time: '09:30',
    enabled: true,
    lastRunAt: 0,
    lastStatus: '',
  };
}

function automationStatus(item: Automation): string {
  if (!item.lastRunAt) return '尚未运行';
  const when = formatRelativeTime(item.lastRunAt);
  return item.lastStatus.startsWith('error') ? `${when} · ${item.lastStatus}` : `${when} · 成功`;
}

/**
 * Scheduled prompts.
 *
 * The app is already resident with a tray and notifications, so the marginal
 * cost of running work on a schedule is small — and "the work was done before
 * you sat down" is something a terminal session structurally cannot offer.
 */
function AutomationsView({ snapshot }: { snapshot: AppSnapshot }) {
  const [draft, setDraft] = useState<Automation[]>(snapshot.automations);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(snapshot.automations);
  }, [dirty, snapshot.automations]);

  const update = (id: string, patch: Partial<Automation>) => {
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setDirty(true);
  };

  const save = async () => {
    if (await controller.saveAutomations(draft)) setDirty(false);
  };

  return (
    <div className="catalog">
      <div className="catalog-toolbar">
        <button
          className="settings-action-btn"
          type="button"
          onClick={() => { setDraft((current) => [...current, newAutomation(snapshot.workspace.noFolder ? '' : snapshot.workspace.path)]); setDirty(true); }}
        >
          新建任务
        </button>
        <button className="settings-action-btn primary" type="button" disabled={!dirty} onClick={() => void save()}>
          {dirty ? '保存' : '已保存'}
        </button>
      </div>

      {draft.length ? draft.map((item) => (
        <div className="mb-3 flex flex-col gap-2 rounded-[12px] border border-line bg-panel p-3" key={item.id}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="settings-text-input min-w-[180px] flex-1"
              value={item.name}
              aria-label="任务名称"
              onChange={(event) => update(item.id, { name: event.target.value })}
            />
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(event) => update(item.id, { enabled: event.target.checked })}
              />
              启用
            </label>
            <button className="settings-action-btn" type="button" onClick={() => void controller.runAutomation(item.id)}>立即运行</button>
            <button
              className="settings-action-btn danger"
              type="button"
              onClick={() => { setDraft((current) => current.filter((entry) => entry.id !== item.id)); setDirty(true); }}
            >
              删除
            </button>
          </div>

          <textarea
            className="w-full resize-y rounded-[8px] border border-line bg-muted p-2 text-xs text-primary outline-0 [font-family:inherit]"
            rows={3}
            value={item.prompt}
            aria-label="任务提示词"
            placeholder="发给 Pi 的提示词"
            onChange={(event) => update(item.id, { prompt: event.target.value })}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Select
              variant="compact"
              className="w-[96px]"
              ariaLabel="调度方式"
              value={item.kind}
              options={[
                { value: 'daily', label: '每天' },
                { value: 'interval', label: '每隔' },
              ]}
              onChange={(value) => update(item.id, { kind: value as Automation['kind'] })}
            />
            {item.kind === 'daily' ? (
              <input
                className="settings-text-input w-[96px] shrink-0"
                value={item.time}
                aria-label="运行时间"
                placeholder="09:30"
                onChange={(event) => update(item.id, { time: event.target.value })}
              />
            ) : (
              <input
                className="settings-text-input w-[96px] shrink-0"
                type="number"
                min={1}
                value={item.minutes}
                aria-label="间隔分钟数"
                onChange={(event) => update(item.id, { minutes: Number(event.target.value) || 1 })}
              />
            )}
            {item.kind === 'interval' ? <span className="text-[11px] text-dim">分钟</span> : null}
            <input
              className="settings-text-input min-w-[200px] flex-1"
              value={item.projectPath}
              aria-label="项目路径"
              placeholder="项目路径（留空表示当前项目）"
              onChange={(event) => update(item.id, { projectPath: event.target.value })}
            />
          </div>
          <div className="text-[10px] text-dim">{automationStatus(item)}</div>
        </div>
      )) : <div className="settings-help">还没有定时任务。新建一个，让 Pi 每天早上先把简报准备好。</div>}
      <p className="settings-help">任务会启动（或复用）对应项目的 Pi 进程并发送提示词；PiCode 关闭时不会执行。</p>
    </div>
  );
}

function PackageRow({
  item,
  installing,
  busy,
  removing,
  onInstall,
}: {
  item: PackageEntry;
  installing: boolean;
  busy: boolean;
  removing: boolean;
  onInstall(): void;
}) {
  const meta = [
    item.packageType,
    item.downloads ? `${item.downloads} 次下载` : '',
    item.installed ? item.source : '',
  ].filter(Boolean);
  return (
    <div className={`catalog-row${item.installed ? ' installed' : ''}`}>
      <div className="catalog-main">
        <div className="catalog-title-row">
          <div className="catalog-name font-mono text-[12px]" title={item.source}>{item.name}</div>
          {item.installed ? <span className="catalog-tag ok">已安装{item.version ? ` v${item.version}` : ''}</span> : null}
          {item.installed && !item.enabled ? <span className="catalog-tag warn">已禁用</span> : null}
        </div>
        <div className="catalog-description">{item.description || '该软件包没有提供简介。'}</div>
        {meta.length ? (
          <div className="catalog-meta">
            {meta.map((value) => <span className="catalog-meta-item" key={value}>{value}</span>)}
          </div>
        ) : null}
      </div>
      {item.installed ? (
        <button
          className="catalog-action danger"
          type="button"
          disabled={removing}
          onClick={() => {
            void confirmDialog({ title: `移除 Pi 软件包“${item.source}”？`, confirmLabel: '移除' }).then((ok) => {
              if (ok) void controller.removePackage(item.source);
            });
          }}
        >
          {removing ? '正在移除…' : '移除'}
        </button>
      ) : (
        <button className="catalog-action" type="button" disabled={busy} onClick={onInstall}>
          {installing ? <span>正在安装…</span> : <><Download size={14} /><span>安装</span></>}
        </button>
      )}
    </div>
  );
}
