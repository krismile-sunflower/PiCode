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
import { Icon } from './Icon';
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
    <div className={`thinking-block${streaming ? ' streaming-thinking' : ''}`}>
      <button
        type="button"
        className={`thinking-toggle${expanded ? ' expanded' : ''}`}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="chevron">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
            <path d="M2 1l4 3-4 3z" />
          </svg>
        </span>
        <span className="thinking-label">
          <Icon name="brain" width={12} height={12} /> 思考过程
        </span>
      </button>
      <div className={`thinking-content${expanded ? ' expanded' : ''}`}>{content}</div>
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
    <section className="welcome" aria-label="开始新会话">
      <div className="welcome-inner">
        <div className="welcome-intro">
          <div className="welcome-mark">
            <img src="/icons/tau-192.png" alt="" className="tau-icon-welcome" />
          </div>
          <span className="eyebrow">PiCode / new session</span>
          <h1>把想法变成<br /><em>下一步行动。</em></h1>
          <p className="hint">选择一个起点，或直接在下方描述你的任务。Pi 会保留必要的上下文，让工作自然地继续下去。</p>
        </div>
        <div className="welcome-starters" aria-label="常用起点">
          {starters.map((starter) => (
            <button
              className={`welcome-starter welcome-starter-${starter.id}`}
              key={starter.id}
              type="button"
              onClick={() => prefillComposer(starter.prompt)}
            >
              <span className="welcome-starter-index">{starter.index}</span>
              <span className="welcome-starter-copy">
                <strong>{starter.title}</strong>
                <span>{starter.description}</span>
              </span>
              <span className="welcome-starter-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        <div className="welcome-capabilities" aria-label="可用能力">
          <span><Icon name="changes" width={12} height={12} />⌘⇧G 审阅 Git 变更</span>
          <span><Icon name="shield" width={12} height={12} />设置里可切换请求确认 / 只读 / 完全访问</span>
          <span><Icon name="check" width={12} height={12} />计划模式：先确认步骤再执行</span>
          <span><Icon name="image" width={12} height={12} />可直接粘贴或拖入截图</span>
        </div>
        <div className="shortcuts-hint" aria-label="键盘快捷键">
          <span><kbd>/</kbd> 聚焦输入框</span>
          <span><kbd>⌘K</kbd> 打开命令</span>
          <span><kbd>↑</kbd> 上一条输入</span>
          <span><kbd>Esc</kbd> 停止生成</span>
          <button
            className="shortcuts-hint-more"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('pi-studio:show-shortcuts'))}
          >
            <kbd>⌘/</kbd> 全部快捷键
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
    <div className="message assistant assistant-error-message">
      <div className="assistant-error-card" role="alert">
        <span className="assistant-error-icon" aria-hidden="true">!</span>
        <div className="assistant-error-body">
          <strong className="assistant-error-title">操作失败</strong>
          <p className="assistant-error-summary">{message.content}</p>
        </div>
      </div>
      {canDelete ? (
        <div className="message-actions">
          <button className="message-delete-btn" type="button" aria-label="删除这条消息" title="删除这条消息" disabled={deleting} onClick={async () => {
            if (!message.sessionEntryId) return;
                const confirmed = await confirmDialog({ title: '删除这条消息？', message: '删除后会同步修改会话上下文。' });
                if (!confirmed) return;
            setDeleting(true);
            await onDelete?.(message.sessionEntryId);
            setDeleting(false);
          }}><Icon name="trash" width={12} height={12} /></button>
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
    <div ref={onElementRef} className={`message ${message.role}${message.history ? ' history' : ''}`} data-message-id={message.id}>
      <div className={`message-content${message.streaming ? ' streaming' : ''}`}>
        {message.role === 'assistant' && message.thinking ? (
          <ThinkingBlock content={message.thinking} streaming={message.streaming} />
        ) : null}
        {message.images?.length ? (
          <div className="message-images">
            {message.images.map((image, index) => (
              <img
                key={`${message.id}-image-${index}`}
                className="message-image"
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
        <div className="message-actions">
          {canCopy ? <CopyMessageButton text={message.content} /> : null}
          {canFork ? (
            <button
              className="message-edit-btn"
              type="button"
              aria-label="从这条消息分支出新会话"
              title="从这里分支：复制到此为止的对话为新会话"
              onClick={() => message.sessionEntryId && onFork?.(message.sessionEntryId)}
            >
              <Icon name="branch" width={12} height={12} />
            </button>
          ) : null}
          {canRegenerate ? (
            <button
              className="message-edit-btn"
              type="button"
              aria-label="重新生成这条回复"
              title="重新生成（会重放上一条用户消息）"
              onClick={() => onRegenerate?.()}
            >
              <Icon name="refresh" width={12} height={12} />
            </button>
          ) : null}
          {canEdit ? (
            <button className="message-edit-btn" type="button" aria-label="重新编辑这条消息" title="重新编辑并发送" onClick={() => onEdit?.(message)}>
              <Icon name="edit" width={12} height={12} />
            </button>
          ) : null}
          {canDelete ? (
            <button
              className="message-delete-btn"
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
              <Icon name="trash" width={12} height={12} />
            </button>
          ) : null}
        </div>
      ) : null}
      {hasUsage ? <span className="message-usage">{usageText(message.usage)}</span> : null}
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
    <div className={`subagent-child ${child.status}`}>
      <div
        className="subagent-child-head"
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
        <span className="subagent-child-dot" aria-hidden="true" />
        <span className="subagent-child-agent">{child.agent}</span>
        {child.phase ? <span className="subagent-child-phase">{child.phase}</span> : null}
        <span className="subagent-child-status">{subagentStatusLabel(child.status)}</span>
      </div>
      {child.task ? <div className="subagent-child-task">{child.task}</div> : null}
      {child.status === 'running' && child.currentTool ? (
        <div className="subagent-child-live">
          <span className="subagent-child-live-dot" aria-hidden="true" />
          {child.currentTool}
          {child.currentToolArgs ? <em>{child.currentToolArgs}</em> : null}
        </div>
      ) : null}
      {metrics.length ? <div className="subagent-child-metrics">{metrics.join(' · ')}</div> : null}
      {child.error ? <div className="subagent-child-error">{child.error}</div> : null}
      {open ? (
        <div className="subagent-child-body">
          {child.recentTools.length ? (
            <ul className="subagent-child-tools">
              {child.recentTools.slice(-8).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}
            </ul>
          ) : null}
          {child.output ? <div className="subagent-child-output">{child.output}</div> : null}
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
    <div className={`tool-card subagent-card${tool.history ? ' history' : ''}${running ? ' running' : ''}`} data-tool-call-id={tool.toolCallId}>
      <div
        className="tool-card-header"
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
        <span className="tool-header-left">
          <span className={`tool-card-chevron${expanded ? ' expanded' : ''}`}>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
              <path d="M2 1l4 3-4 3z" />
            </svg>
          </span>
          <Icon name="brain" className="subagent-card-icon" width={13} height={13} />
          <span className="tool-name">子代理</span>
          <span className="subagent-mode">{subagentModeLabel(run)}</span>
          {run.async ? <span className="subagent-flag">后台</span> : null}
          {run.timedOut ? <span className="subagent-flag warn">超时</span> : null}
          {run.stopped ? <span className="subagent-flag warn">已停止</span> : null}
        </span>
        <span className="tool-header-right">
          {summary.length ? <span className="subagent-summary">{summary.join(' · ')}</span> : null}
          <span className={`tool-status ${tool.status}`}>
            {{ pending: '等待中', streaming: '执行中', complete: '已完成', error: '失败' }[tool.status]}
          </span>
        </span>
      </div>
      <div className={`tool-card-body${expanded ? ' expanded' : ''}`}>
        {run.children.length ? (
          <div className="subagent-children">
            {run.children.map((child) => <SubagentChildRow key={`${child.index}-${child.agent}`} child={child} />)}
          </div>
        ) : null}
        {!run.live && running ? <div className="subagent-note">正在启动子代理…</div> : null}
        {run.asyncId ? <div className="subagent-note">后台运行 ID：<code>{run.asyncId}</code></div> : null}
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
      <div className="tool-diff">
        {oldText.split('\n').map((line, index) => (
          <div className="diff-line diff-removed" key={`old-${index}`}>- {line}</div>
        ))}
        {newText.split('\n').map((line, index) => (
          <div className="diff-line diff-added" key={`new-${index}`}>+ {line}</div>
        ))}
      </div>
    );
  }, [isEdit, tool.args]);

  return (
    <div className={`tool-card${terminalTool ? ' terminal-tool-card' : ''}${tool.history ? ' history' : ''}`} data-tool-call-id={tool.toolCallId}>
      <div
        className="tool-card-header"
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
        <span className="tool-header-left">
          <span className={`tool-card-chevron${expanded ? ' expanded' : ''}`}>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
              <path d="M2 1l4 3-4 3z" />
            </svg>
          </span>
          <span className="tool-name">{tool.toolName}</span>
          {argumentPreview(tool.args) ? (
            <span className="tool-args-preview">{argumentPreview(tool.args)}</span>
          ) : null}
        </span>
        <span className="tool-header-right">
          <button
            className="tool-action-btn copy-output-btn"
            type="button"
            title="复制输出"
            aria-label="复制工具输出"
            onClick={(event) => {
              event.stopPropagation();
              if (tool.output) void navigator.clipboard.writeText(tool.output);
            }}
          >
            <Icon name="copy" width={13} height={13} />
          </button>
          <span className={`tool-status ${tool.status}`}>{statusLabel}</span>
        </span>
      </div>
      <div className={`tool-card-body${expanded ? ' expanded' : ''}`}>
        {diff}
        {terminalTool && command ? (
          <div className="tool-terminal-command"><span>$</span><code>{command}</code></div>
        ) : null}
        {!isEdit && !terminalTool && Object.keys(tool.args).length ? (
          <div className="tool-args">{JSON.stringify(tool.args, null, 2)}</div>
        ) : null}
        <ToolOutput output={tool.output} />
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
function ToolOutput({ output }: { output: string }) {
  const [full, setFull] = useState(false);
  const lines = useMemo(() => output.split('\n'), [output]);
  const oversized = lines.length > OUTPUT_LINE_LIMIT || output.length > OUTPUT_CHAR_LIMIT;

  if (!oversized || full) {
    return (
      <div className="tool-output-wrapper">
        <div className="tool-output">{output}</div>
        {oversized ? (
          <button className="tool-output-toggle" type="button" onClick={() => setFull(false)}>收起（共 {lines.length} 行）</button>
        ) : null}
      </div>
    );
  }

  const visible = lines.slice(-OUTPUT_LINE_LIMIT).join('\n').slice(-OUTPUT_CHAR_LIMIT);
  return (
    <div className="tool-output-wrapper">
      <div className="tool-output-truncated">
        已省略前 {Math.max(0, lines.length - OUTPUT_LINE_LIMIT)} 行，显示最后 {Math.min(lines.length, OUTPUT_LINE_LIMIT)} 行
      </div>
      <div className="tool-output">{visible}</div>
      <div className="tool-output-actions">
        <button className="tool-output-toggle" type="button" onClick={() => setFull(true)}>显示全部（{lines.length} 行）</button>
        <button className="tool-output-toggle" type="button" onClick={() => void navigator.clipboard.writeText(output)}>复制全部</button>
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
    <section className="permission-request-card" role="region" aria-label="Pi 工具执行授权">
      <div className="permission-request-icon" aria-hidden="true"><Icon name="shield" width={17} height={17} /></div>
      <div className="permission-request-content">
        <div className="permission-request-heading">
          <div>
            <span className="permission-request-eyebrow">需要你的确认</span>
            <h3>允许 Pi {action}？</h3>
          </div>
          <span className={`permission-request-status${secondsLeft <= 30 ? ' urgent' : ''}`}>
            <span />{responding ? '已提交' : `${formatCountdown(secondsLeft)} 后自动拒绝`}
          </span>
        </div>
        {detail ? <pre className="permission-request-detail"><code>{detail}</code></pre> : null}
        <p className="permission-request-note">
          授权仅作用于当前操作；“本会话允许”只覆盖<strong>当前会话</strong>内的同一命令族或同一文件，换会话即失效。
        </p>
        <div className="permission-request-actions">
          {options.map((option) => {
            const label = optionLabel(option);
            const kind = label.includes('拒绝')
              ? 'deny'
              : label.includes('本会话')
                ? 'session'
                : 'once';
            const displayLabel = kind === 'session' ? '本会话允许' : label;
            return (
              <button
                className={`permission-request-button ${kind}`}
                type="button"
                disabled={responding}
                key={label}
                aria-label={displayLabel}
                onClick={() => respond(option)}
              >
                {displayLabel}
                <kbd className="permission-request-key" aria-hidden="true">{kind === 'deny' ? 'Esc' : kind === 'session' ? '⌘⇧⏎' : '⌘⏎'}</kbd>
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
    <div className={`chat-messages-wrap${switching ? ' is-switching' : ''}`}>
      {switching ? (
        <div className="session-switch-bar" role="status" aria-live="polite">
          <span className="session-switch-spinner" aria-hidden="true" />
          <span>正在切换会话…</span>
        </div>
      ) : null}
      <div
        className="messages"
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
        <nav className="conversation-minimap" aria-label="对话快速定位">
          {conversationAnchors.map((message, index) => (
            <button
              key={message.id}
              className={`conversation-marker${message.id === activeConversationId ? ' active' : ''}`}
              type="button"
              aria-label={conversationLabel(message, index)}
              aria-current={message.id === activeConversationId ? 'true' : undefined}
              style={{ top: `${4 + (conversationPositions[message.id] ?? (index + 0.5) / conversationAnchors.length) * 92}%` }}
              onClick={() => scrollToConversation(message.id)}
            >
              <span className="conversation-marker-line" aria-hidden="true" />
              <span className="conversation-marker-tooltip" role="tooltip">{conversationPreview(message)}</span>
            </button>
          ))}
        </nav>
      ) : null}
      <button
        className={`scroll-bottom-btn${scrolledUp ? '' : ' hidden'}`}
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
        <span className={`scroll-bottom-badge${newMessage ? '' : ' hidden'}`}>有新消息</span>
        <span className="scroll-bottom-icon"><Icon name="arrow-down" /></span>
      </button>
      <div className={`typing-indicator${streaming && !permissionRequest ? '' : ' hidden'}`} aria-hidden={!streaming || Boolean(permissionRequest)} />
    </div>
  );
}
