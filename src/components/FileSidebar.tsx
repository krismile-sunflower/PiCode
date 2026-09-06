import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { apiJson, postJson } from '../lib/desktop';
import type { AppSnapshot, FileAttachment, GitChange, GitChangeArea, PlanSessionState, PlanStep, TimelineItem, ToolExecution } from '../lib/types';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileText,
  Folder,
  Plus,
  RotateCw,
  X,
} from 'lucide-react';
import { DiffView } from './DiffView';
import { controller } from '../app/controller';
import { canExecutePlan, formatPlanSteps, parsePlanSteps } from '../app/plan-state';

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  mtime?: number;
}

interface FileListResponse {
  path: string;
  items: FileItem[];
}

interface FileContentResponse {
  path: string;
  name: string;
  kind: 'text' | 'image' | 'unsupported';
  mimeType: string;
  size: number;
  content?: string;
  truncated: boolean;
  language: string;
  reason?: string;
}

interface GitChangeTreeNode {
  name: string;
  path: string;
  change?: GitChange;
  children: Map<string, GitChangeTreeNode>;
}

type WorkspaceTab = 'plan' | 'changes' | 'files' | 'terminal';
type PlanSurface = 'idle' | 'planning' | 'blocked-review' | 'execution' | 'result';

const workspaceTabOrder: readonly WorkspaceTab[] = ['plan', 'changes', 'files', 'terminal'];

interface FileSidebarProps {
  rootPath: string;
  open: boolean;
  snapshot: AppSnapshot;
  /** Incremented when the plan summary should be made visible without editing. */
  planTabRequest?: number;
  onClose(): void;
  onInsert(file: FileAttachment): void;
}

function formatSize(size?: number): string {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function formatPreviewText(content: string, name: string, language: string, truncated = false): string {
  const isJson = language.toLowerCase() === 'json' || name.toLowerCase().endsWith('.json');
  if (!isJson || truncated || !content.trim()) return content;

  try {
    return JSON.stringify(JSON.parse(content.replace(/^\uFEFF/, '')), null, 2);
  } catch {
    return content;
  }
}

function fileBadge(item: FileItem): string {
  const extension = item.name.split('.').pop()?.toLowerCase();
  const labels: Record<string, string> = {
    ts: 'TS', tsx: 'TS', js: 'JS', jsx: 'JS', rs: 'RS', py: 'PY', json: '{}', md: 'MD', css: '#', html: '<>', toml: 'T', yaml: 'Y', yml: 'Y',
  };
  return labels[extension || ''] || '·';
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

function buildGitChangeTree(changes: GitChange[]): GitChangeTreeNode {
  const root: GitChangeTreeNode = { name: '', path: '', children: new Map() };
  for (const change of changes) {
    const parts = change.path.replace(/\\/g, '/').split('/').filter(Boolean);
    let current = root;
    parts.forEach((name, index) => {
      const path = current.path ? `${current.path}/${name}` : name;
      let node = current.children.get(name);
      if (!node) {
        node = { name, path, children: new Map() };
        current.children.set(name, node);
      }
      if (index === parts.length - 1) node.change = change;
      current = node;
    });
  }
  return root;
}

function latestUserRequest(timeline: TimelineItem[]): string {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.kind === 'message' && item.message.role === 'user' && item.message.content.trim()) return item.message.content;
  }
  return '';
}

function isTerminalTool(tool: ToolExecution): boolean {
  return /(?:command|terminal|shell|powershell|bash|exec|run)/i.test(tool.toolName);
}

function terminalCommand(tool: ToolExecution): string {
  for (const key of ['command', 'cmd', 'script', 'input']) {
    const value = tool.args[key];
    if (typeof value === 'string' && value) return value;
  }
  return tool.toolName;
}

function planStatusLabel(status: PlanStep['status']): string {
  return { pending: '待办', in_progress: '进行中', complete: '完成', blocked: '受阻' }[status];
}

function planSurface(plan: PlanSessionState): PlanSurface {
  if (plan.phase === 'executing') return 'execution';
  if (plan.phase === 'complete') return 'result';
  if (plan.phase === 'review' && plan.steps.some((step) => step.status === 'blocked')) return 'blocked-review';
  if (plan.phase === 'plan' || plan.phase === 'review') return 'planning';
  return 'idle';
}

function planTabLabel(surface: PlanSurface): string {
  return surface === 'execution' ? '执行' : surface === 'result' ? '结果' : '计划';
}

function planPanelPath(surface: PlanSurface): string {
  return surface === 'execution' ? '执行进度' : surface === 'result' ? '执行结果' : surface === 'idle' ? '当前任务概览' : '当前计划';
}

function planStateMessage(surface: PlanSurface, streaming: boolean): string {
  if (surface === 'planning') return streaming ? 'Agent 正在整理计划' : '计划可编辑，确认后再开始执行';
  if (surface === 'blocked-review') return '有步骤受阻，请调整计划后重新确认';
  if (surface === 'execution') return streaming ? 'Agent 正在执行' : '执行进度已同步到当前会话';
  if (surface === 'result') return '执行已完成，可查看结果记录';
  return '切换到计划模式后，Agent 会先整理可确认的实施步骤';
}

function currentPlanStep(plan: PlanSessionState): { step: PlanStep; index: number } | null {
  const activeIndex = plan.steps.findIndex((step) => step.status === 'in_progress');
  const pendingIndex = plan.steps.findIndex((step) => step.status === 'pending');
  const index = activeIndex >= 0 ? activeIndex : pendingIndex;
  return index >= 0 ? { step: plan.steps[index]!, index } : null;
}

const TASK_PLAN_STATUS_CLASSES: Record<PlanStep['status'], { badge: string; label: string; title: string }> = {
  pending: { badge: 'border-ghost text-dim', label: 'text-dim', title: 'text-secondary' },
  in_progress: { badge: 'border-accent text-accent-text', label: 'text-accent-text', title: 'text-secondary' },
  complete: { badge: 'border-success bg-success text-solid', label: 'text-success', title: 'text-dim line-through' },
  blocked: { badge: 'border-error text-error', label: 'text-error', title: 'text-secondary' },
};

function PlanStepList({ steps, label }: { steps: readonly PlanStep[]; label: string }) {
  return (
    <ol className="m-0 grid list-none gap-1.5 p-0" aria-label={label}>
      {steps.map((item, index) => {
        const status = TASK_PLAN_STATUS_CLASSES[item.status];
        return (
          <li className="grid min-w-0 list-none grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border border-line bg-panel p-2" key={item.id}>
            <span className={`grid h-[21px] w-[21px] place-items-center rounded-full border p-0 font-mono text-[12px] leading-none cursor-default ${status.badge}`} aria-label={planStatusLabel(item.status)}>{item.status === 'complete' ? <Check size={11} /> : item.status === 'blocked' ? <CircleAlert size={11} /> : index + 1}</span>
            <span className="grid min-w-0 gap-[3px]"><span className={`overflow-visible text-[12px] leading-[1.4] whitespace-normal ${status.title}`}>{item.title}</span>{item.detail ? <small className="overflow-hidden text-[12px] leading-[1.35] text-dim text-ellipsis whitespace-nowrap">{item.detail}</small> : null}</span>
            <span className={`whitespace-nowrap text-[12px] ${status.label}`}>{planStatusLabel(item.status)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function FileSidebar({ rootPath, open, snapshot, planTabRequest = 0, onClose, onInsert }: FileSidebarProps) {
  const [itemsByPath, setItemsByPath] = useState<Record<string, FileItem[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<FileContentResponse | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('files');
  const [expandedChangePaths, setExpandedChangePaths] = useState<Set<string>>(new Set());
  const [gitCommitMessage, setGitCommitMessage] = useState('');
  const [gitAction, setGitAction] = useState<'pull' | 'commit' | 'push' | 'stage' | 'unstage' | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanSessionState>(snapshot.plan);
  const [planTextDraft, setPlanTextDraft] = useState(() => formatPlanSteps(snapshot.plan.steps));
  const [planSaving, setPlanSaving] = useState(false);
  const planDraftRecovery = useRef<{ goal: string; text: string; updatedAt: string; sessionFile: string | null } | null>(null);
  const workspaceTabButtons = useRef(new Map<WorkspaceTab, HTMLButtonElement>());

  const load = async (path: string) => {
    if (!path) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiJson<FileListResponse>(`/api/files?path=${encodeURIComponent(path)}`);
      setItemsByPath((current) => ({ ...current, [path]: data.items || [] }));
    } catch (value) {
      setError(String(value));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setItemsByPath({});
    setExpanded(new Set());
    setPreview(null);
    if (open && rootPath) void load(rootPath);
  }, [open, rootPath]);

  useEffect(() => {
    if (open && rootPath && (tab === 'changes' || snapshot.plan.phase === 'complete')) void controller.loadGitStatus();
  }, [open, rootPath, snapshot.plan.phase, tab]);

  useEffect(() => {
    const recovery = planDraftRecovery.current;
    if (recovery && recovery.updatedAt === snapshot.plan.updatedAt && recovery.sessionFile === snapshot.selectedSessionFile) {
      setPlanDraft({ ...snapshot.plan, goal: recovery.goal });
      setPlanTextDraft(recovery.text);
      planDraftRecovery.current = null;
      return;
    }
    setPlanDraft(snapshot.plan);
    setPlanTextDraft(formatPlanSteps(snapshot.plan.steps));
  }, [snapshot.plan, snapshot.selectedSessionFile]);

  useEffect(() => {
    if (!planTabRequest) return;
    setTab('plan');
  }, [planTabRequest]);

  const rootItems = itemsByPath[rootPath] || [];
  const stagedGitChanges = useMemo(() => (snapshot.gitStatus?.changes || []).filter(isStagedGitChange), [snapshot.gitStatus?.changes]);
  const unstagedGitChanges = useMemo(() => (snapshot.gitStatus?.changes || []).filter(isUnstagedGitChange), [snapshot.gitStatus?.changes]);
  const stagedGitChangeTree = useMemo(() => buildGitChangeTree(stagedGitChanges), [stagedGitChanges]);
  const unstagedGitChangeTree = useMemo(() => buildGitChangeTree(unstagedGitChanges), [unstagedGitChanges]);
  const taskRequest = useMemo(() => snapshot.plan.goal || latestUserRequest(snapshot.timeline), [snapshot.plan.goal, snapshot.timeline]);
  const toolCount = useMemo(() => snapshot.timeline.filter((item) => item.kind === 'tool').length, [snapshot.timeline]);
  const terminalTools = useMemo(() => snapshot.timeline.filter((item): item is Extract<TimelineItem, { kind: 'tool' }> => item.kind === 'tool').map((item) => item.tool).filter(isTerminalTool).reverse(), [snapshot.timeline]);
  const plan = snapshot.plan;
  const taskSurface = planSurface(plan);
  const taskTabLabel = planTabLabel(taskSurface);
  const planText = formatPlanSteps(plan.steps);
  const completedPlanCount = plan.steps.filter((item) => item.status === 'complete').length;
  const activePlanStep = currentPlanStep(plan);
  const blockedPlanSteps = plan.steps.filter((item) => item.status === 'blocked');
  const canEditPlan = !snapshot.isStreaming && (taskSurface === 'planning' || taskSurface === 'blocked-review');
  const hasUnsavedPlanChanges = planDraft.goal !== plan.goal || planTextDraft !== planText;
  const gitBusy = snapshot.gitLoading || Boolean(gitAction);
  const fileChangeCount = snapshot.gitLoading ? '...' : snapshot.gitStatus ? snapshot.gitStatus.changes.length : '—';
  const fileChangeLabel = snapshot.gitLoading ? '正在读取文件变更' : snapshot.gitError ? '文件变更暂不可用' : '当前文件变更';
  const savePlan = async () => {
    if (!canEditPlan || planSaving || !hasUnsavedPlanChanges) return;
    const draft = { goal: planDraft.goal, text: planTextDraft, updatedAt: plan.updatedAt, sessionFile: snapshot.selectedSessionFile };
    const steps = parsePlanSteps(planTextDraft, planDraft.steps);
    const goal = planDraft.goal.trim();
    planDraftRecovery.current = draft;
    setPlanSaving(true);
    try {
      const saved = await controller.updatePlan({ goal, steps });
      if (saved) {
        planDraftRecovery.current = null;
        setPlanDraft((current) => ({ ...current, goal, steps }));
        setPlanTextDraft(formatPlanSteps(steps));
      } else {
        setPlanDraft((current) => ({ ...current, goal: draft.goal }));
        setPlanTextDraft(draft.text);
      }
    } finally {
      setPlanSaving(false);
    }
  };
  const registerWorkspaceTab = (name: WorkspaceTab) => (node: HTMLButtonElement | null) => {
    if (node) workspaceTabButtons.current.set(name, node);
    else workspaceTabButtons.current.delete(name);
  };
  const handleWorkspaceTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = workspaceTabOrder.indexOf(tab);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % workspaceTabOrder.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + workspaceTabOrder.length) % workspaceTabOrder.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = workspaceTabOrder.length - 1;
    else return;
    event.preventDefault();
    const nextTab = workspaceTabOrder[next]!;
    setTab(nextTab);
    workspaceTabButtons.current.get(nextTab)?.focus();
  };
  const runGitAction = async (action: 'pull' | 'commit' | 'push' | 'stage' | 'unstage', operation: () => Promise<boolean>) => {
    setGitAction(action);
    try {
      const completed = await operation();
      if (completed && action === 'commit') setGitCommitMessage('');
    } finally {
      setGitAction(null);
    }
  };

  const openPreview = async (item: FileItem) => {
    try {
      const content = await apiJson<FileContentResponse>(`/api/file/content?path=${encodeURIComponent(item.path)}`);
      setPreview(content);
    } catch (value) {
      setError(String(value));
    }
  };

  const insert = (item: FileItem) => {
    const ext = item.name.split('.').pop()?.toLowerCase() || '';
    onInsert({ path: item.path, name: item.name, ext });
  };

  const toggleDirectory = async (item: FileItem) => {
    const willExpand = !expanded.has(item.path);
    setExpanded((current) => {
      const next = new Set(current);
      if (willExpand) next.add(item.path); else next.delete(item.path);
      return next;
    });
    if (willExpand && !itemsByPath[item.path]) await load(item.path);
  };

  const renderItems = (items: FileItem[], depth: number): React.ReactNode =>
    items.map((item) => {
      const isExpanded = expanded.has(item.path);
      return (
        <div key={item.path}>
          <div
            className="group relative grid min-h-8 cursor-pointer grid-cols-[12px_28px_minmax(0,1fr)_auto] items-center gap-[5px] my-px select-none rounded-[7px] border border-transparent py-[5px] pr-[7px] hover:bg-glass-hover focus-visible:border-accent focus-visible:bg-glass-hover focus-visible:outline-none active:scale-[0.994]"
            style={{ paddingLeft: 10 + depth * 14 }}
            role="treeitem"
            aria-expanded={item.isDirectory ? isExpanded : undefined}
            tabIndex={0}
            draggable={!item.isDirectory}
            onClick={() => item.isDirectory ? void toggleDirectory(item) : void openPreview(item)}
            onDoubleClick={() => !item.isDirectory && insert(item)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') item.isDirectory ? void toggleDirectory(item) : void openPreview(item);
            }}
            onDragStart={(event) => {
              if (!item.isDirectory) event.dataTransfer.setData('text/plain', item.path);
            }}
          >
            <span className={`inline-flex h-5 w-3 items-center justify-center text-dim transition-transform duration-[var(--duration-fast)] ease-[var(--ease)] group-aria-expanded:rotate-90${item.isDirectory ? '' : ' invisible'}`} aria-hidden="true">{item.isDirectory ? <ChevronRight size={11} /> : null}</span>
            <span className="w-7 flex-none text-center font-mono text-[8px] leading-none text-dim">{item.isDirectory ? <Folder size={11} /> : fileBadge(item)}</span>
            <span className={`min-w-0 flex-1 overflow-hidden text-[11px] text-ellipsis whitespace-nowrap${item.isDirectory ? ' text-primary font-semibold' : ' text-secondary'}`} title={item.path}>{item.name}</span>
            <span className="flex-none text-[9px] text-dim group-hover:opacity-0 group-focus-within:opacity-0">{formatSize(item.size)}</span>
            {!item.isDirectory ? (
              <span className="absolute right-1 inline-flex items-center gap-0.5 bg-[linear-gradient(to_right,transparent,var(--bg-elevated)_12px)] pl-3 opacity-0 pointer-events-none transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                <button className="inline-flex h-[25px] w-[25px] items-center justify-center rounded-md border border-transparent bg-elevated p-0 text-dim cursor-pointer hover:border-line-hover hover:text-primary" type="button" title="添加到消息" onClick={(event) => { event.stopPropagation(); insert(item); }}><Plus size={12} /></button>
                <button className="inline-flex h-[25px] w-[25px] items-center justify-center rounded-md border border-transparent bg-elevated p-0 text-dim cursor-pointer hover:border-line-hover hover:text-primary" type="button" title="在 VS Code 中打开" onClick={(event) => { event.stopPropagation(); void postJson('/api/open-editor', { filePath: item.path }); }}><ExternalLink size={12} /></button>
              </span>
            ) : null}
          </div>
          {item.isDirectory && isExpanded ? renderItems(itemsByPath[item.path] || [], depth + 1) : null}
        </div>
      );
    });

  const renderGitChanges = (node: GitChangeTreeNode, depth: number, area: GitChangeArea): React.ReactNode =>
    [...node.children.values()]
      .sort((left, right) => {
        if (Boolean(left.change) !== Boolean(right.change)) return left.change ? 1 : -1;
        return left.name.localeCompare(right.name);
      })
      .map((child) => {
        const isDirectory = !child.change;
        const expansionKey = `${area}:${child.path}`;
        const isExpanded = expandedChangePaths.has(expansionKey);
        if (isDirectory) {
          return (
            <div key={`${area}:${child.path}`}>
              <button
                className="flex min-h-[33px] w-full items-center gap-1.5 border-0 bg-transparent px-2.5 py-[7px] text-left text-[11px] text-secondary cursor-pointer hover:bg-glass-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                type="button"
                style={{ paddingLeft: 10 + depth * 14 }}
                aria-expanded={isExpanded}
                onClick={() => setExpandedChangePaths((current) => {
                  const next = new Set(current);
                  if (next.has(expansionKey)) next.delete(expansionKey); else next.add(expansionKey);
                  return next;
                })}
              >
                <ChevronLeft size={12} className={`flex-none text-dim transition-transform duration-[var(--duration-fast)] ease-[var(--ease)] ${isExpanded ? 'rotate-90' : 'rotate-180'}`} />
                <Folder size={14} />
                <span>{child.name}</span>
              </button>
              {isExpanded ? renderGitChanges(child, depth + 1, area) : null}
            </div>
          );
        }
        const change = child.change!;
        const label = gitAreaChangeLabel(change, area);
        const active = snapshot.selectedGitPath === change.path && snapshot.selectedGitArea === area;
        const actionLabel = area === 'staged' ? `取消暂存 ${change.path}` : `暂存 ${change.path}`;
        return (
          <div className={`flex min-h-[33px] items-center gap-[3px] border-b border-b-[color-mix(in_srgb,var(--border)_72%,transparent)] pl-2.5 pr-1.5 text-secondary hover:bg-glass-hover hover:text-primary${active ? ' bg-glass-hover text-primary' : ''}`} key={`${area}:${change.path}`} style={{ paddingLeft: 10 + depth * 14 }}>
            <button className="flex min-h-8 min-w-0 flex-1 items-center gap-2 border-0 bg-transparent py-[7px] pl-0 pr-[3px] text-left text-inherit outline-none cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent" type="button" onClick={() => void controller.selectGitChange(change.path, area)}>
              <span className="w-[30px] flex-none text-[9px] font-bold text-warning data-[status=新增]:text-success data-[status=删除]:text-error data-[status=重命名]:text-accent" data-status={label}>{label}</span>
              <span className="overflow-hidden font-mono text-[10px] leading-[1.3] text-ellipsis whitespace-nowrap" title={change.path}>{child.name}</span>
            </button>
            <button className="grid h-6 w-6 flex-none place-items-center rounded-[5px] border border-transparent bg-transparent p-0 text-dim opacity-70 cursor-pointer enabled:hover:border-line-hover enabled:hover:bg-elevated enabled:hover:text-accent-text enabled:hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed" type="button" aria-label={actionLabel} title={actionLabel} disabled={gitBusy} onClick={() => void runGitAction(area === 'staged' ? 'unstage' : 'stage', () => area === 'staged' ? controller.unstageGit(gitChangePaths(change)) : controller.stageGit(gitChangePaths(change)))}>
              {area === 'staged' ? <X size={12} /> : <Plus size={12} />}
            </button>
          </div>
        );
      });

  const previewLines = useMemo(() => {
    if (preview?.kind !== 'text') return [];
    return formatPreviewText(preview.content || '', preview.name, preview.language, preview.truncated).split(/\r\n?|\n/);
  }, [preview]);

  return (
    <>
      <div className={`hidden max-narrow:fixed max-narrow:inset-0 max-narrow:z-[300] max-narrow:block max-narrow:bg-[rgba(3,5,9,0.5)] transition-opacity duration-[var(--duration-slow)]${open ? ' max-narrow:opacity-100' : ' max-narrow:opacity-0 max-narrow:pointer-events-none'}`} onClick={onClose} />
      <aside className={`relative z-[120] flex h-full flex-col w-(--file-sidebar-width) min-w-(--file-sidebar-width) border-0 bg-sidebar opacity-100 [backdrop-filter:none] [transition:margin-right_var(--duration-slow)_var(--ease),transform_var(--duration-slow)_var(--ease),opacity_var(--duration-fast)] max-narrow:fixed! max-narrow:top-0 max-narrow:right-0 max-narrow:bottom-0 max-narrow:z-[310] max-narrow:m-0! max-narrow:w-[min(var(--file-sidebar-width),86vw)]! max-narrow:min-w-[min(var(--file-sidebar-width),86vw)]! max-narrow:shadow-lg${open ? ' max-narrow:translate-x-0' : ' -mr-[calc(var(--file-sidebar-width)_+_5px)] pointer-events-none max-narrow:mr-0! max-narrow:translate-x-[102%] max-narrow:pointer-events-auto'}`} aria-label="文件浏览器">
        <div className="flex min-h-(--header-height) items-center gap-2 border-b border-line pl-3.5 pr-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="eyebrow">工作区</span>
            <div className="mt-[3px] flex items-center gap-1" role="tablist" aria-label="工作区视图" aria-orientation="horizontal" onKeyDown={handleWorkspaceTabKeyDown}>
              <button ref={registerWorkspaceTab('plan')} id="file-sidebar-tab-plan" className={`border-0 border-b border-b-transparent bg-transparent px-[3px] py-0.5 text-[11px] font-semibold text-dim cursor-pointer hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent${tab === 'plan' ? ' border-b-accent text-primary' : ''}`} type="button" role="tab" aria-controls="file-sidebar-panel-plan" aria-selected={tab === 'plan'} tabIndex={tab === 'plan' ? 0 : -1} onClick={() => setTab('plan')}>{taskTabLabel}</button>
              <button ref={registerWorkspaceTab('changes')} id="file-sidebar-tab-changes" className={`border-0 border-b border-b-transparent bg-transparent px-[3px] py-0.5 text-[11px] font-semibold text-dim cursor-pointer hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent${tab === 'changes' ? ' border-b-accent text-primary' : ''}`} type="button" role="tab" aria-controls="file-sidebar-panel-changes" aria-selected={tab === 'changes'} tabIndex={tab === 'changes' ? 0 : -1} onClick={() => setTab('changes')}>变更{snapshot.gitStatus?.changes.length ? ` ${snapshot.gitStatus.changes.length}` : ''}</button>
              <button ref={registerWorkspaceTab('files')} id="file-sidebar-tab-files" className={`border-0 border-b border-b-transparent bg-transparent px-[3px] py-0.5 text-[11px] font-semibold text-dim cursor-pointer hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent${tab === 'files' ? ' border-b-accent text-primary' : ''}`} type="button" role="tab" aria-controls="file-sidebar-panel-files" aria-selected={tab === 'files'} tabIndex={tab === 'files' ? 0 : -1} onClick={() => setTab('files')}>文件</button>
              <button ref={registerWorkspaceTab('terminal')} id="file-sidebar-tab-terminal" className={`border-0 border-b border-b-transparent bg-transparent px-[3px] py-0.5 text-[11px] font-semibold text-dim cursor-pointer hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent${tab === 'terminal' ? ' border-b-accent text-primary' : ''}`} type="button" role="tab" aria-controls="file-sidebar-panel-terminal" aria-selected={tab === 'terminal'} tabIndex={tab === 'terminal' ? 0 : -1} onClick={() => setTab('terminal')}>终端{terminalTools.length ? ` ${terminalTools.length}` : ''}</button>
            </div>
          </div>
          <div className="flex items-center">
            {tab === 'files' ? <button className="icon-btn" type="button" title="全部折叠" aria-label="全部折叠" onClick={() => setExpanded(new Set())}><ChevronLeft size={14} className="rotate-90" /></button> : null}
            {tab === 'changes' ? <button className="icon-btn" type="button" title="在主区域打开变更" aria-label="在主区域打开变更" onClick={() => controller.setView('changes')}><FileText size={14} /></button> : null}
            {tab === 'changes' ? <button className="icon-btn" type="button" title="刷新 Git 变更" aria-label="刷新 Git 变更" disabled={gitBusy} onClick={() => void controller.loadGitStatus()}><RotateCw size={14} /></button> : null}
            <button className="icon-btn" type="button" title="在文件管理器中打开" aria-label="在文件管理器中打开" disabled={!rootPath} onClick={() => void postJson('/api/open', { filePath: rootPath })}><Folder size={14} /></button>
            <button className="icon-btn" type="button" title="关闭文件栏" aria-label="关闭文件栏" onClick={onClose}><X size={14} /></button>
          </div>
        </div>
        <div className="mx-2.5 mt-2.5 mb-[5px] rounded-lg border border-line bg-panel px-[9px] py-2 font-mono text-[10px] leading-[1.45] text-dim" title={rootPath}>{tab === 'files' ? rootPath : tab === 'changes' ? snapshot.gitStatus?.branch || rootPath : tab === 'terminal' ? '本次会话命令输出' : planPanelPath(taskSurface)}</div>
        <div className="relative flex min-h-0 flex-1 overflow-hidden p-0">
          {tab === 'plan' ? (
            <div className="h-full min-h-0 overflow-auto bg-sidebar px-[11px] pt-[13px] pb-6" id="file-sidebar-panel-plan" role="tabpanel" aria-labelledby="file-sidebar-tab-plan">
              <div className={`flex items-center gap-[7px] rounded-[var(--radius-sm)] border bg-panel px-[9px] py-2 text-[12px] font-semibold text-secondary${plan.phase === 'plan' || plan.phase === 'review' ? ' border-[color-mix(in_srgb,var(--warning)_30%,var(--border))] text-[color-mix(in_srgb,var(--warning)_82%,var(--text-primary))]' : plan.phase === 'executing' ? ' border-[color-mix(in_srgb,var(--accent)_30%,var(--border))]' : ' border-[color-mix(in_srgb,var(--success)_34%,var(--border))] text-success'}${taskSurface === 'blocked-review' ? ' border-[color-mix(in_srgb,var(--error)_42%,var(--border))]! text-error!' : ''}`}><span className={`h-1.5 w-1.5 rounded-full bg-ghost${snapshot.isStreaming && taskSurface === 'execution' ? ' bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_14%,transparent)] animate-[workbenchPulse_1.2s_ease-in-out_infinite]' : ''}`} /><span>{planStateMessage(taskSurface, snapshot.isStreaming)}</span></div>
              {taskSurface === 'planning' || taskSurface === 'blocked-review' ? (
                <section className="mt-[18px]">
                  <div className="flex items-baseline justify-between gap-2"><span className="mb-[7px] block text-[12px] font-bold tracking-[0.06em] text-dim uppercase">{taskSurface === 'blocked-review' ? '需要处理的计划' : '计划内容'}</span><span className="font-mono text-[12px] leading-none text-dim tabular-nums">{plan.updatedAt === new Date(0).toISOString() ? '当前会话' : '已保存至会话'}</span></div>
                  {taskSurface === 'blocked-review' ? (
                    <div className="mt-2.5 grid min-w-0 gap-[7px] rounded-[7px] border border-[color-mix(in_srgb,var(--error)_38%,var(--border))] bg-[color-mix(in_srgb,var(--error)_7%,var(--bg-panel))] px-2.5 py-[9px]" role="status">
                      <span className="text-[12px] font-bold text-error">受阻步骤</span>
                      <div className="grid gap-[5px]">{blockedPlanSteps.map((item) => <p key={item.id} className="m-0 grid gap-0.5 text-[12px] leading-[1.4] text-secondary"><strong className="text-primary font-semibold">{item.title}</strong>{item.detail ? <small className="text-[11px] text-dim">{item.detail}</small> : null}</p>)}</div>
                    </div>
                  ) : null}
                  <div className="mt-[11px] grid gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_26%,var(--border))] bg-panel p-2.5" aria-label="编辑计划">
                    <label className="grid gap-[5px] text-[12px] font-semibold text-secondary">目标<textarea className="box-border w-full min-h-[58px] resize-y rounded-md border border-line bg-muted px-2 py-[7px] text-[12px] leading-[1.45] text-primary outline-0 focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-subtle)] disabled:opacity-[0.62] disabled:cursor-not-allowed" value={planDraft.goal} disabled={!canEditPlan} onChange={(event) => setPlanDraft((current) => ({ ...current, goal: event.target.value }))} placeholder="这份计划要完成什么？" /></label>
                    <label className="grid gap-[5px] text-[12px] font-semibold text-secondary">计划内容<textarea className="box-border w-full min-h-[220px] resize-y rounded-md border border-line bg-muted px-2 py-[7px] font-mono text-[12px] leading-[1.45] text-primary outline-0 focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-subtle)] disabled:opacity-[0.62] disabled:cursor-not-allowed" value={planTextDraft} disabled={!canEditPlan} onChange={(event) => setPlanTextDraft(event.target.value)} placeholder={'1. 明确目标与范围\n   写明关键约束和验收条件。\n\n2. 制定实施方案'} aria-label="计划内容" /></label>
                    <div className="flex min-w-0 items-center justify-between gap-2.5 max-compact:flex-col max-compact:items-start"><span className="min-w-0 text-[11px] leading-[1.45] text-dim">{planSaving ? '正在保存计划…' : hasUnsavedPlanChanges ? '保存修改后才能开始执行。' : plan.steps.length ? '已保存，可确认开始执行。' : '添加至少一个编号步骤后再保存。'}</span><button className="flex-none min-h-[30px] rounded-[7px] border border-line-hover bg-transparent px-[9px] text-[12px] font-semibold text-secondary cursor-pointer transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] enabled:hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--border))] enabled:hover:bg-glass-hover enabled:hover:text-primary enabled:active:scale-[0.98] disabled:opacity-[0.42] disabled:cursor-not-allowed" type="button" disabled={!canEditPlan || planSaving || !hasUnsavedPlanChanges} onClick={() => void savePlan()}>保存计划</button></div>
                  </div>
                  <div className="mt-[9px] flex flex-wrap gap-1.5">
                    <button type="button" className="min-h-[30px] rounded-[7px] border border-line-hover bg-transparent px-[9px] text-[12px] font-semibold text-secondary cursor-pointer transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] enabled:hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--border))] enabled:hover:bg-glass-hover enabled:hover:text-primary enabled:active:scale-[0.98] disabled:opacity-[0.42] disabled:cursor-not-allowed" disabled={snapshot.isStreaming || planSaving || hasUnsavedPlanChanges} onClick={() => void controller.revisePlan()}>继续规划</button>
                    {plan.phase === 'review' ? <button type="button" className="min-h-[30px] rounded-[7px] border border-[color-mix(in_srgb,var(--accent)_60%,var(--border))] bg-accent-strong px-[9px] text-[12px] font-semibold text-white cursor-pointer transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] enabled:hover:border-accent enabled:hover:bg-accent-hover enabled:hover:text-white enabled:active:scale-[0.98] disabled:opacity-[0.42] disabled:cursor-not-allowed" disabled={snapshot.isStreaming || planSaving || hasUnsavedPlanChanges || !canExecutePlan(plan)} onClick={() => void controller.executePlan()}>开始执行</button> : null}
                  </div>
                </section>
              ) : taskSurface === 'execution' ? (
                <>
                  <section className="mt-[18px]">
                    <div className="flex items-baseline justify-between gap-2"><span className="mb-[7px] block text-[12px] font-bold tracking-[0.06em] text-dim uppercase">执行进度</span><span className="font-mono text-[12px] leading-none text-dim tabular-nums">{completedPlanCount}/{plan.steps.length} 已完成</span></div>
                    <progress className="task-progress mt-0.5 block h-1.5 w-full overflow-hidden rounded-full border-0 bg-muted text-accent-strong" value={completedPlanCount} max={Math.max(plan.steps.length, 1)} aria-label="执行进度" />
                    {activePlanStep ? (
                      <div className="mt-3 grid min-w-0 gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_34%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_6%,var(--bg-panel))] p-[11px]">
                        <div className="flex min-w-0 items-center justify-between gap-2"><span className="text-[11px] font-bold text-accent-text">当前任务</span><small className="flex-none font-mono text-[11px] leading-none text-dim tabular-nums">第 {activePlanStep.index + 1}/{plan.steps.length} 步</small></div>
                        <strong className="text-[14px] font-semibold leading-[1.45] text-primary">{activePlanStep.step.title}</strong>
                        {activePlanStep.step.detail ? <p className="m-0 text-[12px] leading-[1.55] text-secondary">{activePlanStep.step.detail}</p> : <p className="m-0 text-[12px] leading-[1.55] text-secondary">Agent 正在处理这一项，完成后会自动推进。</p>}
                      </div>
                    ) : <p className="m-0 rounded-[var(--radius-xs)] border border-dashed border-line p-[9px] text-[12px] leading-[1.5] text-dim">正在等待 Agent 确认当前执行步骤。</p>}
                  </section>
                  <details className="group mt-3.5 min-w-0 border-t border-line" aria-label="任务清单">
                    <summary className="flex min-w-0 min-h-[38px] cursor-pointer list-none items-center gap-[7px] text-[12px] font-semibold text-secondary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"><ChevronRight size={14} className="flex-none text-dim transition-transform duration-[var(--duration-fast)] ease-[var(--ease)] group-open:rotate-90" /><span className="min-w-0 flex-1">任务清单</span><small className="flex-none text-[11px] text-dim">{plan.steps.length} 项</small></summary>
                    <PlanStepList steps={plan.steps} label="执行任务清单" />
                  </details>
                </>
              ) : taskSurface === 'result' ? (
                <>
                  <section className="mt-[18px]">
                    <div className="flex items-baseline justify-between gap-2"><span className="mb-[7px] block text-[12px] font-bold tracking-[0.06em] text-dim uppercase">执行结果</span><span className="font-mono text-[12px] leading-none text-dim tabular-nums">{completedPlanCount}/{plan.steps.length} 已完成</span></div>
                    <p className={`m-0 text-[12px] leading-[1.6] text-secondary${taskRequest ? ' line-clamp-5' : ' line-clamp-none text-dim'}`}>{taskRequest || '本次执行已完成。'}</p>
                  </section>
                  <section className="mt-[18px] grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5" aria-label="执行统计">
                    <div className="flex min-w-0 flex-col gap-[3px] rounded-[var(--radius-sm)] border border-line bg-panel px-[7px] py-[9px]"><strong className="font-mono text-[15px] leading-none text-primary tabular-nums">{toolCount}</strong><span className="overflow-hidden text-[12px] text-dim text-ellipsis whitespace-nowrap">已记录工具</span></div>
                    <div className="flex min-w-0 flex-col gap-[3px] rounded-[var(--radius-sm)] border border-line bg-panel px-[7px] py-[9px]"><strong className="font-mono text-[15px] leading-none text-primary tabular-nums">{fileChangeCount}</strong><span className="overflow-hidden text-[12px] text-dim text-ellipsis whitespace-nowrap" title={snapshot.gitError || undefined}>{fileChangeLabel}</span></div>
                    <div className="flex min-w-0 flex-col gap-[3px] rounded-[var(--radius-sm)] border border-line bg-panel px-[7px] py-[9px]"><strong className="font-mono text-[15px] leading-none text-primary tabular-nums">{terminalTools.length}</strong><span className="overflow-hidden text-[12px] text-dim text-ellipsis whitespace-nowrap">命令记录</span></div>
                  </section>
                  <details className="group mt-3.5 min-w-0 border-t border-line" aria-label="执行记录与原计划">
                    <summary className="flex min-w-0 min-h-[38px] cursor-pointer list-none items-center gap-[7px] text-[12px] font-semibold text-secondary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"><ChevronRight size={14} className="flex-none text-dim transition-transform duration-[var(--duration-fast)] ease-[var(--ease)] group-open:rotate-90" /><span className="min-w-0 flex-1">执行记录与原计划</span><small className="flex-none text-[11px] text-dim">按需查看</small></summary>
                    <div className="grid gap-4 pb-1.5">
                      <div><span className="mb-[7px] block text-[12px] font-bold tracking-[0.06em] text-dim uppercase">执行记录</span><PlanStepList steps={plan.steps} label="执行记录" /></div>
                      <div><span className="mb-[7px] block text-[12px] font-bold tracking-[0.06em] text-dim uppercase">原计划</span><pre className="m-0 min-w-0 rounded-[7px] border border-line bg-muted p-2.5 font-mono text-[12px] leading-[1.55] text-secondary whitespace-pre-wrap [overflow-wrap:anywhere]">{planText || '未生成计划内容。'}</pre></div>
                    </div>
                  </details>
                </>
              ) : (
                <>
                  <section className="mt-[18px]">
                    <div className="flex items-baseline justify-between gap-2"><span className="mb-[7px] block text-[12px] font-bold tracking-[0.06em] text-dim uppercase">任务请求</span><span className="font-mono text-[12px] leading-none text-dim tabular-nums">当前会话</span></div>
                    <p className={`m-0 text-[12px] leading-[1.6]${taskRequest ? ' line-clamp-5 text-secondary' : ' text-dim'}`}>{taskRequest || '切换到计划模式，然后描述想要完成的目标。计划不会写入项目文件。'}</p>
                  </section>
                  <section className="mt-[18px]">
                    <span className="mb-[7px] block text-[12px] font-bold tracking-[0.06em] text-dim uppercase">下一步</span>
                    <p className="m-0 text-[12px] leading-[1.6] text-secondary">进入计划模式后，Agent 会先给出可编辑、可确认的完整计划。</p>
                  </section>
                </>
              )}
            </div>
          ) : tab === 'changes' ? (
            <div className="flex h-full w-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-sidebar" id="file-sidebar-panel-changes" role="tabpanel" aria-labelledby="file-sidebar-tab-changes">
              {snapshot.gitStatus?.isRepository ? (
                <div className="grid w-full min-w-0 flex-none gap-[7px] border-b border-line bg-panel px-[9px] py-2">
                  <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-[7px]">
                    <span className="min-w-0 overflow-hidden font-mono text-[9px] leading-[1.3] text-dim text-ellipsis whitespace-nowrap" title={snapshot.gitStatus.upstream || undefined}>{snapshot.gitStatus.upstream ? (<><ArrowUp size={11} className="inline-block align-[-2px]" /> {snapshot.gitStatus.ahead} · <ArrowDown size={11} className="inline-block align-[-2px]" /> {snapshot.gitStatus.behind}</>) : '无上游'}</span>
                    <div className="flex flex-none gap-[5px]">
                      <button type="button" className="min-h-[26px] rounded-md border border-line-hover bg-elevated px-2 text-[9px] font-semibold text-secondary whitespace-nowrap cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:opacity-[0.42] disabled:cursor-not-allowed" disabled={gitBusy || !snapshot.gitStatus.upstream} title={snapshot.gitStatus.upstream ? '仅快进拉取上游分支' : '需要先设置上游分支'} onClick={() => void runGitAction('pull', () => controller.pullGit())}>{gitAction === 'pull' ? '拉取中…' : '拉取'}</button>
                      <button type="button" className="min-h-[26px] rounded-md border border-line-hover bg-elevated px-2 text-[9px] font-semibold text-secondary whitespace-nowrap cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:opacity-[0.42] disabled:cursor-not-allowed" disabled={gitBusy} onClick={() => void runGitAction('push', () => controller.pushGit())}>{gitAction === 'push' ? '推送中…' : '推送'}</button>
                    </div>
                  </div>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-[7px] border-t border-line pt-[7px]">
                    <span className="overflow-hidden text-[9px] text-dim text-ellipsis whitespace-nowrap">{stagedGitChanges.length} 已暂存 · {unstagedGitChanges.length} 未暂存</span>
                    <div className="flex gap-1">
                      <button type="button" className="min-h-6 rounded-[5px] border border-line bg-transparent px-1.5 text-[8px] text-secondary whitespace-nowrap cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed" disabled={gitBusy || !unstagedGitChanges.length} onClick={() => void runGitAction('stage', () => controller.stageAllGit())}>全部暂存</button>
                      <button type="button" className="min-h-6 rounded-[5px] border border-line bg-transparent px-1.5 text-[8px] text-secondary whitespace-nowrap cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed" disabled={gitBusy || !stagedGitChanges.length} onClick={() => void runGitAction('unstage', () => controller.unstageAllGit())}>全部取消</button>
                    </div>
                  </div>
                  <form className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-[7px]" onSubmit={(event) => {
                    event.preventDefault();
                    if (!gitCommitMessage.trim() || !stagedGitChanges.length || gitBusy) return;
                    void runGitAction('commit', () => controller.commitGit(gitCommitMessage));
                  }}>
                    <input className="h-7 w-full min-w-0 rounded-md border border-line bg-muted px-2 text-[10px] text-primary outline-none focus:border-accent" value={gitCommitMessage} maxLength={500} disabled={gitBusy || !stagedGitChanges.length} onChange={(event) => setGitCommitMessage(event.target.value)} placeholder={stagedGitChanges.length ? '提交说明' : '请先暂存改动'} aria-label="Git 提交说明" />
                    <button type="submit" className="min-h-[26px] rounded-md border border-[color-mix(in_srgb,var(--accent)_42%,var(--border))] bg-elevated px-2 text-[9px] font-semibold text-accent-text whitespace-nowrap cursor-pointer enabled:hover:border-accent enabled:hover:text-primary disabled:opacity-[0.42] disabled:cursor-not-allowed" disabled={gitBusy || !stagedGitChanges.length || !gitCommitMessage.trim()}>{gitAction === 'commit' ? '提交中…' : '提交暂存'}</button>
                  </form>
                </div>
              ) : null}
              {snapshot.gitLoading ? <div className="px-3 py-[26px] text-center text-[11px] text-dim before:mr-[7px] before:inline-block before:h-2.5 before:w-2.5 before:rounded-full before:border before:border-line before:border-t-accent before:align-[-1px] before:content-[''] before:animate-[workbenchSpin_0.8s_linear_infinite]">正在读取 Git 变更…</div> : null}
              {!snapshot.gitLoading && snapshot.gitError ? <div className="min-h-[27px] pl-[45px] pr-2 pt-1.5 pb-[5px] text-[9px] text-error">{snapshot.gitError}</div> : null}
              {!snapshot.gitLoading && !snapshot.gitError && snapshot.gitStatus && !snapshot.gitStatus.isRepository ? <div className="px-3 py-[26px] text-center text-[11px] text-dim">当前文件夹不是 Git 仓库。</div> : null}
              {!snapshot.gitLoading && snapshot.gitStatus?.isRepository && snapshot.gitStatus.changes.length === 0 ? <div className="px-3 py-[26px] text-center text-[11px] text-dim">工作区干净。</div> : null}
              <div className={`min-h-0 flex-auto overflow-auto [overscroll-behavior:contain]${snapshot.selectedGitPath ? ' basis-[44%]' : ''}`}>
                {snapshot.gitStatus?.changes.length ? <div className="flex min-h-[29px] items-center justify-between gap-2 border-b border-line bg-panel px-2.5 py-1.5 text-[9px] font-bold tracking-[0.035em] text-dim"><span>暂存的更改</span><strong className="font-mono text-[9px] leading-none text-secondary">{stagedGitChanges.length}</strong></div> : null}
                {renderGitChanges(stagedGitChangeTree, 0, 'staged')}
                {snapshot.gitStatus?.changes.length ? <div className="flex min-h-[29px] items-center justify-between gap-2 border-b border-line bg-panel px-2.5 py-1.5 text-[9px] font-bold tracking-[0.035em] text-dim"><span>更改</span><strong className="font-mono text-[9px] leading-none text-secondary">{unstagedGitChanges.length}</strong></div> : null}
                {renderGitChanges(unstagedGitChangeTree, 0, 'unstaged')}
              </div>
              {snapshot.selectedGitPath ? <div className="flex min-h-0 flex-1 flex-col border-t border-line bg-canvas"><div className="flex min-w-0 items-center justify-between gap-2 border-b border-line px-2.5 py-2 font-mono text-[9px] leading-[1.3] text-dim"><span className="overflow-hidden text-ellipsis whitespace-nowrap">{snapshot.gitDiffLoading ? '正在加载 diff…' : snapshot.gitDiff?.path}</span><small className="flex-none [font:inherit]">{snapshot.selectedGitArea === 'staged' ? '暂存区' : '工作区'}</small></div>{!snapshot.gitDiffLoading && snapshot.gitDiff ? (snapshot.gitDiff.diff ? <DiffView diff={snapshot.gitDiff.diff} className="max-h-[320px] overflow-auto" /> : <pre className="m-0 flex-1 overflow-auto p-2.5 font-mono text-[9px] leading-[1.55] text-secondary whitespace-pre-wrap">新建的未跟踪文件或二进制文件没有可展示的文本 diff。</pre>) : null}</div> : null}
            </div>
          ) : tab === 'terminal' ? (
            <div className="h-full min-h-0 overflow-auto bg-sidebar p-2" id="file-sidebar-panel-terminal" role="tabpanel" aria-labelledby="file-sidebar-tab-terminal">
              {terminalTools.length ? terminalTools.map((tool) => (
                <section className={`mb-2 overflow-hidden rounded-[var(--radius-sm)] border border-line bg-panel${tool.isError ? ' border-[color-mix(in_srgb,var(--error)_36%,var(--border))]' : ''}`} key={tool.toolCallId}>
                  <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-[7px] text-[9px] font-bold text-dim"><span className="overflow-hidden text-secondary text-ellipsis whitespace-nowrap">{tool.toolName}</span><span>{tool.status === 'streaming' ? '执行中' : tool.isError ? '失败' : '完成'}</span></div>
                  <code className="block overflow-hidden p-2 font-mono text-[10px] leading-[1.4] text-accent-text text-ellipsis whitespace-nowrap">$ {terminalCommand(tool)}</code>
                  <pre className="max-h-[180px] m-0 overflow-auto px-2 pb-2 font-mono text-[10px] leading-[1.5] text-secondary whitespace-pre-wrap">{tool.output || '命令未返回文本输出。'}</pre>
                </section>
              )) : <div className="px-3.5 py-7 text-center text-[11px] leading-[1.6] text-dim">本次会话还没有命令执行记录。运行命令后的输出会显示在这里。</div>}
            </div>
          ) : (
            <div id="file-sidebar-panel-files" role="tabpanel" aria-labelledby="file-sidebar-tab-files">
              {preview ? (
                <div className="flex w-full min-w-0 min-h-0 flex-1 overflow-hidden bg-sidebar">
              <div className="flex w-full min-w-0 min-h-0 flex-col">
                <div className="grid min-h-[58px] grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-[7px] border-b border-line bg-panel px-2 py-[7px]">
                  <button className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[7px] border border-transparent bg-transparent p-0 text-secondary cursor-pointer hover:border-line hover:bg-glass-hover hover:text-primary focus-visible:border-accent focus-visible:outline-none" type="button" title="返回文件列表" aria-label="返回文件列表" onClick={() => setPreview(null)}>
                    <ChevronLeft size={14} />
                  </button>
                  <div className="flex min-w-0 flex-col leading-[1.25]"><strong className="overflow-hidden text-[11px] text-primary text-ellipsis whitespace-nowrap">{preview.name}</strong><span className="mt-[3px] overflow-hidden font-mono text-[8px] leading-[1.35] text-dim text-ellipsis whitespace-nowrap">{preview.language} · {formatSize(preview.size)}</span></div>
                  <div className="flex items-center gap-[3px]">
                    <button className="inline-flex h-[27px] items-center justify-center rounded-[7px] border border-line bg-glass px-[7px] text-[8px] font-semibold text-secondary cursor-pointer enabled:hover:border-line-hover enabled:hover:bg-glass-hover enabled:hover:text-primary disabled:opacity-[0.38] disabled:cursor-not-allowed" type="button" onClick={() => insert({ name: preview.name, path: preview.path, isDirectory: false })}>添加到消息</button>
                    <button className="inline-flex h-[27px] items-center justify-center rounded-[7px] border border-line bg-glass px-[7px] text-[8px] font-semibold text-secondary cursor-pointer enabled:hover:border-line-hover enabled:hover:bg-glass-hover enabled:hover:text-primary disabled:opacity-[0.38] disabled:cursor-not-allowed" type="button" onClick={() => void postJson('/api/open-editor', { filePath: preview.path })}>在编辑器中打开</button>
                  </div>
                </div>
                <div className="min-w-0 min-h-0 flex-1 overflow-auto bg-canvas">
                  {preview.kind === 'image' && preview.content ? <div className="grid min-h-full place-items-center p-[18px]"><img className="block max-w-full max-h-[calc(100vh_-_180px)] rounded-[9px] border border-line object-contain shadow-md [background:repeating-conic-gradient(var(--bg-muted)_0_25%,var(--bg-panel)_0_50%)_50%/14px_14px]" src={`data:${preview.mimeType};base64,${preview.content}`} alt={preview.name} /></div> : null}
                  {preview.kind === 'text' ? <code className="block w-max min-w-full pt-[7px] pb-[18px] font-mono text-[10px] leading-[1.62]">{previewLines.map((line, index) => <span className="group grid min-h-[17px] grid-cols-[42px_minmax(max-content,1fr)] hover:bg-glass" key={index}><span className="sticky left-0 select-none border-r border-line bg-canvas pr-[9px] text-right text-ghost">{index + 1}</span><span className="min-w-max whitespace-pre px-3 pl-2.5 text-secondary">{line || ' '}</span></span>)}</code> : null}
                  {preview.kind === 'unsupported' ? <div className="flex min-h-[260px] flex-col items-center justify-center px-[18px] py-7 text-center text-dim"><strong className="text-[12px] text-secondary">{preview.reason || '此文件无法预览。'}</strong></div> : null}
                  {preview.truncated ? <div className="sticky top-0 z-[2] border-b border-b-[color-mix(in_srgb,var(--warning)_25%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_8%,var(--bg-panel))] px-[9px] py-1.5 text-[9px] text-warning">文件较大，仅显示前 1 MiB。</div> : null}
                </div>
              </div>
                </div>
              ) : (
                <div className="w-full min-w-0 min-h-0 flex-1 overflow-auto px-[7px] pt-[5px] pb-3.5" role="tree" aria-label="项目文件树">
                  {!rootPath ? <div className="px-3 py-[26px] text-center text-[11px] text-dim">请先打开一个项目</div> : null}
                  {loading && rootItems.length === 0 ? <div className="px-3 py-[26px] text-center text-[11px] text-dim before:mr-[7px] before:inline-block before:h-2.5 before:w-2.5 before:rounded-full before:border before:border-line before:border-t-accent before:align-[-1px] before:content-[''] before:animate-[workbenchSpin_0.8s_linear_infinite]">正在加载文件…</div> : null}
                  {error ? <div className="min-h-[27px] pl-[45px] pr-2 pt-1.5 pb-[5px] text-[9px] text-error">{error}</div> : null}
                  {renderItems(rootItems, 0)}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
