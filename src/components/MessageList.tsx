import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ExtensionUiRequest, RenderedMessage, TimelineItem, ToolExecution, Usage } from '../lib/types';
import { isPermissionRequest, permissionRequestDetails } from '../lib/extension-ui';
import { formatTokens, totalContextTokens } from '../lib/utils';
import {
  applyToolOutcome,
  formatDuration,
  isSubagentTool,
  parseSubagentRun,
  subagentModeLabel,
  subagentStatusLabel,
  type SubagentChild,
} from '../lib/subagents';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  GitBranch,
  ImageIcon,
  PenLine,
  RotateCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { confirmDialog } from './ConfirmDialog';
import { CopyMessageButton, Markdown } from './Markdown';

function usageText(usage?: Usage): string {
  if (!usage) return '';
  const input = usage.input || 0;
  const output = usage.output || 0;
  const cacheRead = usage.cacheRead || 0;
  const cacheWrite = usage.cacheWrite || 0;
  const total = totalContextTokens(usage);
  const parts = [
    `输入 ${formatTokens(input)}`,
    `输出 ${formatTokens(output)}`,
    ...(cacheRead ? [`缓存读取 ${formatTokens(cacheRead)}`] : []),
    ...(cacheWrite ? [`缓存写入 ${formatTokens(cacheWrite)}`] : []),
    `总计 ${formatTokens(total)}`,
  ];
  return `${usage.cost?.total ? `$${usage.cost.total.toFixed(4)} · ` : ''}${parts.join(' / ')}`;
}

function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(Boolean(streaming));
  if (!content) return null;
  return (
    <div className={`thinking-block w-auto max-w-full my-0.5 mb-[5px] mt-0.5 overflow-visible text-[12px] text-secondary${streaming ? ' streaming-thinking' : ''}`}>
      <button
        type="button"
        className={`inline-flex min-h-[26px] items-center gap-1.5 rounded-lg border bg-muted px-2 py-[3px] text-secondary cursor-pointer select-none transition-[color,background-color,border-color] duration-[var(--duration-fast)] hover:border-line-hover hover:bg-elevated hover:text-primary${expanded ? '' : ''}`}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`inline-flex text-dim transition-transform duration-[var(--duration-fast)] ease-[var(--ease)]${expanded ? ' rotate-90' : ''}`}>
          <ChevronRight size={9} aria-hidden="true" />
        </span>
        <span className="inline-flex items-center gap-[5px] text-[10px] font-semibold">
          <Brain size={12} /> 思考过程
        </span>
      </button>
      <div className={`${expanded ? 'block' : 'hidden'} mt-1.5 mb-1 ml-1 max-w-full border-l-2 border-l-line-hover py-2 pl-3 pr-0 text-[12px] leading-[1.6] font-mono text-secondary whitespace-pre-wrap`}>{content}</div>
    </div>
  );
}

function Welcome() {
  const starters = [
    {
      id: 'explore',
      index: '01',
      title: '理解这个项目',
      description: '快速梳理结构、技术栈与运行方式。',
      prompt: '帮我快速了解这个项目的结构、技术栈和运行方式。',
    },
    {
      id: 'plan',
      index: '02',
      title: '规划一次改动',
      description: '先确认影响范围，再拆分可执行步骤。',
      prompt: '我想实现一个功能，请先分析影响范围并给出计划。',
    },
    {
      id: 'debug',
      index: '03',
      title: '排查一个问题',
      description: '描述现象，Pi 会协助定位原因与修复方向。',
      prompt: '我遇到了一个问题，请帮助我定位原因并提出修复方案。',
    },
  ];

  const prefillComposer = (prompt: string) => {
    window.dispatchEvent(new CustomEvent('pi-studio:prefill-composer', { detail: { prompt } }));
  };

  return (
    <section className="relative grid min-h-0 place-items-center overflow-hidden pt-[clamp(40px,6vh,72px)] px-6 pb-9 before:absolute before:inset-0 before:opacity-[0.28] before:pointer-events-none before:content-[''] before:[background:linear-gradient(90deg,color-mix(in_srgb,var(--border)_40%,transparent)_1px,transparent_1px)_50%_0/72px_72px,linear-gradient(color-mix(in_srgb,var(--border)_32%,transparent)_1px,transparent_1px)_50%_0/72px_72px)] before:[mask-image:radial-gradient(ellipse_64%_54%_at_50%_45%,black_0%,transparent_78%)] after:absolute after:top-[8%] after:left-1/2 after:w-[min(760px,85vw)] after:pointer-events-none after:content-[''] after:[aspect-ratio:1.7] after:-translate-x-1/2 after:rounded-full after:bg-[radial-gradient(ellipse,color-mix(in_srgb,var(--accent)_13%,transparent),transparent_66%)] after:[filter:blur(22px)] max-compact:min-h-[calc(100%_-_28px)] max-compact:pt-9 max-compact:px-6 max-compact:pb-7" aria-label="开始新会话">
      <div className="relative z-[1] w-[min(100%,760px)]">
        <div className="mx-auto mb-6 max-w-[570px] text-center">
          <div className="mx-auto mb-[18px] grid h-[46px] w-[46px] place-items-center rounded-[14px] border border-[color-mix(in_srgb,var(--accent)_32%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_9%,var(--bg-elevated))] shadow-[0_12px_32px_color-mix(in_srgb,var(--accent)_13%,transparent),var(--shadow-inset)] max-compact:h-10 max-compact:w-10 max-compact:mb-3.5 max-compact:rounded-xl">
            <img src="/icons/tau-192.png" alt="" className="h-7 w-7 opacity-[0.96] max-compact:h-6 max-compact:w-6" />
          </div>
          <span className="eyebrow mb-2.5 text-accent-text tracking-[0.16em] max-compact:mb-2 max-compact:text-[9px]">PiCode / new session</span>
          <h1 className="m-0 text-[clamp(32px,4.2vw,48px)] font-bold tracking-[-0.06em] leading-[1.04] text-primary [text-wrap:balance] max-compact:text-[clamp(31px,10vw,38px)]">把想法变成<br /><em className="text-accent-text not-italic">下一步行动。</em></h1>
          <p className="mx-auto mt-3.5 max-w-[540px] text-[13px] leading-[1.75] text-secondary [text-wrap:pretty] max-compact:mt-[11px] max-compact:text-[12px] max-compact:leading-[1.65]">选择一个起点，或直接在下方描述你的任务。Pi 会保留必要的上下文，让工作自然地继续下去。</p>
        </div>
        <div className="grid grid-cols-[1.24fr_repeat(2,minmax(0,1fr))] [grid-template-areas:'explore_plan_debug'] gap-2 max-compact:grid-cols-1 max-compact:[grid-template-areas:'explore''plan''debug']" aria-label="常用起点">
          {starters.map((starter) => (
            <button
              className={`group grid min-w-0 min-h-24 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-[var(--radius-md)] border border-line bg-[color-mix(in_srgb,var(--bg-panel)_88%,transparent)] p-4 text-left text-primary cursor-pointer transition-[transform,border-color,background-color,box-shadow] duration-[var(--duration)] ease-[var(--ease)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] hover:bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-elevated))] hover:shadow-[0_12px_30px_color-mix(in_srgb,var(--accent)_10%,transparent),var(--shadow-inset)] active:translate-y-0 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent max-compact:min-h-[72px] max-compact:px-3.5 max-compact:py-[13px]`}
              key={starter.id}
              type="button"
              onClick={() => prefillComposer(starter.prompt)}
            >
              <span className="mt-0.5 font-mono text-[10px] leading-none text-accent-text tabular-nums">{starter.index}</span>
              <span className="flex min-w-0 flex-col gap-[5px] max-compact:gap-[3px]">
                <strong className="text-[13px] [font-weight:670] leading-[1.3] text-primary max-compact:text-[12px]">{starter.title}</strong>
                <span className="text-[11px] leading-[1.5] text-dim [text-wrap:pretty] max-compact:text-[10px]">{starter.description}</span>
              </span>
              <span className="self-center text-dim transition-[transform,color] duration-[var(--duration-fast)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-text"><ArrowUpRight size={18} /></span>
            </button>
          ))}
        </div>
        <div className="mt-[22px] flex flex-wrap justify-center gap-x-4 gap-y-2 text-[10px] text-dim max-compact:mt-[15px] max-compact:gap-x-[11px] max-compact:gap-y-1.5 max-compact:text-[9px]" aria-label="可用能力">
          <span className="inline-flex items-center gap-1.5"><FileText size={12} />Ctrl+Shift+G 审阅 Git 变更</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} />设置里可切换请求确认 / 只读 / 完全访问</span>
          <span className="inline-flex items-center gap-1.5"><Check size={12} />计划模式：先确认步骤再执行</span>
          <span className="inline-flex items-center gap-1.5"><ImageIcon size={12} />可直接粘贴或拖入截图</span>
        </div>
        <div className="mt-[22px] flex flex-wrap justify-center gap-x-4 gap-y-2 text-[10px] text-dim max-compact:mt-[15px] max-compact:gap-x-[11px] max-compact:gap-y-1.5 max-compact:text-[9px]" aria-label="键盘快捷键">
          <span className="inline-flex items-center gap-[5px]"><kbd>/</kbd> 聚焦输入框</span>
          <span className="inline-flex items-center gap-[5px]"><kbd>Ctrl+K</kbd> 打开命令</span>
          <span className="inline-flex items-center gap-[5px]"><kbd><ArrowUp size={10} aria-hidden="true" /></kbd> 上一条输入</span>
          <span className="inline-flex items-center gap-[5px]"><kbd>Esc</kbd> 停止生成</span>
          <button
            className="inline-flex items-center gap-1 border-0 bg-transparent text-inherit [font:inherit] cursor-pointer hover:text-accent-text"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('pi-studio:show-shortcuts'))}
          >
            <kbd>Ctrl+/</kbd> 全部快捷键
          </button>
        </div>
      </div>
    </section>
  );
}

function ErrorMessage({ message, onDelete }: { message: RenderedMessage; onDelete?(entryId: string): Promise<boolean> }) {
  const [deleting, setDeleting] = useState(false);
  const canDelete = Boolean(onDelete && message.history && message.sessionEntryId);
  return (
    <div className="group relative mb-0.5 flex w-full max-w-full min-w-0 shrink-0 flex-col items-start">
      <div className="grid w-[min(100%,720px)] grid-cols-[24px_minmax(0,1fr)] gap-[9px] rounded-[10px] border border-[color-mix(in_srgb,var(--error)_34%,var(--border))] bg-[color-mix(in_srgb,var(--error)_7%,var(--bg-panel))] px-[11px] py-2.5 text-secondary" role="alert">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--error)_14%,transparent)] text-error" aria-hidden="true"><CircleAlert size={14} /></span>
        <div className="min-w-0">
          <strong className="block text-[12px] font-bold text-error">操作失败</strong>
          <p className="mt-0.5 mb-0 text-[11px] leading-[1.55] text-secondary">{message.content}</p>
        </div>
      </div>
      {canDelete ? (
        <div className="mt-px inline-flex items-center gap-0.5 self-start opacity-0 pointer-events-none transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
          <button className="inline-flex h-[22px] w-6 items-center justify-center rounded-[5px] border-0 bg-transparent text-dim cursor-pointer transition-[color,background-color] duration-[var(--duration-fast)] hover:bg-[color-mix(in_srgb,var(--error)_10%,transparent)] hover:text-error disabled:opacity-[0.35] disabled:cursor-wait" type="button" aria-label="删除这条消息" title="删除这条消息" disabled={deleting} onClick={async () => {
            if (!message.sessionEntryId) return;
                const confirmed = await confirmDialog({ title: '删除这条消息？', message: '删除后会同步修改会话上下文。' });
                if (!confirmed) return;
            setDeleting(true);
            await onDelete?.(message.sessionEntryId);
            setDeleting(false);
          }}><Trash2 size={12} /></button>
        </div>
      ) : null}
    </div>
  );
}

function MessageItem({
  message,
  editable,
  regenerable,
  onDelete,
  onEdit,
  onFork,
  onRegenerate,
  onElementRef,
}: {
  message: RenderedMessage;
  regenerable?: boolean;
  onRegenerate?(): void;
  onFork?(entryId: string): void;
  editable?: boolean;
  onDelete?(entryId: string): Promise<boolean>;
  onEdit?(message: RenderedMessage): void;
  onElementRef?(element: HTMLDivElement | null): void;
}) {
  const [deleting, setDeleting] = useState(false);
  if (message.welcome) return <Welcome />;
  if (message.role === 'error') return <ErrorMessage message={message} onDelete={onDelete} />;
  if (message.role === 'system') return <div className="system-message">{message.content}</div>;

  const hasUsage = Boolean(usageText(message.usage));
  const canDelete = Boolean(onDelete && message.history && message.sessionEntryId && !message.streaming);
  const canEdit = Boolean(editable && onEdit && message.history && message.sessionEntryId && !message.streaming);
  // Regeneration replays the previous user turn, so it only makes sense on the
  // assistant reply that is already the end of the transcript.
  const canRegenerate = Boolean(regenerable && message.role === 'assistant' && message.history && !message.streaming);
  const canFork = Boolean(onFork && message.history && message.sessionEntryId && !message.streaming);
  const canCopy = Boolean(
    !message.streaming &&
    message.content &&
    (message.role === 'assistant' || message.role === 'user'),
  );
  return (
    <div ref={onElementRef} data-role={message.role} data-message-id={message.id} className={`group relative mb-0.5 flex w-full max-w-full min-w-0 shrink-0 flex-col items-start${message.role === 'user' ? ' w-auto max-w-[min(78%,680px)] max-compact:max-w-[88%] items-end self-end' : ' self-start'}${message.history ? '' : ' animate-[messageEnter_var(--duration-fast)_var(--ease)]'}`}>
      <div className={`message-content max-w-full min-w-0 text-[14px] leading-[1.72] text-primary [overflow-wrap:anywhere] break-words${message.role === 'user' ? ' rounded-[12px_12px_3px_12px] border border-[color-mix(in_srgb,var(--accent)_26%,transparent)] bg-user-bubble px-3.5 py-2.5 font-medium whitespace-pre-wrap text-user-bubble-text shadow-[0_8px_20px_rgba(3,5,12,0.12)]' : ' w-full max-w-none pr-2'}${message.streaming ? ' streaming' : ''}`}>
        {message.role === 'assistant' && message.thinking ? (
          <ThinkingBlock content={message.thinking} streaming={message.streaming} />
        ) : null}
        {message.images?.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {message.images.map((image, index) => (
              <img
                key={`${message.id}-image-${index}`}
                className="max-h-[200px] max-w-[240px] rounded-[10px] border border-line object-cover cursor-pointer transition-transform duration-[var(--duration-fast)] ease-[var(--ease)] hover:scale-[1.015] max-compact:max-w-[min(220px,72vw)]"
                src={`data:${image.mimeType};base64,${image.data}`}
                alt={`附件 ${index + 1}`}
              />
            ))}
          </div>
        ) : null}
        {message.role === 'assistant' ? (
          <Markdown>{message.content}</Markdown>
        ) : (
          <span className={message.streaming ? 'streaming-text' : undefined}>{message.content}</span>
        )}
      </div>
      {canCopy || canDelete || canEdit || canRegenerate || canFork ? (
        <div className={`mt-px inline-flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto max-compact:opacity-70 max-compact:pointer-events-auto! ${message.role === 'user' ? 'self-end' : ''}`}>
          {canCopy ? <CopyMessageButton text={message.content} /> : null}
          {canFork ? (
            <button
              className="inline-flex h-[22px] w-6 items-center justify-center rounded-[5px] border-0 bg-transparent text-dim cursor-pointer transition-[color,background-color] duration-[var(--duration-fast)] hover:bg-glass-hover hover:text-primary"
              type="button"
              aria-label="从这条消息分支出新会话"
              title="从这里分支：复制到此为止的对话为新会话"
              onClick={() => message.sessionEntryId && onFork?.(message.sessionEntryId)}
            >
              <GitBranch size={12} />
            </button>
          ) : null}
          {canRegenerate ? (
            <button
              className="inline-flex h-[22px] w-6 items-center justify-center rounded-[5px] border-0 bg-transparent text-dim cursor-pointer transition-[color,background-color] duration-[var(--duration-fast)] hover:bg-glass-hover hover:text-primary"
              type="button"
              aria-label="重新生成这条回复"
              title="重新生成（会重放上一条用户消息）"
              onClick={() => onRegenerate?.()}
            >
              <RotateCw size={12} />
            </button>
          ) : null}
          {canEdit ? (
            <button className="inline-flex h-[22px] w-6 items-center justify-center rounded-[5px] border-0 bg-transparent text-dim cursor-pointer transition-[color,background-color] duration-[var(--duration-fast)] hover:bg-glass-hover hover:text-primary" type="button" aria-label="重新编辑这条消息" title="重新编辑并发送" onClick={() => onEdit?.(message)}>
              <PenLine size={12} />
            </button>
          ) : null}
          {canDelete ? (
            <button
              className="inline-flex h-[22px] w-6 items-center justify-center rounded-[5px] border-0 bg-transparent text-dim cursor-pointer transition-[color,background-color] duration-[var(--duration-fast)] hover:bg-[color-mix(in_srgb,var(--error)_10%,transparent)] hover:text-error disabled:opacity-[0.35] disabled:cursor-wait"
              type="button"
              aria-label="删除这条消息"
              title="删除这条消息"
              disabled={deleting}
              onClick={async () => {
                if (!message.sessionEntryId) return;
                const confirmed = await confirmDialog({ title: '删除这条消息？', message: '删除后会同步修改会话上下文。' });
                if (!confirmed) return;
                setDeleting(true);
                await onDelete?.(message.sessionEntryId);
                setDeleting(false);
              }}
            >
              <Trash2 size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
      {hasUsage ? <span className="mt-1.5 block font-mono text-[10px] leading-[1.35] whitespace-nowrap text-dim tabular-nums">{usageText(message.usage)}</span> : null}
    </div>
  );
}

function argumentPreview(args: Record<string, unknown>): string {
  for (const key of ['path', 'command', 'query', 'url']) {
    const value = args[key];
    if (typeof value === 'string' && value) return value.slice(0, 80);
  }
  const first = Object.values(args).find((value) => typeof value === 'string' && value);
  return typeof first === 'string' ? first.slice(0, 60) : '';
}

function isTerminalToolName(name: string): boolean {
  return /(?:command|terminal|shell|powershell|bash|exec|run)/i.test(name);
}

function SubagentChildRow({ child }: { child: SubagentChild }) {
  const [open, setOpen] = useState(false);
  const metrics = [
    child.model,
    child.toolCount ? `${child.toolCount} 次工具` : '',
    child.tokens ? `${formatTokens(child.tokens)} tokens` : '',
    formatDuration(child.durationMs),
  ].filter(Boolean);
  const details = child.output || child.error || child.recentTools.length > 0;

  return (
    <div className={`flex flex-col border-l-2 px-[11px] pt-[9px] pb-2.5 [&+&]:border-t [&+&]:border-line${child.status === 'running' ? ' border-l-accent' : child.status === 'completed' ? ' border-l-success' : child.status === 'failed' ? ' border-l-error' : child.status === 'detached' ? ' border-l-warning' : ' border-l-line'}`}>
      <div
        className={`flex items-center gap-[7px]${details ? ' cursor-pointer' : ''}`}
        role={details ? 'button' : undefined}
        tabIndex={details ? 0 : undefined}
        onClick={() => details && setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!details) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        <span className={`h-1.5 w-1.5 flex-none rounded-full${child.status === 'running' ? ' bg-accent animate-[subagent-pulse_1.4s_ease-in-out_infinite]' : child.status === 'completed' ? ' bg-success' : child.status === 'failed' ? ' bg-error' : child.status === 'detached' ? ' bg-warning' : ' bg-ghost'}`} aria-hidden="true" />
        <span className="font-mono text-[11px] leading-[1.4] font-semibold text-primary">{child.agent}</span>
        {child.phase ? <span className="rounded-full border border-line px-1.5 py-px text-[9px] text-dim">{child.phase}</span> : null}
        <span className="ml-auto flex-none text-[9px] text-dim">{subagentStatusLabel(child.status)}</span>
      </div>
      {child.task ? <div className="mt-1 overflow-hidden text-[10px] leading-[1.55] text-secondary line-clamp-2">{child.task}</div> : null}
      {child.status === 'running' && child.currentTool ? (
        <div className="mt-[5px] flex items-center gap-1.5 font-mono text-[10px] leading-[1.5] text-accent-text">
          <span className="h-[5px] w-[5px] flex-none rounded-full bg-accent animate-[subagent-pulse_1.4s_ease-in-out_infinite]" aria-hidden="true" />
          {child.currentTool}
          {child.currentToolArgs ? <em className="min-w-0 overflow-hidden text-dim not-italic text-ellipsis whitespace-nowrap">{child.currentToolArgs}</em> : null}
        </div>
      ) : null}
      {metrics.length ? <div className="mt-[5px] text-[9px] text-dim">{metrics.join(' · ')}</div> : null}
      {child.error ? <div className="mt-[5px] text-[10px] leading-[1.5] text-error break-words">{child.error}</div> : null}
      {open ? (
        <div className="mt-2 border-t border-line pt-2">
          {child.recentTools.length ? (
            <ul className="mb-[7px] m-0 list-disc pl-3.5 font-mono text-[9px] leading-[1.7] text-dim">
              {child.recentTools.slice(-8).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}
            </ul>
          ) : null}
          {child.output ? <div className="max-h-[240px] overflow-auto text-[10px] leading-[1.6] text-secondary whitespace-pre-wrap break-words">{child.output}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function SubagentCard({ tool }: { tool: ToolExecution }) {
  const run = useMemo(
    () => applyToolOutcome(parseSubagentRun(tool.args, tool.resultDetails, tool.toolName), tool.status),
    [tool.args, tool.resultDetails, tool.toolName, tool.status],
  );
  const running = tool.status === 'pending' || tool.status === 'streaming';
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const listener = (event: Event) => {
      setExpanded((event as CustomEvent<{ expanded: boolean }>).detail.expanded);
    };
    window.addEventListener('pi-studio:tool-expand', listener);
    return () => window.removeEventListener('pi-studio:tool-expand', listener);
  }, []);

  const done = run.children.filter((child) => child.status === 'completed').length;
  const failed = run.children.filter((child) => child.status === 'failed').length;
  const summary = [
    run.children.length ? `${done}/${run.children.length} 完成` : '',
    failed ? `${failed} 失败` : '',
    run.tokens ? `${formatTokens(run.tokens)} tokens` : '',
    run.cost ? `$${run.cost.toFixed(4)}` : '',
  ].filter(Boolean);

  return (
    <div className={`w-full shrink-0 my-[3px] overflow-hidden rounded-lg border bg-[color-mix(in_srgb,var(--accent)_4%,var(--tool-bg))] text-secondary transition-[border-color] duration-[var(--duration-fast)] hover:border-line-hover${tool.history ? '' : ' animate-[messageEnter_var(--duration-fast)_var(--ease)]'}${running ? ' border-[color-mix(in_srgb,var(--accent)_44%,var(--border))]' : ' border-[color-mix(in_srgb,var(--accent)_26%,var(--border))]'}`} data-tool-call-id={tool.toolCallId}>
      <div
        className="group/header flex min-h-[38px] items-center justify-between gap-2.5 px-[9px] py-[7px] cursor-pointer hover:bg-glass"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
      >
        <span className="flex min-w-0 items-center gap-[7px]">
          <span className={`inline-flex text-ghost transition-transform duration-[var(--duration-fast)]${expanded ? ' rotate-90' : ''}`}>
            <ChevronRight size={9} aria-hidden="true" />
          </span>
          <Brain size={13} className="flex-none text-accent-text" />
          <span className="flex-none font-mono text-[10px] leading-[1.4] font-semibold text-accent-text">子代理</span>
          <span className="flex-none text-[10px] text-secondary">{subagentModeLabel(run)}</span>
          {run.async ? <span className="flex-none rounded-full border border-line px-1.5 py-px text-[9px] text-dim">后台</span> : null}
          {run.timedOut ? <span className="flex-none rounded-full border border-[color-mix(in_srgb,var(--warning)_32%,var(--border))] px-1.5 py-px text-[9px] text-warning">超时</span> : null}
          {run.stopped ? <span className="flex-none rounded-full border border-[color-mix(in_srgb,var(--warning)_32%,var(--border))] px-1.5 py-px text-[9px] text-warning">已停止</span> : null}
        </span>
        <span className="flex min-w-0 items-center gap-[7px]">
          {summary.length ? <span className="overflow-hidden text-[9px] text-dim text-ellipsis whitespace-nowrap">{summary.join(' · ')}</span> : null}
          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] whitespace-nowrap ${tool.status === 'streaming' ? 'border-accent-subtle text-accent-text' : tool.status === 'complete' ? 'border-[color-mix(in_srgb,var(--success)_25%,var(--border))] text-success' : tool.status === 'error' ? 'border-[color-mix(in_srgb,var(--error)_25%,var(--border))] text-error' : 'border-line text-dim'}`}>
            {{ pending: '等待中', streaming: '执行中', complete: '已完成', error: '失败' }[tool.status]}
          </span>
        </span>
      </div>
      <div data-expanded={expanded} className={`${expanded ? 'block' : 'hidden'} border-t border-line`}>
        {run.children.length ? (
          <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-line">
            {run.children.map((child) => <SubagentChildRow key={`${child.index}-${child.agent}`} child={child} />)}
          </div>
        ) : null}
        {!run.live && running ? <div className="px-[11px] py-[9px] text-[10px] text-dim">正在启动子代理…</div> : null}
        {run.asyncId ? <div className="px-[11px] py-[9px] text-[10px] text-dim">后台运行 ID：<code className="font-mono text-[10px] leading-[1.5]">{run.asyncId}</code></div> : null}
        {/* Show the raw result unless every child already carries its own output (live runs). */}
        {tool.output && !run.children.some((child) => child.output) ? <ToolOutput output={tool.output} /> : null}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolExecution }) {
  const terminalTool = isTerminalToolName(tool.toolName);
  const command = terminalTool ? argumentPreview(tool.args) : '';
  const [expanded, setExpanded] = useState(tool.status === 'pending' || tool.status === 'streaming');
  const statusLabel = {
    pending: '等待中',
    streaming: '执行中',
    complete: '已完成',
    error: '失败',
  }[tool.status];
  const isEdit =
    tool.toolName.toLowerCase() === 'edit' &&
    typeof (tool.args.oldText || tool.args.old_text) === 'string' &&
    typeof (tool.args.newText || tool.args.new_text) === 'string';

  useEffect(() => {
    if (tool.status === 'streaming') setExpanded(true);
    if (tool.status === 'complete' && !tool.isError) setExpanded(false);
  }, [tool.isError, tool.status]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ expanded: boolean }>).detail;
      setExpanded(detail.expanded);
    };
    window.addEventListener('pi-studio:tool-expand', listener);
    return () => window.removeEventListener('pi-studio:tool-expand', listener);
  }, []);

  const diff = useMemo(() => {
    if (!isEdit) return null;
    const oldText = String(tool.args.oldText || tool.args.old_text || '');
    const newText = String(tool.args.newText || tool.args.new_text || '');
    return (
      <div className="overflow-x-auto py-[7px] font-mono text-[10px] leading-[1.55]">
        {oldText.split('\n').map((line, index) => (
          <div className="min-h-[18px] bg-[rgba(255,107,122,0.08)] px-2.5 text-[color-mix(in_srgb,var(--error)_80%,var(--text-primary))] whitespace-pre-wrap" key={`old-${index}`}>- {line}</div>
        ))}
        {newText.split('\n').map((line, index) => (
          <div className="min-h-[18px] bg-[rgba(67,211,158,0.08)] px-2.5 text-[color-mix(in_srgb,var(--success)_80%,var(--text-primary))] whitespace-pre-wrap" key={`new-${index}`}>+ {line}</div>
        ))}
      </div>
    );
  }, [isEdit, tool.args]);

  return (
    <div className={`w-full shrink-0 my-[3px] overflow-hidden rounded-lg border text-secondary transition-[border-color] duration-[var(--duration-fast)] hover:border-line-hover${tool.history ? '' : ' animate-[messageEnter_var(--duration-fast)_var(--ease)]'}${terminalTool ? ' border-[color-mix(in_srgb,var(--tool-accent)_20%,var(--border))] bg-[color-mix(in_srgb,var(--tool-bg)_82%,var(--bg-panel))]' : ' border-line bg-[color-mix(in_srgb,var(--tool-bg)_88%,var(--bg-panel))]'}`} data-tool-call-id={tool.toolCallId}>
      <div
        className="group/header flex min-h-[38px] items-center justify-between gap-2.5 px-[9px] py-[7px] cursor-pointer hover:bg-glass"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
      >
        <span className="flex min-w-0 items-center gap-[7px]">
          <span className={`inline-flex text-ghost transition-transform duration-[var(--duration-fast)]${expanded ? ' rotate-90' : ''}`}>
            <ChevronRight size={9} aria-hidden="true" />
          </span>
          <span className="flex-none font-mono text-[10px] leading-[1.4] font-semibold text-tool-accent-text">{tool.toolName}</span>
          {argumentPreview(tool.args) ? (
            <span className="overflow-hidden font-mono text-[10px] leading-[1.4] text-dim text-ellipsis whitespace-nowrap max-compact:max-w-[36vw]">{argumentPreview(tool.args)}</span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-[7px]">
          <button
            className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border-0 bg-transparent text-dim opacity-55 cursor-pointer transition-opacity duration-[var(--duration-fast)] group-hover/header:opacity-100 focus-visible:opacity-100 hover:bg-glass-hover hover:text-secondary"
            type="button"
            title="复制输出"
            aria-label="复制工具输出"
            onClick={(event) => {
              event.stopPropagation();
              if (tool.output) void navigator.clipboard.writeText(tool.output);
            }}
          >
            <Copy size={13} />
          </button>
          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] whitespace-nowrap ${tool.status === 'streaming' ? 'border-accent-subtle text-accent-text' : tool.status === 'complete' ? 'border-[color-mix(in_srgb,var(--success)_25%,var(--border))] text-success' : tool.status === 'error' ? 'border-[color-mix(in_srgb,var(--error)_25%,var(--border))] text-error' : 'border-line text-dim'}`}>{statusLabel}</span>
        </span>
      </div>
      <div data-expanded={expanded} className={`${expanded ? 'block' : 'hidden'} border-t border-line`}>
        {diff}
        {terminalTool && command ? (
          <div className="grid grid-cols-[12px_minmax(0,1fr)] gap-[5px] border-b border-line bg-glass px-[11px] py-[9px] font-mono text-[10px] leading-[1.5] text-accent-text"><span>$</span><code className="overflow-x-auto text-secondary whitespace-pre-wrap break-words">{command}</code></div>
        ) : null}
        {!isEdit && !terminalTool && Object.keys(tool.args).length ? (
          <div className="m-0 border-b border-line bg-glass px-[11px] py-2.5 overflow-auto font-mono text-[10px] leading-[1.55] text-dim whitespace-pre-wrap break-words">{JSON.stringify(tool.args, null, 2)}</div>
        ) : null}
        <ToolOutput output={tool.output} terminal={terminalTool} />
      </div>
    </div>
  );
}

/** Above this, a tool output is collapsed until the user asks for the rest. */
const OUTPUT_LINE_LIMIT = 400;
const OUTPUT_CHAR_LIMIT = 40_000;

/**
 * Tool output that stays bounded.
 *
 * A `find` over a large repo or a verbose test run used to render every line
 * into the DOM, which froze the timeline and pushed the composer off screen.
 * The tail is what matters after a long run, so that is what is kept.
 */
function ToolOutput({ output, terminal = false }: { output: string; terminal?: boolean }) {
  const [full, setFull] = useState(false);
  const lines = useMemo(() => output.split('\n'), [output]);
  const oversized = lines.length > OUTPUT_LINE_LIMIT || output.length > OUTPUT_CHAR_LIMIT;

  if (!oversized || full) {
    return (
      <div className="min-w-0">
        <div className={`${output ? '' : 'hidden'} m-0 px-[11px] py-2.5 overflow-auto font-mono text-[10px] leading-[1.55] text-secondary whitespace-pre-wrap break-words${terminal ? ' max-h-[220px]' : ''}`}>{output}</div>
        {oversized ? (
          <div className="flex gap-2 border-t border-line px-2.5 py-1.5">
            <button className="rounded-[var(--radius-pill)] border border-line bg-glass px-[9px] py-0.5 text-[10px] text-secondary hover:border-accent hover:text-accent-text" type="button" onClick={() => setFull(false)}>收起（共 {lines.length} 行）</button>
          </div>
        ) : null}
      </div>
    );
  }

  const visible = lines.slice(-OUTPUT_LINE_LIMIT).join('\n').slice(-OUTPUT_CHAR_LIMIT);
  return (
    <div className="min-w-0">
      <div className="border-b border-line px-2.5 py-1 text-[10px] text-dim">
        已省略前 {Math.max(0, lines.length - OUTPUT_LINE_LIMIT)} 行，显示最后 {Math.min(lines.length, OUTPUT_LINE_LIMIT)} 行
      </div>
      <div className="m-0 px-[11px] py-2.5 overflow-auto font-mono text-[10px] leading-[1.55] text-secondary whitespace-pre-wrap break-words">{visible}</div>
      <div className="flex gap-2 border-t border-line px-2.5 py-1.5">
        <button className="rounded-[var(--radius-pill)] border border-line bg-glass px-[9px] py-0.5 text-[10px] text-secondary hover:border-accent hover:text-accent-text" type="button" onClick={() => setFull(true)}>显示全部（{lines.length} 行）</button>
        <button className="rounded-[var(--radius-pill)] border border-line bg-glass px-[9px] py-0.5 text-[10px] text-secondary hover:border-accent hover:text-accent-text" type="button" onClick={() => void navigator.clipboard.writeText(output)}>复制全部</button>
      </div>
    </div>
  );
}

function optionLabel(option: string | { label: string; value: unknown }): string {
  return typeof option === 'string' ? option : option.label;
}

function optionValue(option: string | { label: string; value: unknown }): unknown {
  return typeof option === 'string' ? option : option.value;
}

/** Unanswered permission prompts fail closed after this long. */
const PERMISSION_TIMEOUT_SECONDS = 300;

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function PermissionRequestCard({
  request,
  onRespond,
}: {
  request: ExtensionUiRequest;
  onRespond(request: ExtensionUiRequest, response: Record<string, unknown>): void;
}) {
  const [responding, setResponding] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(PERMISSION_TIMEOUT_SECONDS);
  const { action, detail } = permissionRequestDetails(request);
  const options = [...(request.options || [])].sort((left, right) => {
    const leftDenied = optionLabel(left).includes('拒绝');
    const rightDenied = optionLabel(right).includes('拒绝');
    return leftDenied === rightDenied ? 0 : leftDenied ? -1 : 1;
  });

  useEffect(() => {
    setResponding(false);
    setSecondsLeft(PERMISSION_TIMEOUT_SECONDS);
  }, [request.id, request.requestId, request.title]);

  const respond = (option: string | { label: string; value: unknown } | undefined) => {
    if (responding || !option) return;
    setResponding(true);
    onRespond(request, { value: optionValue(option) });
  };

  const find = (predicate: (label: string) => boolean) => options.find((option) => predicate(optionLabel(option)));
  const denyOption = find((label) => label.includes('拒绝'));
  const sessionOption = find((label) => label.includes('本会话'));
  const onceOption = find((label) => !label.includes('拒绝') && !label.includes('本会话'));

  // An unanswered prompt must not sit open forever: an unattended machine
  // should end up denying, never waiting for someone to walk back and click.
  useEffect(() => {
    if (responding) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          respond(denyOption);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responding, request.id, request.requestId, denyOption]);

  useEffect(() => {
    if (responding) return;
    const onKey = (event: KeyboardEvent) => {
      const accel = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape') {
        event.preventDefault();
        respond(denyOption);
        return;
      }
      if (accel && event.key === 'Enter') {
        event.preventDefault();
        respond(event.shiftKey ? sessionOption || onceOption : onceOption);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responding, request.id, request.requestId, denyOption, onceOption, sessionOption]);

  return (
    <section className="grid w-full grid-cols-[32px_minmax(0,1fr)] my-1 gap-[11px] rounded-xl border border-[color-mix(in_srgb,var(--warning)_32%,var(--border))] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--warning)_6%,var(--bg-panel)),var(--bg-panel)_64%)] p-[13px] shadow-sm animate-[messageEnter_var(--duration-fast)_var(--ease)] max-compact:grid-cols-[28px_minmax(0,1fr)] max-compact:gap-[9px] max-compact:p-[11px]" role="region" aria-label="Pi 工具执行授权">
      <div className="grid h-8 w-8 place-items-center rounded-[9px] border border-[color-mix(in_srgb,var(--warning)_30%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_10%,var(--bg-muted))] text-warning max-compact:h-7 max-compact:w-7" aria-hidden="true"><ShieldCheck size={17} /></div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3 max-compact:gap-2">
          <div>
            <span className="mb-[3px] block text-[9px] font-bold tracking-[0.08em] text-warning uppercase">需要你的确认</span>
            <h3 className="m-0 text-[13px] font-semibold leading-[1.4] text-primary">允许 Pi {action}？</h3>
          </div>
          <span className={`mt-px inline-flex flex-none items-center gap-[5px] rounded-full border border-line px-[7px] py-[3px] text-[9px] whitespace-nowrap max-compact:hidden ${secondsLeft <= 30 ? 'border-transparent text-error! [&>span]:bg-error!' : 'text-dim'}`}>
            <span className="h-[5px] w-[5px] rounded-full bg-warning shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_13%,transparent)]" />{responding ? '已提交' : `${formatCountdown(secondsLeft)} 后自动拒绝`}
          </span>
        </div>
        {detail ? <pre className="mt-2.5 max-h-[180px] overflow-auto rounded-lg border border-line bg-[color-mix(in_srgb,var(--bg-solid)_54%,var(--bg-muted))] px-2.5 py-[9px] font-mono text-[10px] leading-[1.55] text-secondary whitespace-pre-wrap break-words [word-break:break-word]"><code className="[font:inherit]">{detail}</code></pre> : null}
        <p className="mt-2 mb-0 text-[10px] leading-[1.5] text-dim">
          授权仅作用于当前操作；“本会话允许”只覆盖<strong>当前会话</strong>内的同一命令族或同一文件，换会话即失效。
        </p>
        <div className="mt-[11px] flex flex-wrap justify-end gap-[7px] max-compact:grid max-compact:grid-cols-2">
          {options.map((option) => {
            const label = optionLabel(option);
            const kind = label.includes('拒绝')
              ? 'deny'
              : label.includes('本会话')
                ? 'session'
                : 'once';
            const displayLabel = kind === 'session' ? '本会话允许' : label;
            const kindClasses = kind === 'once'
              ? 'border-accent bg-accent text-white enabled:hover:border-accent-hover enabled:hover:bg-accent-hover enabled:hover:text-white'
              : kind === 'deny'
                ? 'mr-auto bg-transparent text-dim enabled:hover:border-[color-mix(in_srgb,var(--error)_35%,var(--border))] enabled:hover:bg-[color-mix(in_srgb,var(--error)_8%,transparent)] enabled:hover:text-error max-compact:col-span-full max-compact:row-start-2 max-compact:mr-0'
                : '';
            return (
              <button
                className={`min-h-[31px] rounded-lg border border-line bg-muted px-[11px] text-[10px] font-semibold text-secondary cursor-pointer transition-[border-color,background-color,color,transform] duration-[var(--duration-fast)] enabled:hover:-translate-y-px enabled:hover:border-line-hover enabled:hover:bg-elevated enabled:hover:text-primary disabled:cursor-wait disabled:opacity-50 ${kindClasses}`}
                type="button"
                disabled={responding}
                key={label}
                aria-label={displayLabel}
                onClick={() => respond(option)}
              >
                {displayLabel}
                <kbd className="ml-2 inline-flex h-4 items-center rounded-[4px] border border-line px-1 text-[9px] leading-none opacity-[0.62]" aria-hidden="true">{kind === 'deny' ? 'Esc' : kind === 'session' ? 'Ctrl+Shift+Enter' : 'Ctrl+Enter'}</kbd>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function timelineFingerprint(timeline: TimelineItem[]): string {
  if (!timeline.length) return 'empty';
  return `${timeline.length}:${timeline[0]?.id || ''}:${timeline[timeline.length - 1]?.id || ''}`;
}

function conversationLabel(message: RenderedMessage, index: number): string {
  const preview = message.content.replace(/\s+/g, ' ').trim();
  return preview ? `跳转到用户消息 ${index + 1}：${preview.slice(0, 48)}` : `跳转到用户消息 ${index + 1}`;
}

function conversationPreview(message: RenderedMessage): string {
  const preview = message.content.replace(/\s+/g, ' ').trim();
  return preview.length > 56 ? `${preview.slice(0, 56)}…` : preview || '空白用户消息';
}

export function MessageList({
  timeline,
  streaming,
  switching = false,
  extensionUiRequest,
  onDeleteMessage,
  onEditMessage,
  onForkMessage,
  onRegenerate,
  onRespondToExtension,
}: {
  timeline: TimelineItem[];
  streaming: boolean;
  switching?: boolean;
  extensionUiRequest?: ExtensionUiRequest | null;
  onDeleteMessage?(entryId: string): Promise<boolean>;
  onEditMessage?(message: RenderedMessage): void;
  onForkMessage?(entryId: string): void;
  onRegenerate?(): void;
  onRespondToExtension?(request: ExtensionUiRequest, response: Record<string, unknown>): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const conversationNodes = useRef(new Map<string, HTMLDivElement>());
  const [scrolledUp, setScrolledUp] = useState(false);
  const [newMessage, setNewMessage] = useState(false);
  const previousCount = useRef(timeline.length);
  const previousFingerprint = useRef(timelineFingerprint(timeline));
  const stickToBottom = useRef(true);
  const permissionRequest = isPermissionRequest(extensionUiRequest) ? extensionUiRequest : null;
  const permissionRequestKey = permissionRequest?.id || permissionRequest?.requestId || permissionRequest?.title || '';
  const lastUserMessageId = useMemo(
    () => [...timeline].reverse().find((item) => item.kind === 'message' && item.message.role === 'user')?.id,
    [timeline],
  );
  const lastAssistantMessageId = useMemo(
    () => [...timeline].reverse().find((item) => item.kind === 'message' && item.message.role === 'assistant')?.id,
    [timeline],
  );
  const conversationAnchors = useMemo(
    () => timeline.flatMap((item) => item.kind === 'message' && item.message.role === 'user' ? [item.message] : []),
    [timeline],
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationPositions, setConversationPositions] = useState<Record<string, number>>({});

  const registerConversationNode = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) conversationNodes.current.set(id, node);
    else conversationNodes.current.delete(id);
  }, []);

  const updateConversationPositions = useCallback(() => {
    const container = containerRef.current;
    if (!container || !conversationAnchors.length) return;
    const scrollRange = Math.max(1, container.scrollHeight - 1);
    const next: Record<string, number> = {};
    for (const message of conversationAnchors) {
      const node = conversationNodes.current.get(message.id);
      if (!node) continue;
      next[message.id] = Math.min(1, Math.max(0, node.offsetTop / scrollRange));
    }
    setConversationPositions((current) => {
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      if (
        currentKeys.length === nextKeys.length &&
        nextKeys.every((id) => Math.abs((current[id] ?? -1) - next[id]!) < 0.001)
      ) return current;
      return next;
    });
  }, [conversationAnchors]);

  // Keep scroll stable across session switches / history replace.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fingerprint = timelineFingerprint(timeline);
    const prevFingerprint = previousFingerprint.current;
    const firstId = timeline[0]?.id || '';
    const prevFirst = prevFingerprint.split(':')[1] || '';
    const isFullReplace =
      fingerprint !== prevFingerprint &&
      (timeline.length === 0 || firstId !== prevFirst || timeline.length < previousCount.current);

    if (isFullReplace) {
      stickToBottom.current = true;
      setScrolledUp(false);
      setNewMessage(false);
      container.scrollTop = container.scrollHeight;
    } else if (stickToBottom.current) {
      container.scrollTop = container.scrollHeight;
    } else if (timeline.length > previousCount.current) {
      setNewMessage(true);
    }

    previousCount.current = timeline.length;
    previousFingerprint.current = fingerprint;
  }, [timeline]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !permissionRequestKey) return;
    stickToBottom.current = true;
    setScrolledUp(false);
    setNewMessage(false);
    container.scrollTop = container.scrollHeight;
  }, [permissionRequestKey]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = window.requestAnimationFrame(updateConversationPositions);
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateConversationPositions);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    observer?.observe(container);
    for (const node of conversationNodes.current.values()) observer?.observe(node);
    window.addEventListener('resize', scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [conversationAnchors, updateConversationPositions]);

  useEffect(() => {
    if (!conversationAnchors.length) {
      setActiveConversationId(null);
      return;
    }
    setActiveConversationId((current) =>
      conversationAnchors.some((message) => message.id === current)
        ? current
        : conversationAnchors[conversationAnchors.length - 1]?.id || null,
    );
  }, [conversationAnchors]);

  const scrollToConversation = (id: string) => {
    const container = containerRef.current;
    const target = conversationNodes.current.get(id);
    if (!container || !target) return;
    // The workspace header overlays the scroll area. Keep the selected user
    // message below it rather than pinning it underneath the header on upward jumps.
    const headerHeight = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--header-height'),
    ) || 58;
    const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - headerHeight - 20;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    stickToBottom.current = false;
    setScrolledUp(true);
    setNewMessage(false);
    setActiveConversationId(id);
  };

  return (
    <div className="relative flex min-h-0 flex-auto flex-col [--conversation-rail-offset:max(18px,calc((100%_-_var(--content-max-width))/2_-_36px))]">
      {switching ? (
        <div className="pointer-events-none absolute left-1/2 top-[calc(var(--header-height)_+_10px)] z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-hover bg-elevated px-3 py-1.5 text-[11px] font-semibold text-secondary shadow-md animate-[toastEnter_var(--duration)_var(--ease)]" role="status" aria-live="polite">
          <span className="h-3 w-3 rounded-full border-[1.5px] border-line border-t-accent animate-[workbenchSpin_0.8s_linear_infinite]" aria-hidden="true" />
          <span>正在切换会话…</span>
        </div>
      ) : null}
      <div
        className={`relative flex min-h-0 flex-auto flex-col gap-3 overflow-y-auto bg-transparent [scrollbar-gutter:stable] [padding:calc(var(--header-height)_+_24px)_max(24px,calc((100%_-_var(--content-max-width))/2))_20px] [scroll-padding-bottom:20px] [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-corner]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-line-hover [&::-webkit-scrollbar-thumb]:bg-clip-padding [&::-webkit-scrollbar-thumb:hover]:bg-line-bright [&::-webkit-scrollbar-thumb:active]:bg-accent [&:not(:hover)::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--border-hover)_72%,transparent)] max-narrow:gap-[22px] max-narrow:[padding-top:calc(var(--header-height)_+_28px)] max-compact:gap-[18px] max-compact:[padding:calc(var(--header-height)_+_20px)_15px_16px] max-compact:[scroll-padding-bottom:16px]${switching ? ' opacity-70 transition-opacity duration-[var(--duration-fast)]' : ''}`}
        id="messages"
        ref={containerRef}
        onScroll={() => {
          const container = containerRef.current;
          if (!container) return;
          const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
          const isUp = distance >= 120;
          stickToBottom.current = !isUp;
          setScrolledUp(isUp);
          if (!isUp) setNewMessage(false);
          const threshold = container.getBoundingClientRect().top + container.clientHeight * 0.32;
          let currentAnchor = conversationAnchors[0]?.id || null;
          for (const message of conversationAnchors) {
            const node = conversationNodes.current.get(message.id);
            if (node && node.getBoundingClientRect().top <= threshold) currentAnchor = message.id;
          }
          // Before the first anchor crosses the reading threshold (the common
          // case when scrolling all the way up), keep the first conversation
          // selected instead of leaving the previous lower conversation active.
          setActiveConversationId(currentAnchor);
        }}
      >
        {timeline.map((item) =>
          item.kind === 'message' ? (
            <MessageItem
              key={item.id}
              message={item.message}
              editable={item.id === lastUserMessageId && !streaming}
              regenerable={item.id === lastAssistantMessageId && !streaming}
              onDelete={onDeleteMessage}
              onFork={onForkMessage}
              onRegenerate={onRegenerate}
              onEdit={onEditMessage}
              onElementRef={item.message.role === 'user' ? (node) => registerConversationNode(item.message.id, node) : undefined}
            />
          ) : (
            isSubagentTool(item.tool.toolName)
              ? <SubagentCard key={item.id} tool={item.tool} />
              : <ToolCard key={item.id} tool={item.tool} />
          ),
        )}
        {permissionRequest && onRespondToExtension ? (
          <PermissionRequestCard request={permissionRequest} onRespond={onRespondToExtension} />
        ) : null}
      </div>
      {conversationAnchors.length > 1 ? (
        <nav className="pointer-events-none absolute right-(--conversation-rail-offset) top-[calc(var(--header-height)_+_34px)] bottom-[58px] z-20 block w-[22px] max-narrow:hidden" aria-label="对话快速定位">
          {conversationAnchors.map((message, index) => (
            <button
              key={message.id}
              className={`group pointer-events-auto absolute left-0 flex h-[22px] w-[22px] cursor-pointer items-center justify-end border-0 bg-transparent p-0 -translate-y-1/2 focus-visible:outline-none`}
              type="button"
              aria-label={conversationLabel(message, index)}
              aria-current={message.id === activeConversationId ? 'true' : undefined}
              style={{ top: `${4 + (conversationPositions[message.id] ?? (index + 0.5) / conversationAnchors.length) * 92}%` }}
              onClick={() => scrollToConversation(message.id)}
            >
              <span className={`block h-0.5 rounded-full transition-[width,background-color,opacity] duration-[var(--duration-fast)] group-hover:w-[17px] group-hover:bg-accent-text group-hover:opacity-100 group-focus-visible:w-[17px] group-focus-visible:bg-accent-text group-focus-visible:opacity-100 ${message.id === activeConversationId ? 'w-3.5 bg-accent opacity-100' : 'w-2 bg-line-hover opacity-55'}`} aria-hidden="true" />
              <span className="pointer-events-none absolute right-[25px] top-1/2 block w-max max-w-[min(260px,calc(100vw_-_88px))] overflow-hidden rounded-[7px] border border-line-hover bg-[color-mix(in_srgb,var(--bg-elevated)_94%,transparent)] px-[9px] py-[7px] text-left text-[10px] leading-[1.35] text-secondary opacity-0 shadow-sm text-ellipsis whitespace-nowrap translate-x-[3px] -translate-y-1/2 transition-[opacity,transform] duration-[var(--duration-fast)] group-hover:translate-y-[-50%] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-y-[-50%] group-focus-visible:opacity-100" role="tooltip">{conversationPreview(message)}</span>
            </button>
          ))}
        </nav>
      ) : null}
      <button
        className={`absolute bottom-4 right-[max(12px,calc(var(--conversation-rail-offset)_-_6px))] z-[35] inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-line bg-elevated p-0 text-secondary shadow-md cursor-pointer transition-[opacity,transform,background-color] duration-[var(--duration-fast)] hover:bg-muted hover:text-primary hover:-translate-y-px max-compact:right-4 max-compact:bottom-3${scrolledUp ? '' : ' opacity-0 scale-[0.84] pointer-events-none'}`}
        type="button"
        aria-label="滚动到底部"
        onClick={() => {
          const container = containerRef.current;
          if (container) {
            stickToBottom.current = true;
            container.scrollTop = container.scrollHeight;
          }
          setScrolledUp(false);
          setNewMessage(false);
        }}
      >
        <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-accent px-[7px] py-0.5 text-[9px] font-semibold text-white whitespace-nowrap${newMessage ? '' : ' hidden'}`}>有新消息</span>
        <span className="inline-flex items-center justify-center"><ArrowDown size={16} /></span>
      </button>
      <div className={`absolute bottom-2.5 left-[max(24px,calc((100%_-_var(--content-max-width))/2))] h-2.5 w-9 rounded-full bg-[radial-gradient(circle_at_20%_50%,var(--accent)_0_2px,transparent_2.5px),radial-gradient(circle_at_50%_50%,var(--accent)_0_2px,transparent_2.5px),radial-gradient(circle_at_80%_50%,var(--accent)_0_2px,transparent_2.5px)] opacity-75 animate-[workbenchPulse_1.2s_ease-in-out_infinite] max-compact:left-[15px] max-compact:bottom-2${streaming && !permissionRequest ? '' : ' hidden'}`} aria-hidden={!streaming || Boolean(permissionRequest)} />
    </div>
  );
}
