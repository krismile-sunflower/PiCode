import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  AppSnapshot,
  ExtensionUiRequest,
  FileAttachment,
  ImageAttachment,
  ModelInfo,
  SlashCommand,
  ToastMessage,
} from '../lib/types';
import { isInteractiveExtensionRequest, isPermissionRequest } from '../lib/extension-ui';
import {
  basename,
  extensionOf,
  formatTokens,
  imageExtensions,
  parseImagePaths,
  shortModelName,
  totalContextTokens,
  uniqueId,
} from '../lib/utils';
import {
  applySlashCompletion,
  fuzzyFilterCommands,
  matchSlashCommand,
} from '../lib/slash-commands';
import { controller } from '../app/controller';
import { notify } from '../app/controller-contracts';
import { invoke } from '@tauri-apps/api/core';
import { apiJson, isDesktop } from '../lib/desktop';
import { usageByModel, usageCsv } from '../lib/usage-report';
import { applyMention, expandMentions, matchMention, relativeMention, type MentionMatch } from '../lib/mentions';
import { pushInputHistory, readDraft, readInputHistory, writeDraft, writeInputHistory } from '../lib/composer-history';
import { readOptimizeTemplatePref, writeOptimizeTemplatePref } from '../lib/prompt-optimizer';
import { Select } from './Select';
import { THINKING_LEVELS, thinkingLevelLabel } from '../lib/thinking';
import { availableThinkingLevels } from '../lib/reasoning';
import {
  ArrowDown,
  ArrowUp,
  Brain,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Eye,
  ExternalLink,
  File as FileIcon,
  FileText,
  Folder,
  FolderTree,
  FoldVertical,
  ImageIcon,
  Info,
  Keyboard,
  LayoutGrid,
  LoaderCircle,
  Menu,
  Mic,
  PanelLeft,
  PenLine,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Shrink,
  Sparkles,
  Square,
  TriangleAlert,
  UnfoldVertical,
  X,
  type LucideIcon,
} from 'lucide-react';

interface HeaderProps {
  snapshot: AppSnapshot;
  sidebarOpen: boolean;
  onOpenSidebar(): void;
  fileOpen: boolean;
  onToggleFiles(): void;
}

const CONTEXT_SEGMENT_COLORS: Record<string, string> = {
  system: 'bg-thinking-accent',
  output: 'bg-thinking-accent',
  messages: 'bg-accent',
  tools: 'bg-tool-accent',
  cache: 'bg-success opacity-[0.72]',
  'cache-write': 'bg-warning opacity-80',
  estimated: 'bg-tool-accent opacity-[0.72]',
  free: 'bg-transparent',
};

const CONTEXT_DOT_COLORS: Record<string, string> = {
  system: 'bg-thinking-accent',
  output: 'bg-thinking-accent',
  messages: 'bg-accent',
  tools: 'bg-tool-accent',
  cache: 'bg-success opacity-[0.72]',
  'cache-write': 'bg-warning opacity-80',
  estimated: 'bg-tool-accent opacity-[0.72]',
  free: 'border border-line bg-muted',
};

export function Header({ snapshot, sidebarOpen, onOpenSidebar, fileOpen, onToggleFiles }: HeaderProps) {
  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [metricsOpen, setMetricsOpen] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!modelRef.current?.contains(event.target as Node)) setModelsOpen(false);
      if (!metricsRef.current?.contains(event.target as Node)) setMetricsOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    const openPicker = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      setModelQuery(detail?.query || '');
      setModelsOpen(true);
      setMetricsOpen(false);
    };
    window.addEventListener('pi-studio:open-model-picker', openPicker);
    return () => window.removeEventListener('pi-studio:open-model-picker', openPicker);
  }, []);

  const currentProvider = snapshot.currentModelProvider && snapshot.currentModelProvider !== 'unknown'
    ? snapshot.currentModelProvider
    : snapshot.defaultProvider;
  // Only levels the active model's reasoning profile actually accepts, so a
  // preset that marks minimal/low unsupported hides them instead of erroring
  // at request time.
  const thinkingOptions = useMemo(
    () => availableThinkingLevels(currentProvider, snapshot.currentModelId, snapshot.modelsConfig)
      .map((level) => ({ value: level, label: thinkingLevelLabel(level) })),
    [currentProvider, snapshot.currentModelId, snapshot.modelsConfig],
  );
  // Runtime list first, models.json entries fill the gaps: a provider added
  // while a session predates the refresh extension (or whose refresh failed)
  // must still be reachable from the picker instead of silently missing.
  const allModels = useMemo(() => {
    const result = new Map<string, ModelInfo>();
    for (const model of snapshot.models) {
      if (model.provider && model.id) result.set(`${model.provider}:${model.id}`, model);
    }
    for (const [provider, config] of Object.entries(snapshot.modelsConfig?.providers || {})) {
      for (const model of config.models || []) {
        if (!model.id || result.has(`${provider}:${model.id}`)) continue;
        result.set(`${provider}:${model.id}`, { id: model.id, name: model.name, provider, contextWindow: model.contextWindow });
      }
    }
    return [...result.values()];
  }, [snapshot.models, snapshot.modelsConfig]);
  const models = allModels.filter((model) => {
    // The list spans every configured provider — the chips row was removed,
    // so this dropdown is the only way to reach another provider's models.
    const query = modelQuery.trim().toLowerCase();
    return !query || `${model.id} ${model.name || ''}`.toLowerCase().includes(query);
  });
  // Label rows with their provider only when it is actually ambiguous.
  const multiProvider = new Set(allModels.map((model) => model.provider).filter(Boolean)).size > 1;
  const usage = snapshot.lastUsage;
  const latestContextTokens = totalContextTokens(usage);
  const hasReportedContext = snapshot.contextUsage !== undefined;
  const reportedTokens = snapshot.contextUsage?.tokens;
  const contextKnown = reportedTokens != null || (!hasReportedContext && latestContextTokens > 0);
  const used = reportedTokens ?? (hasReportedContext ? 0 : latestContextTokens);
  const total = snapshot.contextUsage?.contextWindow || snapshot.contextWindowSize;
  const percent = total > 0 && contextKnown
    ? Math.round((used / total) * 100)
    : snapshot.contextUsage?.percent != null
      ? Math.round(snapshot.contextUsage.percent)
      : 0;
  const workspaceTitle = snapshot.workspace.noFolder
    ? '对话 · 不绑定仓库'
    : snapshot.workspace.path || '工作区';
  const connectionText = snapshot.isStreaming
    ? 'Pi 正在处理…'
    : ({ connected: '已连接', connecting: '正在启动 Pi…', disconnected: '连接已断开', idle: '未打开项目' } as const)[snapshot.connection];
  const currentModelLabel = shortModelName(snapshot.currentModelId) || '模型';
  const detailSegments = usage
    ? [
        { key: 'cache', label: '缓存读取', tokens: usage.cacheRead || 0 },
        { key: 'messages', label: '输入', tokens: usage.input || 0 },
        { key: 'output', label: '输出', tokens: usage.output || 0 },
        { key: 'cache-write', label: '缓存写入', tokens: usage.cacheWrite || 0 },
      ].filter((segment) => segment.tokens > 0)
    : [];
  const detailedTokens = detailSegments.reduce((sum, segment) => sum + segment.tokens, 0);
  const canShowDetails = detailedTokens > 0 && detailedTokens <= used;
  const estimatedTokens = canShowDetails ? Math.max(0, used - detailedTokens) : used;
  const segments = contextKnown && total
    ? [
        ...(canShowDetails ? detailSegments : []),
        ...(estimatedTokens > 0
          ? [{ key: 'estimated', label: canShowDetails ? '会话增量（估算）' : '已用（估算）', tokens: estimatedTokens }]
          : []),
        { key: 'free', label: '可用', tokens: Math.max(0, total - used) },
      ]
    : [];

  const usageRows = useMemo(() => usageByModel(snapshot.timeline), [snapshot.timeline]);

  const selectModel = async (model: ModelInfo) => {
    setModelsOpen(false);
    setModelQuery('');
    await controller.setModel(model);
  };

  return (
    <header className="absolute inset-x-0 top-0 z-40 flex min-h-(--header-height) items-center justify-between gap-2.5 border-b border-line bg-(--header-bg) px-[18px] shadow-[0_1px_0_rgba(255,255,255,0.018)] [backdrop-filter:blur(22px)_saturate(120%)] max-narrow:px-3 max-compact:px-[9px]">
      <div className="flex min-w-0 items-center gap-2.5">
        <button className={`icon-btn ${sidebarOpen ? 'hidden' : 'inline-flex'} max-compact:inline-flex!`} type="button" title="打开会话栏" aria-label="打开会话栏" onClick={onOpenSidebar}>
          <Menu size={18} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-[1.25] max-compact:hidden">
          <span className="overflow-hidden max-w-[260px] text-[9px] font-semibold tracking-[0.055em] text-dim uppercase text-ellipsis whitespace-nowrap max-narrow:hidden" title={workspaceTitle}>{workspaceTitle}</span>
          <strong className="overflow-hidden max-w-[260px] text-[14px] font-bold tracking-[-0.02em] text-primary text-ellipsis whitespace-nowrap max-narrow:max-w-[180px] max-compact:text-[13px]">{snapshot.selectedSessionTitle || '新会话'}</strong>
        </div>
        <div className="ml-2 inline-flex items-center gap-1.5 border-l border-line pl-[13px] max-compact:m-0 max-compact:border-0 max-compact:p-0" title={snapshot.connection === 'idle' ? '打开一个项目以启动 Pi' : 'Pi 连接状态'}>
          <span className={`h-[7px] w-[7px] rounded-full border-0 ${snapshot.isStreaming || snapshot.connection === 'connecting' ? 'bg-accent animate-[workbenchPulse_1.4s_ease-in-out_infinite]' : snapshot.connection === 'connected' ? 'bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_12%,transparent)]' : snapshot.connection === 'disconnected' ? 'bg-error' : 'bg-ghost'}`} />
          <span className="text-[10px] font-medium text-dim whitespace-nowrap max-narrow:hidden">{connectionText}</span>
        </div>
      </div>
      <div className="flex flex-none min-w-0 items-center gap-2.5">
        <div className="relative" ref={modelRef}>
          <button className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-transparent bg-glass px-2.5 text-[10px] text-secondary cursor-pointer hover:border-line hover:bg-elevated hover:text-primary max-compact:max-w-[130px]" type="button" title="切换模型" aria-haspopup="listbox" aria-expanded={modelsOpen} onClick={() => setModelsOpen((value) => !value)}>
            <span className="overflow-hidden max-w-[156px] text-ellipsis whitespace-nowrap">{currentModelLabel}</span>
            <ChevronDown size={12} className={`flex-none opacity-70 transition-transform duration-[var(--duration-fast)] ease-[var(--ease)]${modelsOpen ? ' rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {modelsOpen ? (
            <div className="absolute right-0 top-[calc(100%_+_8px)] z-[1001] flex max-h-[420px] w-[min(330px,calc(100vw_-_24px))] flex-col overflow-hidden rounded-[10px] border border-line bg-frosted p-2 shadow-[var(--shadow-lg),var(--shadow-inset)]" role="listbox" aria-label="选择模型">
              <div className="flex items-center justify-between gap-3 px-1 pt-[3px] pb-[9px] text-[11px] font-semibold text-primary">
                <span>选择模型</span>
                <span className="max-w-[150px] overflow-hidden rounded-full bg-accent-subtle px-[7px] py-0.5 text-[9px] font-semibold text-accent-text text-ellipsis whitespace-nowrap">{currentProvider || '未选择供应商'}</span>
              </div>
              <input className="mb-[7px] h-9 w-full rounded-lg border border-line bg-muted px-[11px] text-[11px] text-primary outline-0 focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-subtle)] placeholder:text-dim" type="search" aria-label="搜索模型" placeholder="搜索全部供应商的模型…" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} autoFocus />
              {/* flex-1 + min-h-0: the list takes whatever space the header and
                  search box leave inside the 420px cap so the last rows (and
                  the scrollbar) are never clipped. */}
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                {models.length ? models.map((model) => {
                  const active = model.id === snapshot.currentModelId && model.provider === currentProvider;
                  const context = model.contextWindow || model.context_window || 0;
                  return (
                    <button className={`grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-[9px] py-[7px] text-left text-secondary cursor-pointer appearance-none hover:border-line hover:bg-glass-hover hover:text-primary${active ? ' border-[color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-accent-subtle text-accent-text' : ''}`} type="button" role="option" aria-selected={active} title={model.id} key={`${model.provider || ''}:${model.id}`} onClick={() => void selectModel(model)}>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="min-w-0 overflow-hidden font-mono text-[11px] leading-[1.3] text-ellipsis whitespace-nowrap">{shortModelName(model.id)}</span>
                        {model.name && model.name !== model.id ? <span className="min-w-0 overflow-hidden text-[9px] leading-[1.25] text-dim text-ellipsis whitespace-nowrap">{model.name}</span> : null}
                      </span>
                      <span className="inline-flex min-w-[34px] items-center justify-end gap-[7px] text-accent-text">
                        {multiProvider ? <span className="flex-none font-mono text-[9px] leading-none text-dim">{model.provider}</span> : null}
                        {context ? <span className="flex-none font-mono text-[9px] leading-none text-dim">{Math.round(context / 1000)}k</span> : null}
                        {active ? <Check size={13} /> : null}
                      </span>
                    </button>
                  );
                }) : <div className="block min-h-0 px-2.5 py-[22px] text-center text-[11px] text-dim cursor-default">当前供应商没有可用模型</div>}
              </div>
            </div>
          ) : null}
        </div>
        <Select
          variant="glass"
          ariaLabel="思考强度"
          value={snapshot.thinkingLevel}
          className="max-compact:hidden!"
          leading={<span>思考：</span>}
          options={thinkingOptions}
          onChange={(level) => void controller.setThinkingLevel(level)}
        />
        <div className="relative" ref={metricsRef}>
          <button className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-transparent bg-glass px-[9px] text-[10px] text-secondary cursor-pointer hover:border-line hover:bg-elevated hover:text-primary max-compact:w-8 max-compact:justify-center max-compact:p-0" type="button" title="查看会话上下文" onClick={() => setMetricsOpen((value) => !value)}>
            <ChartNoAxesColumn size={16} />
            {contextKnown && used > 0 ? <span className={`font-mono text-[10px] leading-none whitespace-nowrap max-compact:hidden! ${percent >= 80 ? 'text-error' : percent >= 60 ? 'text-warning' : ''}`}>{total ? (percent === 0 ? '<1%' : `${percent}%`) : formatTokens(used)}</span> : null}
            {snapshot.sessionTotalCost > 0 ? <span className="font-mono text-[10px] leading-none whitespace-nowrap max-compact:hidden!">${snapshot.sessionTotalCost.toFixed(4)}</span> : null}
          </button>
          {metricsOpen ? (
            <div className="absolute right-0 top-[calc(100%_+_8px)] z-[1001] w-[330px] max-w-[calc(100vw_-_24px)] rounded-[10px] border border-line bg-frosted p-[15px] shadow-[var(--shadow-lg),var(--shadow-inset)]">
              <div className="mb-[11px] text-[12px] font-semibold text-primary">会话上下文</div>
              {segments.length ? (
                <>
                  <div className="mb-[11px] flex h-5 overflow-hidden rounded-[7px] border border-line bg-muted">{segments.filter((segment) => segment.tokens > 0).map((segment) => <div className={`h-full min-w-[2px] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease)] ${CONTEXT_SEGMENT_COLORS[segment.key] || 'bg-transparent'}`} style={{ width: `${Math.min(100, (segment.tokens / total) * 100)}%` }} title={`${segment.label}: ${formatTokens(segment.tokens)}`} key={segment.key} />)}</div>
                  <div className="flex flex-col gap-1.5">{segments.map((segment) => <div className="flex items-center justify-between text-[10px] text-secondary" key={segment.key}><span className="flex items-center gap-1.5"><span className={`h-[7px] w-[7px] flex-none rounded-[2px] ${CONTEXT_DOT_COLORS[segment.key] || ''}`} />{segment.label}</span><span className="font-mono text-[9px] leading-[1.4] text-dim tabular-nums">{formatTokens(segment.tokens)}</span></div>)}</div>
                  <div className="mt-2.5 flex items-center justify-between border-t border-line pt-[9px] font-mono text-[9px] leading-[1.4] text-dim"><span>已使用 {percent}%</span><span>{formatTokens(used)} / {formatTokens(total)}</span></div>
                  {percent >= 80 ? <button className="compact-btn mt-3 w-full" type="button" onClick={() => void controller.compact()}>压缩上下文</button> : null}
                </>
              ) : <div className="mt-2.5 flex items-center justify-between border-t border-line pt-[9px] font-mono text-[9px] leading-[1.4] text-dim"><span>{hasReportedContext && reportedTokens == null ? '压缩后等待下一次回复确认' : '尚无用量数据'}</span></div>}
              <div className="mt-3 border-t border-line pt-2.5">
                <div className="mb-[11px] text-[12px] font-semibold text-primary">用量与成本</div>
                {usageRows.length ? (
                  <>
                    <table className="my-1.5 w-full border-collapse text-[10px] tabular-nums">
                      <thead>
                        <tr><th className="px-1 py-0.5 text-left font-medium text-dim">模型</th><th className="px-1 py-0.5 text-right font-medium text-dim">回复</th><th className="px-1 py-0.5 text-right font-medium text-dim">输入</th><th className="px-1 py-0.5 text-right font-medium text-dim">输出</th><th className="px-1 py-0.5 text-right font-medium text-dim">费用</th></tr>
                      </thead>
                      <tbody>
                        {usageRows.map((row) => (
                          <tr key={row.model}>
                            <td className="max-w-[110px] overflow-hidden border-t border-line px-1 py-[3px] text-left text-primary text-ellipsis whitespace-nowrap" title={row.model}>{shortModelName(row.model) || row.model}</td>
                            <td className="border-t border-line px-1 py-[3px] text-right text-secondary">{row.messages}</td>
                            <td className="border-t border-line px-1 py-[3px] text-right text-secondary">{formatTokens(row.input + row.cacheRead)}</td>
                            <td className="border-t border-line px-1 py-[3px] text-right text-secondary">{formatTokens(row.output)}</td>
                            <td className="border-t border-line px-1 py-[3px] text-right text-secondary">{row.cost ? `$${row.cost.toFixed(4)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-2.5 flex items-center justify-between border-t border-line pt-[9px] font-mono text-[9px] leading-[1.4] text-dim">
                      <span>会话累计 {snapshot.sessionTotalCost ? `$${snapshot.sessionTotalCost.toFixed(4)}` : '$0.0000'}</span>
                      <button
                        className="rounded-[var(--radius-pill)] border border-line bg-glass px-2 py-0.5 text-[10px] text-secondary hover:border-accent hover:text-accent-text"
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(usageCsv(usageRows));
                          window.dispatchEvent(new CustomEvent('pi-studio:toast', {
                            detail: { title: '用量已复制', message: 'CSV 已写入剪贴板', type: 'success' },
                          }));
                        }}
                      >
                        导出 CSV
                      </button>
                    </div>
                  </>
                ) : <div className="mt-2.5 flex items-center justify-between border-t border-line pt-[9px] font-mono text-[9px] leading-[1.4] text-dim"><span>本会话还没有产生用量记录</span></div>}
              </div>
            </div>
          ) : null}
        </div>
        <button id="file-sidebar-toggle" className="icon-btn" type="button" title="打开文件栏" aria-label="打开文件栏" aria-expanded={fileOpen} onClick={onToggleFiles}><Folder size={17} /></button>
      </div>
    </header>
  );
}

const maxImageDimension = 2048;
const validMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

async function processImage(file: File): Promise<ImageAttachment> {
  const inputMime = validMimeTypes.has(file.type) ? file.type : 'image/png';
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('解析图片失败'));
    element.src = dataUrl;
  });
  let width = image.width;
  let height = image.height;
  if (width > maxImageDimension || height > maxImageDimension) {
    const scale = maxImageDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持图片处理');
  context.drawImage(image, 0, 0, width, height);
  const mimeType = inputMime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const encoded = canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.85 : undefined);
  const data = encoded.split(',')[1];
  if (!data) throw new Error('图片编码失败');
  return { data, mimeType };
}

interface FileContentPayload {
  kind: string;
  name: string;
  mimeType: string;
  content?: string;
  reason?: string;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || imageExtensions.has(extensionOf(file.name));
}

// `items` and `files` overlap in most engines, but neither is reliable on its own inside
// WKWebView (a Finder copy often exposes only one of them), so read both and de-duplicate.
function collectImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file || !isImageFile(file)) return;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  for (const item of Array.from(data.items || [])) {
    if (item.kind === 'file') push(item.getAsFile());
  }
  for (const file of Array.from(data.files || [])) push(file);
  return files;
}

function fileFromBase64(data: string, mimeType: string, name: string): File {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type: mimeType });
}

interface ComposerProps {
  snapshot: AppSnapshot;
  pendingFiles: FileAttachment[];
  editingMessage: { entryId: string; text: string; images?: ImageAttachment[] } | null;
  onRemoveFile(path: string): void;
  onCancelEditing(): void;
  onOpenCommands(): void;
}

export function Composer({ snapshot, pendingFiles, editingMessage, onRemoveFile, onCancelEditing, onOpenCommands }: ComposerProps) {
  const [text, setText] = useState(() => readDraft(snapshot.selectedSessionFile));
  const [history, setHistory] = useState<string[]>(() => readInputHistory());
  // -1 means "editing a fresh draft"; 0+ walks back through sent messages.
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draftBeforeHistory = useRef('');
  const activeDraftSession = useRef(snapshot.selectedSessionFile);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [attachingCount, setAttachingCount] = useState(0);
  const [zoomedImage, setZoomedImage] = useState<ImageAttachment | null>(null);
  const [recording, setRecording] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeMenuOpen, setOptimizeMenuOpen] = useState(false);
  const [optimizeMenuRect, setOptimizeMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [optimizeTemplateName, setOptimizeTemplateName] = useState(() => readOptimizeTemplatePref());
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mention, setMention] = useState<MentionMatch | null>(null);
  const [mentionFiles, setMentionFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const optimizeRef = useRef<HTMLDivElement>(null);
  const optimizeMenuRef = useRef<HTMLDivElement>(null);
  const planReadOnly = snapshot.plan.phase === 'plan' || snapshot.plan.phase === 'review';
  // Only levels the active model's reasoning profile accepts (see Header).
  const thinkingOptions = useMemo(
    () => availableThinkingLevels(
      snapshot.currentModelProvider && snapshot.currentModelProvider !== 'unknown' ? snapshot.currentModelProvider : snapshot.defaultProvider,
      snapshot.currentModelId,
      snapshot.modelsConfig,
    ).map((level) => ({ value: level, label: thinkingLevelLabel(level) })),
    [snapshot.currentModelProvider, snapshot.defaultProvider, snapshot.currentModelId, snapshot.modelsConfig],
  );
  const knownFiles = useRef(new Set<string>());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const slashCommands = snapshot.slashCommands;
  const slashMatch = useMemo(() => matchSlashCommand(text, text.length), [text]);
  const slashResults = useMemo(() => {
    if (!slashMatch) return [] as SlashCommand[];
    // Show the full filtered list (no hard cap) so every command remains discoverable.
    return fuzzyFilterCommands(slashCommands, slashMatch.query);
  }, [slashCommands, slashMatch]);

  // Templates flagged `optimize: true` double as input-optimizer instructions.
  const optimizeTemplates = useMemo(
    () => (snapshot.prompts?.templates || []).filter((template) => template.optimize && template.body.trim()),
    [snapshot.prompts],
  );
  const activeOptimizeTemplate = optimizeTemplates.find((template) => template.name === optimizeTemplateName) || null;

  useEffect(() => {
    if (slashMatch && slashResults.length) {
      setSlashOpen(true);
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  }, [slashMatch, slashResults.length, slashMatch?.query]);

  // `@` opens a workspace file picker. The lookup is debounced and scoped to
  // the open project; without a project there is nothing to mention.
  useEffect(() => {
    if (!mention || !isDesktop || !snapshot.workspace.path || snapshot.workspace.noFolder) {
      setMentionFiles([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void invoke<Array<{ name: string; path: string }>>('search_project_files', {
        request: { path: snapshot.workspace.path, query: mention.query, limit: 12 },
      })
        .then((files) => {
          if (!cancelled) {
            setMentionFiles(files);
            setMentionIndex(0);
          }
        })
        .catch(() => {
          if (!cancelled) setMentionFiles([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mention, snapshot.workspace.noFolder, snapshot.workspace.path]);

  useEffect(() => {
    if (!slashOpen) return;
    const list = slashListRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-slash-index="${slashIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex, slashOpen, slashResults.length]);

  // The optimize menu lists templates flagged `optimize`; warm the catalog on
  // mount so the first open already shows them (loadPrompts caches its result).
  useEffect(() => {
    if (isDesktop) void controller.loadPrompts();
  }, []);

  useEffect(() => {
    if (!optimizeMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!optimizeRef.current?.contains(target) && !optimizeMenuRef.current?.contains(target)) setOptimizeMenuOpen(false);
    };
    // The menu is fixed-positioned; any scroll outside it would detach it
    // from the trigger, so close instead of tracking repositioning.
    const onScroll = (event: Event) => {
      if (optimizeMenuRef.current?.contains(event.target as Node)) return;
      setOptimizeMenuOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOptimizeMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('keydown', key);
    };
  }, [optimizeMenuOpen]);

  useEffect(() => {
    // Keep the active index in range if the filtered list shrinks.
    if (slashIndex >= slashResults.length) {
      setSlashIndex(Math.max(0, slashResults.length - 1));
    }
  }, [slashIndex, slashResults.length]);

  // Persist the draft per session so switching conversations (or restarting the
  // app) no longer throws away half-written instructions.
  useEffect(() => {
    if (editingMessage) return;
    writeDraft(activeDraftSession.current, text);
  }, [text, editingMessage]);

  useEffect(() => {
    const next = snapshot.selectedSessionFile;
    if (next === activeDraftSession.current) return;
    activeDraftSession.current = next;
    setText(readDraft(next));
    setHistoryIndex(-1);
  }, [snapshot.selectedSessionFile]);

  useEffect(() => {
    const added = pendingFiles.filter((file) => !knownFiles.current.has(file.path));
    if (added.length) {
      // Insert a mention token, not a bare path: the path alone told the model
      // a file exists, the mention makes its contents travel with the message.
      const tokens = added
        .map((file) => `@${relativeMention(file.path, snapshot.workspace.path || '')}`)
        .join(' ');
      setText((value) => `${value}${value && !value.endsWith(' ') ? ' ' : ''}${tokens} `);
    }
    knownFiles.current = new Set(pendingFiles.map((file) => file.path));
  }, [pendingFiles, snapshot.workspace.path]);

  useEffect(() => {
    const ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!ctor) return;
    const recognition = new ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';
    let baseText = '';
    recognition.addEventListener('result', (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      baseText += finalText;
      setText(baseText + interimText);
    });
    recognition.addEventListener('end', () => setRecording(false));
    recognition.addEventListener('error', () => setRecording(false));
    recognitionRef.current = recognition;
    return () => {
      try { recognition.stop(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [text]);

  useEffect(() => {
    const prefill = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (!prompt) return;
      setText(prompt);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(prompt.length, prompt.length);
      });
    };
    window.addEventListener('pi-studio:prefill-composer', prefill);
    return () => window.removeEventListener('pi-studio:prefill-composer', prefill);
  }, []);

  useEffect(() => {
    if (!zoomedImage) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomedImage(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [zoomedImage]);

  useEffect(() => {
    if (!editingMessage) return;
    setText(editingMessage.text);
    setImages(editingMessage.images || []);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, [editingMessage]);

  const reportAttachError = (title: string, error: unknown) => {
    window.dispatchEvent(new CustomEvent('pi-studio:toast', { detail: { title, message: String(error instanceof Error ? error.message : error), type: 'error' } }));
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(isImageFile);
    if (!list.length) return;
    setAttachingCount((count) => count + list.length);
    for (const file of list) {
      try {
        const processed = await processImage(file);
        setImages((current) => [...current, processed]);
      } catch (error) {
        reportAttachError('图片处理失败', error);
      } finally {
        setAttachingCount((count) => Math.max(0, count - 1));
      }
    }
  };

  // Pasting/dropping an image file from Finder often yields only its path, so read the
  // bytes back through the file API and attach them instead of littering the input.
  const addImagePaths = async (paths: string[]) => {
    setAttachingCount((count) => count + paths.length);
    for (const path of paths) {
      try {
        const payload = await apiJson<FileContentPayload>(`/api/file/content?path=${encodeURIComponent(path)}`);
        if (payload.kind !== 'image' || !payload.content) throw new Error(payload.reason || `无法读取图片：${path}`);
        const processed = await processImage(fileFromBase64(payload.content, payload.mimeType, payload.name || basename(path)));
        setImages((current) => [...current, processed]);
      } catch (error) {
        reportAttachError('读取图片失败', error);
      } finally {
        setAttachingCount((count) => Math.max(0, count - 1));
      }
    }
  };

  const mentionOpen = Boolean(mention && mentionFiles.length);

  const chooseMention = (relativePath: string) => {
    if (!mention) return;
    const next = applyMention(text, mention, relativePath);
    setText(next.text);
    setMention(null);
    setMentionFiles([]);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(next.caret, next.caret);
    });
  };

  const applySlash = (command: SlashCommand) => {
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const next = applySlashCompletion(text, command.name, cursor);
    setText(next.text);
    setSlashOpen(false);
    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (slashOpen && slashResults[slashIndex]) {
      applySlash(slashResults[slashIndex]);
      return;
    }
    if (!text.trim() && images.length === 0) return;
    // `@path` is a promise that the model will see the file, not its name.
    const message = snapshot.workspace.path && !snapshot.workspace.noFolder
      ? await expandMentions(text, snapshot.workspace.path)
      : text;
    const attachments = images;
    if (editingMessage) {
      const sent = await controller.resendLastUserMessage(editingMessage.entryId, message, attachments);
      if (!sent) return;
      onCancelEditing();
    } else {
      await controller.sendMessage(message, attachments);
    }
    const nextHistory = pushInputHistory(history, text);
    setHistory(nextHistory);
    setHistoryIndex(-1);
    writeInputHistory(nextHistory);
    setText('');
    setMention(null);
    writeDraft(activeDraftSession.current, '');
    setImages([]);
    setZoomedImage(null);
    setSlashOpen(false);
    pendingFiles.forEach((file) => onRemoveFile(file.path));
  };

  const removeFile = (file: FileAttachment) => {
    setText((value) => value.replace(`${file.path} `, '').replace(file.path, ''));
    onRemoveFile(file.path);
  };

  const clearAttachments = () => {
    setImages([]);
    setZoomedImage(null);
    pendingFiles.forEach(removeFile);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const files = collectImageFiles(clipboard);
    if (files.length) {
      // Without this the webview also drops the copied file's name/path into the textarea.
      event.preventDefault();
      void addFiles(files);
      return;
    }
    const paths = parseImagePaths(clipboard.getData('text/plain'));
    if (paths.length) {
      event.preventDefault();
      void addImagePaths(paths);
    }
  };

  const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const files = collectImageFiles(event.dataTransfer);
    if (files.length) {
      void addFiles(files);
      return;
    }
    const dropped = event.dataTransfer.getData('text/plain');
    const paths = parseImagePaths(dropped);
    if (paths.length) {
      void addImagePaths(paths);
      return;
    }
    if (dropped) setText((value) => `${value}${value ? ' ' : ''}${dropped} `);
  };

  const toggleRecording = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (recording) {
      try { recognition.stop(); } catch { /* already stopped */ }
      setRecording(false);
    } else {
      try {
        recognition.start();
        setRecording(true);
        textareaRef.current?.focus();
      } catch {
        setRecording(false);
      }
    }
  };

  // One-shot AI rewrite of the current draft. Errors are toasted by the
  // controller, so an empty result means "already reported" and the draft
  // stays untouched for manual editing.
  const openOptimizeMenu = () => {
    const rect = optimizeRef.current?.getBoundingClientRect();
    setOptimizeMenuRect(rect ? { left: rect.left, top: rect.top, width: rect.width } : null);
    setOptimizeMenuOpen(true);
  };

  const pickOptimizeTemplate = (name: string) => {
    setOptimizeTemplateName(name);
    writeOptimizeTemplatePref(name);
    setOptimizeMenuOpen(false);
  };

  const optimizeMenuItemClass = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[11px] appearance-none cursor-pointer${active ? ' bg-accent-subtle text-accent-text' : ' text-secondary hover:bg-glass-hover hover:text-primary'}`;

  const optimizeDraft = async () => {
    const source = text.trim();
    if (!source || optimizing) return;
    setOptimizing(true);
    try {
      const optimized = await controller.optimizePromptText(source, activeOptimizeTemplate?.body);
      if (!optimized) return;
      // The wait can be seconds; if the draft moved on meanwhile, don't
      // clobber the user's newer edits with a rewrite of stale text.
      const liveText = textareaRef.current?.value ?? text;
      if (liveText.trim() !== source) {
        notify('输入已优化', '检测到输入框内容已变化，未覆盖你的修改。', 'info');
        return;
      }
      setText(optimized);
      notify('输入已优化', 'AI 已重写输入框内容，可继续编辑后再发送。', 'success');
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(optimized.length, optimized.length);
      });
    } finally {
      setOptimizing(false);
    }
  };

  const sourceLabel = (source?: string) => {
    if (source === 'extension') return '扩展';
    if (source === 'prompt') return '模板';
    if (source === 'skill') return '技能';
    return '内置';
  };

  // Rendered through a portal: the toolbar sits inside an overflow-hidden
  // card, which would clip an absolutely positioned menu.
  const optimizeMenu = optimizeMenuOpen && optimizeMenuRect
    ? createPortal(
        <div
          ref={optimizeMenuRef}
          role="menu"
          aria-label="选择优化方式"
          className="fixed z-[500] max-h-[320px] w-[260px] overflow-auto rounded-[10px] border border-line bg-elevated p-1 shadow-lg"
          style={{
            right: window.innerWidth - optimizeMenuRect.left - optimizeMenuRect.width,
            bottom: window.innerHeight - optimizeMenuRect.top + 6,
          }}
        >
          <div className="px-2 pb-1 pt-1.5 text-[9px] font-bold tracking-[0.06em] text-dim uppercase">AI 优化输入</div>
          <button
            className={optimizeMenuItemClass(!activeOptimizeTemplate)}
            type="button"
            role="menuitemradio"
            aria-checked={!activeOptimizeTemplate}
            onClick={() => pickOptimizeTemplate('')}
          >
            <span className="min-w-0 truncate">默认优化</span>
            {!activeOptimizeTemplate ? <Check size={12} className="flex-none text-accent-text" /> : null}
          </button>
          {optimizeTemplates.map((template) => (
            <button
              key={template.name}
              className={optimizeMenuItemClass(activeOptimizeTemplate?.name === template.name)}
              type="button"
              role="menuitemradio"
              aria-checked={activeOptimizeTemplate?.name === template.name}
              title={template.description || template.body}
              onClick={() => pickOptimizeTemplate(template.name)}
            >
              <span className="min-w-0 truncate">/{template.name}</span>
              {activeOptimizeTemplate?.name === template.name ? <Check size={12} className="flex-none text-accent-text" /> : null}
            </button>
          ))}
          {!optimizeTemplates.length ? (
            <div className="px-2 py-1.5 text-[10px] leading-[1.5] text-dim">还没有自定义优化方式。在「定制 - 输入优化」新建优化模板即可添加。</div>
          ) : null}
          <div className="mt-1 border-t border-t-line pt-1">
            <button
              className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[11px] text-secondary cursor-pointer appearance-none hover:bg-glass-hover hover:text-primary"
              type="button"
              role="menuitem"
              onClick={() => {
                setOptimizeMenuOpen(false);
                controller.openOptimizeTemplates();
              }}
            >
              <Settings size={12} className="flex-none" />
              <span className="min-w-0 truncate">管理优化模板</span>
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="relative z-30 mt-0.5 flex-none overflow-visible border-0 border-t border-t-line bg-canvas pt-[14px] pb-[15px] px-[max(20px,calc((100%_-_var(--composer-max-width))/2))] [backdrop-filter:none] max-compact:p-2.5">
      {zoomedImage ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(0,0,0,0.74)] p-10 [backdrop-filter:blur(6px)] cursor-zoom-out" role="dialog" aria-modal="true" aria-label="附件预览" onClick={() => setZoomedImage(null)}>
          <img src={`data:${zoomedImage.mimeType};base64,${zoomedImage.data}`} alt="附件预览" className="max-h-full max-w-full rounded-[10px] object-contain shadow-md" />
          <button className="absolute right-[18px] top-[18px] inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-[rgba(255,255,255,0.14)] p-0 text-white cursor-pointer hover:bg-[rgba(255,255,255,0.26)]" type="button" aria-label="关闭预览"><X size={14} /></button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-line-hover bg-elevated shadow-[var(--shadow-md),var(--shadow-inset)] transition-[border-color,box-shadow] duration-[var(--duration-fast)] focus-within:border-[color-mix(in_srgb,var(--accent)_62%,var(--border))] focus-within:shadow-[0_0_0_3px_var(--accent-subtle),var(--shadow-md)]">
        {planReadOnly ? (
          <div className="flex min-h-8 items-center gap-[7px] border-b border-b-[color-mix(in_srgb,var(--warning)_32%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_10%,var(--bg-elevated))] px-3 py-[7px] text-[12px] leading-[1.45] text-[color-mix(in_srgb,var(--warning)_78%,var(--text-primary))]" role="status">
            <ShieldCheck size={13} />
            <span><strong className="mr-1 text-primary [font-weight:680]">计划模式</strong> 只读分析中：可以探索与搜索，不能改动项目。</span>
          </div>
        ) : null}
        {editingMessage ? (
          <div className="flex min-h-[34px] items-center justify-between gap-2.5 border-b border-b-[color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-accent-subtle px-3 py-[7px] text-[10px] text-accent-text">
            <span className="inline-flex items-center gap-1.5"><PenLine size={13} /> 正在重新编辑最后一条消息</span>
            <button className="rounded-[5px] border-0 bg-transparent px-[7px] py-[3px] text-[10px] text-secondary cursor-pointer hover:bg-glass-hover hover:text-primary" type="button" onClick={() => { setText(''); setImages([]); onCancelEditing(); }}>取消</button>
          </div>
        ) : null}
        {snapshot.queue.length ? (
          <div className="flex max-w-none flex-col gap-[5px] px-[9px] pt-2 pb-0">
            {snapshot.queue.map((item) => <div className="flex min-h-[34px] items-center gap-[7px] rounded-[9px] border border-line bg-muted px-[9px] py-1.5 text-[11px] text-secondary" key={item.id}><span className="text-accent-text">排队中</span><span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{item.message}</span><button className="inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-dim cursor-pointer hover:bg-glass-hover hover:text-error" type="button" title="取消排队" onClick={() => controller.cancelQueuedMessage(item.id)}><X size={12} /></button></div>)}
          </div>
        ) : null}
        {images.length || pendingFiles.length || attachingCount ? (
          <div className="border-b border-b-[color-mix(in_srgb,var(--border)_62%,transparent)] px-[11px] pt-[9px] pb-[3px]">
            <div className="mb-[7px] flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-[5px] text-[10px] tracking-[0.02em] text-dim">
                <ImageIcon size={12} />
                附件 {images.length + pendingFiles.length}
                {attachingCount ? <em className="text-accent-text not-italic">正在处理 {attachingCount}…</em> : null}
              </span>
              <button className="rounded-[5px] border-0 bg-transparent px-[7px] py-0.5 text-[10px] text-dim cursor-pointer hover:bg-glass-hover hover:text-secondary" type="button" onClick={clearAttachments}>清空</button>
            </div>
            <div className="flex gap-2 pb-[3px] overflow-x-auto">
              {images.map((image, index) => (
                <div className="group relative flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-[10px] border border-line bg-muted transition-[border-color,transform] duration-[var(--duration-fast)] hover:border-line-hover" key={`${image.data.slice(0, 24)}-${index}`}>
                  <button className="block h-full w-full border-0 bg-transparent p-0 cursor-zoom-in" type="button" title="点击查看大图" onClick={() => setZoomedImage(image)}>
                    <img src={`data:${image.mimeType};base64,${image.data}`} alt={`待发送图片 ${index + 1}`} className="block h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.46)] text-white opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-visible:opacity-100"><Eye size={13} /></span>
                  </button>
                  <button className="absolute right-[3px] top-[3px] inline-flex h-[17px] w-[17px] items-center justify-center rounded-full border-0 bg-[rgba(0,0,0,0.62)] p-0 text-white opacity-0 cursor-pointer transition-[opacity,background-color] duration-[var(--duration-fast)] group-hover:opacity-100 focus-visible:opacity-100 hover:bg-error" type="button" aria-label={`移除图片 ${index + 1}`} onClick={() => setImages((current) => current.filter((_, imageIndex) => imageIndex !== index))}><X size={9} /></button>
                </div>
              ))}
              {pendingFiles.map((file) => (
                <div className="group relative flex h-16 w-auto min-w-[88px] max-w-[190px] flex-none flex-col items-start justify-center gap-1 overflow-hidden rounded-[10px] border border-line bg-muted p-0 px-2.5 transition-[border-color,transform] duration-[var(--duration-fast)] hover:border-line-hover" title={file.path} key={file.path}>
                  <span className="text-[9px] font-semibold tracking-[0.06em] text-dim">{file.ext ? file.ext.slice(0, 4).toUpperCase() : 'FILE'}</span>
                  <span className="max-w-full overflow-hidden text-[10px] text-secondary text-ellipsis whitespace-nowrap">{file.name}</span>
                  <button className="absolute right-[3px] top-[3px] inline-flex h-[17px] w-[17px] items-center justify-center rounded-full border-0 bg-[rgba(0,0,0,0.62)] p-0 text-white opacity-0 cursor-pointer transition-[opacity,background-color] duration-[var(--duration-fast)] group-hover:opacity-100 focus-visible:opacity-100 hover:bg-error" type="button" aria-label={`移除文件 ${file.name}`} onClick={() => removeFile(file)}><X size={9} /></button>
                </div>
              ))}
              {Array.from({ length: attachingCount }, (_, index) => <div className="h-16 w-16 flex-none rounded-[10px] border border-line bg-[linear-gradient(100deg,var(--bg-muted)_30%,var(--bg-glass-hover)_50%,var(--bg-muted)_70%)] [background-size:240%_100%] animate-[attachment-shimmer_1.15s_linear_infinite]" key={`attaching-${index}`} aria-hidden="true" />)}
            </div>
          </div>
        ) : null}
        <form id="chat-form" className="block w-full" onSubmit={(event) => void submit(event)}>
          {slashOpen && slashResults.length ? (
            <div className="flex max-h-[min(420px,52vh)] flex-col overflow-hidden border-b border-b-line bg-elevated" role="listbox" aria-label="斜杠命令">
              <div className="flex-none px-3 pt-2 pb-1 text-[9px] font-bold tracking-[0.06em] text-dim uppercase">命令 · {slashResults.length} 项</div>
              <div className="min-h-0 flex-auto overflow-x-hidden overflow-y-auto px-1.5 pt-0.5 pb-1.5 [overscroll-behavior:contain] [scroll-padding-block:4px]" ref={slashListRef}>
                {slashResults.map((command, index) => (
                  <button
                    key={`${command.source || 'cmd'}:${command.name}`}
                    data-slash-index={index}
                    className={`grid w-full min-h-9 grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] items-center gap-2.5 rounded-lg border border-transparent bg-transparent px-[9px] py-[7px] text-left text-secondary cursor-pointer hover:border-[color-mix(in_srgb,var(--accent)_26%,var(--border))] hover:bg-accent-subtle hover:text-primary${index === slashIndex ? ' border-[color-mix(in_srgb,var(--accent)_26%,var(--border))]! bg-accent-subtle! text-primary!' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={index === slashIndex}
                    onMouseEnter={() => setSlashIndex(index)}
                    onClick={() => applySlash(command)}
                  >
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="whitespace-nowrap font-mono text-[12px] leading-[1.3] font-semibold text-accent-text">/{command.name}</span>
                      {command.argumentHint ? <span className="overflow-hidden text-[10px] text-dim text-ellipsis whitespace-nowrap">{command.argumentHint}</span> : null}
                    </span>
                    <span className="min-w-0 overflow-hidden text-[11px] text-dim text-ellipsis whitespace-nowrap">{command.description}</span>
                    <span className="flex-none rounded-full border border-line bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-dim whitespace-nowrap">{sourceLabel(command.source)}</span>
                  </button>
                ))}
              </div>
              <div className="flex-none flex gap-3 border-t border-t-line px-3 py-1.5 text-[9px] text-dim"><span><ArrowUp size={10} className="inline-block align-[-1px]" /><ArrowDown size={10} className="inline-block align-[-1px]" /> 选择</span><span>Tab/Enter 补全</span><span>Esc 关闭</span></div>
            </div>
          ) : null}
          {mentionOpen ? (
            <div className="mention-menu flex max-h-[min(420px,52vh)] flex-col overflow-hidden border-b border-b-line bg-elevated" role="listbox" aria-label="引用工作区文件">
              <div className="flex-none px-3 pt-2 pb-1 text-[9px] font-bold tracking-[0.06em] text-dim uppercase">引用文件 · 发送时会附上内容</div>
              <div className="min-h-0 flex-auto overflow-x-hidden overflow-y-auto px-1.5 pt-0.5 pb-1.5 [overscroll-behavior:contain] [scroll-padding-block:4px]">
                {mentionFiles.map((file, index) => (
                  <button
                    key={file.path}
                    className={`grid w-full min-h-9 grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] items-center gap-2.5 rounded-lg border border-transparent bg-transparent px-[9px] py-[7px] text-left text-secondary cursor-pointer hover:border-[color-mix(in_srgb,var(--accent)_26%,var(--border))] hover:bg-accent-subtle hover:text-primary${index === mentionIndex ? ' border-[color-mix(in_srgb,var(--accent)_26%,var(--border))]! bg-accent-subtle! text-primary!' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={index === mentionIndex}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => chooseMention(file.name)}
                  >
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="whitespace-nowrap font-mono text-[12px] leading-[1.3] font-semibold text-accent-text">{file.name}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex-none flex gap-3 border-t border-t-line px-3 py-1.5 text-[9px] text-dim"><span><ArrowUp size={10} className="inline-block align-[-1px]" /><ArrowDown size={10} className="inline-block align-[-1px]" /> 选择</span><span>Tab/Enter 引用</span><span>Esc 关闭</span></div>
            </div>
          ) : null}
          <div className="block">
            <textarea
              id="message-input"
              ref={textareaRef}
              value={text}
              placeholder={snapshot.selectedSessionFile ? '在当前会话中向 Pi 发送消息… 输入 / 查看命令' : '向 Pi 发送消息… 输入 / 查看命令'}
              rows={2}
              className="block w-full min-h-[52px] max-h-[132px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-[15px] pt-[14px] pb-[5px] text-[14px] leading-[1.5] text-primary shadow-none outline-0 placeholder:text-dim focus:border-0 focus:bg-transparent focus:shadow-none disabled:opacity-[0.42] disabled:cursor-not-allowed"
              onChange={(event) => {
                setText(event.target.value);
                setMention(matchMention(event.target.value, event.target.selectionStart ?? event.target.value.length));
              }}
              onClick={(event) => setMention(matchMention(text, event.currentTarget.selectionStart ?? text.length))}
              onKeyDown={(event) => {
                if (mentionOpen) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setMentionIndex((value) => Math.min(mentionFiles.length - 1, value + 1));
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setMentionIndex((value) => Math.max(0, value - 1));
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMention(null);
                    return;
                  }
                  if ((event.key === 'Tab' || event.key === 'Enter') && !event.nativeEvent.isComposing) {
                    const file = mentionFiles[mentionIndex];
                    if (file) {
                      event.preventDefault();
                      chooseMention(file.name);
                      return;
                    }
                  }
                }
                if (slashOpen && slashResults.length) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSlashIndex((value) => Math.min(slashResults.length - 1, value + 1));
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setSlashIndex((value) => Math.max(0, value - 1));
                    return;
                  }
                  if (event.key === 'Tab') {
                    event.preventDefault();
                    const command = slashResults[slashIndex];
                    if (command) applySlash(command);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setSlashOpen(false);
                    return;
                  }
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    const command = slashResults[slashIndex];
                    if (command) applySlash(command);
                    return;
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                  return;
                }
                // ArrowUp from the first line walks back through what was sent, the
                // way a shell does. Anywhere else it stays a cursor move.
                if (event.key === 'ArrowUp' && !event.shiftKey && history.length) {
                  const textarea = event.currentTarget;
                  const atStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;
                  if (!atStart && historyIndex < 0) return;
                  event.preventDefault();
                  const nextIndex = Math.min(history.length - 1, historyIndex + 1);
                  if (historyIndex < 0) draftBeforeHistory.current = text;
                  setHistoryIndex(nextIndex);
                  setText(history[nextIndex] || '');
                  return;
                }
                if (event.key === 'ArrowDown' && !event.shiftKey && historyIndex >= 0) {
                  event.preventDefault();
                  const nextIndex = historyIndex - 1;
                  setHistoryIndex(nextIndex);
                  setText(nextIndex < 0 ? draftBeforeHistory.current : history[nextIndex] || '');
                  return;
                }
                if (historyIndex >= 0 && event.key.length === 1) setHistoryIndex(-1);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onPaste={handlePaste}
            />
          </div>
          <div className="grid min-h-[42px] grid-cols-[minmax(0,1fr)_auto] items-center gap-[7px] px-[7px] pt-1 pb-[7px]">
            <div className="flex flex-nowrap items-center gap-0.5">
              <div className="inline-grid grid-cols-[repeat(2,auto)] gap-0.5 rounded-[7px] border border-line bg-glass p-0.5" role="group" aria-label="Agent 工作模式">
                <button
                  className={`min-h-[25px] rounded-[5px] border-0 bg-transparent px-2 text-[12px] font-semibold cursor-pointer transition-[background-color,color,box-shadow] duration-[var(--duration-fast)] enabled:hover:bg-glass-hover enabled:hover:text-primary max-compact:min-h-[27px] max-compact:px-[7px] ${planReadOnly ? 'bg-[color-mix(in_srgb,var(--warning)_16%,var(--bg-elevated))]! text-[color-mix(in_srgb,var(--warning)_86%,var(--text-primary))]! shadow-[var(--shadow-inset)]' : 'text-dim'}`}
                  type="button"
                  aria-pressed={planReadOnly}
                  disabled={snapshot.isStreaming || snapshot.sessionSwitching}
                  onClick={() => void controller.enterPlan()}
                >计划</button>
                <button
                  className={`min-h-[25px] rounded-[5px] border-0 bg-transparent px-2 text-[12px] font-semibold cursor-pointer transition-[background-color,color,box-shadow] duration-[var(--duration-fast)] enabled:hover:bg-glass-hover enabled:hover:text-primary max-compact:min-h-[27px] max-compact:px-[7px] ${!planReadOnly ? 'bg-accent-subtle! text-accent-text! shadow-[var(--shadow-inset)]' : 'text-dim'}`}
                  type="button"
                  aria-pressed={!planReadOnly}
                  disabled={snapshot.isStreaming || snapshot.sessionSwitching}
                  onClick={() => void controller.enterBuild()}
                >构建</button>
              </div>
              <button className="static inline-flex h-[29px] w-auto flex-none items-center justify-center gap-[5px] rounded-md border border-transparent bg-transparent px-2 text-[10px] text-secondary cursor-pointer hover:border-line hover:bg-glass-hover hover:text-primary max-compact:w-[30px] max-compact:p-0 max-compact:[&>span]:hidden" type="button" title="命令（Ctrl+K）" aria-label="打开命令" onClick={onOpenCommands}><span><Plus size={16} /></span><span>命令</span></button>
              <button className="static inline-flex h-[29px] w-auto flex-none items-center justify-center gap-[5px] rounded-md border border-transparent bg-transparent px-2 text-[10px] text-secondary cursor-pointer hover:border-line hover:bg-glass-hover hover:text-primary max-compact:w-[30px] max-compact:p-0 max-compact:[&>span]:hidden" type="button" title="添加图片" aria-label="添加图片" onClick={() => imageInputRef.current?.click()}><ImageIcon size={16} /><span>图片</span></button>
              <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} />
              {recognitionRef.current || window.SpeechRecognition || window.webkitSpeechRecognition ? <button className={`static inline-flex h-[29px] w-auto flex-none items-center justify-center gap-[5px] rounded-md border border-transparent bg-transparent px-2 text-[10px] text-secondary cursor-pointer hover:border-line hover:bg-glass-hover hover:text-primary max-compact:w-[30px] max-compact:p-0 max-compact:[&>span]:hidden${recording ? ' text-error! animate-[workbenchPulse_1.4s_ease-in-out_infinite]' : ''}`} type="button" title={recording ? '停止录音' : '语音输入'} onClick={toggleRecording}><Mic size={16} /><span>语音</span></button> : null}
              <div className="relative ml-auto flex-none" ref={optimizeRef}>
                <div className="inline-flex items-center">
                  <button
                    className={`static inline-flex h-[29px] w-auto flex-none items-center justify-center gap-[5px] rounded-l-md border border-transparent bg-transparent pr-1 pl-2 text-[10px] text-secondary cursor-pointer hover:border-line hover:bg-glass-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-[0.42] disabled:hover:border-transparent disabled:hover:bg-transparent max-compact:w-[30px] max-compact:p-0 max-compact:[&>span]:hidden${optimizing ? ' text-accent-text!' : ''}`}
                    type="button"
                    title={optimizing ? '正在优化输入…' : activeOptimizeTemplate ? `AI 优化输入 · /${activeOptimizeTemplate.name}` : 'AI 优化输入'}
                    aria-label={activeOptimizeTemplate ? `AI 优化输入（/${activeOptimizeTemplate.name}）` : 'AI 优化输入'}
                    aria-busy={optimizing}
                    disabled={optimizing || !text.trim()}
                    onClick={() => void optimizeDraft()}
                  >
                    {optimizing ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                    <span className="max-w-[96px] overflow-hidden text-ellipsis whitespace-nowrap">{activeOptimizeTemplate ? activeOptimizeTemplate.name : '优化'}</span>
                  </button>
                  <button
                    className="static inline-flex h-[29px] w-[18px] flex-none items-center justify-center rounded-r-md border border-transparent bg-transparent text-secondary cursor-pointer hover:border-line hover:bg-glass-hover hover:text-primary"
                    type="button"
                    title="选择优化方式"
                    aria-label="选择优化方式"
                    aria-haspopup="menu"
                    aria-expanded={optimizeMenuOpen}
                    onClick={() => (optimizeMenuOpen ? setOptimizeMenuOpen(false) : openOptimizeMenu())}
                  >
                    <ChevronDown size={11} className={`flex-none transition-transform duration-[var(--duration-fast)]${optimizeMenuOpen ? ' rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {optimizeMenu}
              <Select
                variant="ghost"
                align="end"
                ariaLabel="思考强度"
                value={snapshot.thinkingLevel}
                leading={<Brain size={14} />}
                options={thinkingOptions}
                onChange={(level) => void controller.setThinkingLevel(level)}
              />
            </div>
            <div className="hidden">
              <button className="workspace-chip inline-flex h-7 min-w-0 flex-none items-center gap-[5px] rounded-[7px] border border-transparent bg-transparent px-2 text-dim cursor-pointer hover:border-line hover:bg-glass-hover hover:text-secondary" type="button" title={snapshot.selectedSessionFile || '当前会话：新会话'}>
                <FileIcon size={13} className="flex-none opacity-70" />
                <span className="overflow-hidden max-w-[180px] text-secondary text-ellipsis whitespace-nowrap max-compact:max-w-[26vw]">{snapshot.selectedSessionTitle || '新会话'}</span>
                <span className="hidden">{snapshot.selectedSessionFile || ''}</span>
              </button>
            </div>
            <div className="flex items-center gap-1">
              {!snapshot.isStreaming ? <button id="send-btn" className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border-0 bg-accent-strong text-white shadow-[0_7px_16px_var(--accent-glow)] cursor-pointer transition-[background-color,transform] duration-[var(--duration-fast)] hover:bg-accent-hover hover:-translate-y-px disabled:opacity-[0.42] disabled:cursor-not-allowed" type="submit" title="发送消息" aria-label="发送消息"><ArrowUp size={16} /></button> : <button id="abort-btn" className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border-0 bg-error text-white shadow-[0_7px_16px_var(--accent-glow)] cursor-pointer transition-[background-color,transform] duration-[var(--duration-fast)] hover:bg-accent-hover hover:-translate-y-px disabled:opacity-[0.42] disabled:cursor-not-allowed" type="button" title="停止生成（Esc）" aria-label="停止生成" onClick={() => controller.abort()}><Square size={13} className="fill-current" /></button>}
            </div>
          </div>
        </form>
      </div>
      <div className="mt-2 text-center text-[9px] text-ghost max-compact:hidden">Enter 发送 · Shift+Enter 换行 · / 斜杠命令 · 内容可能存在错误，请检查重要信息</div>
    </div>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onClose(): void;
  onToggleSidebar(): void;
  onToggleFiles(): void;
  onShowShortcuts(): void;
}

interface CommandItem {
  icon: LucideIcon;
  label: string;
  description: string;
  shortcut?: string;
  keywords: string;
  action(): void | Promise<void>;
}

export function CommandPalette({ open, onClose, onToggleSidebar, onToggleFiles, onShowShortcuts }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const commands = useMemo<CommandItem[]>(() => [
    { icon: Plus, label: '新建会话', description: '在当前工作区创建一个新会话', shortcut: 'Ctrl+N', keywords: 'new session', action: () => controller.newSession() },
    { icon: Shrink, label: '压缩上下文', description: '压缩当前会话以节省上下文空间', keywords: 'compact context', action: () => controller.compact() },
    { icon: ExternalLink, label: '导出 HTML', description: '将当前会话导出为 HTML 文件', keywords: 'export html', action: () => controller.exportHtml() },
    { icon: ChartNoAxesColumn, label: '会话统计', description: '显示消息、工具调用和 Token 统计', keywords: 'stats token', action: () => controller.showSessionStats() },
    { icon: UnfoldVertical, label: '展开全部工具', description: '展开消息中的所有工具执行卡片', keywords: 'expand tools', action: () => window.dispatchEvent(new CustomEvent('pi-studio:tool-expand', { detail: { expanded: true } })) },
    { icon: FoldVertical, label: '折叠全部工具', description: '折叠消息中的所有工具执行卡片', keywords: 'collapse tools', action: () => window.dispatchEvent(new CustomEvent('pi-studio:tool-expand', { detail: { expanded: false } })) },
    { icon: PanelLeft, label: '切换会话栏', description: '显示或隐藏左侧会话栏', shortcut: 'Ctrl+B', keywords: 'sidebar', action: onToggleSidebar },
    { icon: FolderTree, label: '切换文件栏', description: '显示或隐藏当前工作区文件', shortcut: 'Ctrl+Shift+F', keywords: 'files', action: onToggleFiles },
    { icon: LayoutGrid, label: '打开项目', description: '查看并切换工作区项目', keywords: 'projects workspace', action: () => controller.setView('projects') },
    { icon: FileText, label: '打开变更', description: '在主区域查看 Git 变更与差异', keywords: 'git changes diff 变更', action: () => controller.setView('changes') },
    { icon: Settings, label: '打开设置', description: '管理外观、运行时和桌面行为', keywords: 'settings preferences', action: () => controller.setView('settings') },
    { icon: Keyboard, label: '键盘快捷键', description: '查看全部快捷键与全局热键', shortcut: 'Ctrl+/', keywords: 'shortcuts hotkeys keyboard 快捷键', action: onShowShortcuts },
  ], [onShowShortcuts, onToggleFiles, onToggleSidebar]);
  const visible = commands.filter((command) => !query.trim() || `${command.label} ${command.description} ${command.keywords}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    restoreFocus.current = document.activeElement as HTMLElement | null;
    window.requestAnimationFrame(() => inputRef.current?.focus());
    // A dialog with `aria-modal` must actually hold focus: without this, Tab
    // walked into the page behind the palette and Esc returned focus nowhere.
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', trap);
    return () => {
      window.removeEventListener('keydown', trap);
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const run = (index = activeIndex) => {
    const command = visible[index];
    if (!command) return;
    onClose();
    void Promise.resolve(command.action());
  };
  return (
    <>
      <div className="fixed inset-0 z-[500] bg-[rgba(3,5,9,0.6)] [backdrop-filter:blur(4px)]" onClick={onClose} />
      <div className="fixed left-1/2 top-[14vh] z-[510] w-[min(600px,calc(100vw_-_32px))] max-h-[min(620px,72vh)] -translate-x-1/2 overflow-hidden rounded-[15px] border border-line-hover bg-elevated shadow-lg animate-[paletteEnter_var(--duration)_var(--ease)] max-compact:top-[8vh]" role="dialog" aria-modal="true" aria-label="命令面板" ref={dialogRef}>
        <label className="flex h-[54px] items-center gap-2.5 border-b border-b-line px-[15px] text-dim"><Search size={17} /><input ref={inputRef} type="search" placeholder="搜索命令…" className="h-full flex-1 border-0 bg-transparent text-[14px] text-primary outline-none" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => Math.min(visible.length - 1, value + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)); }
          if (event.key === 'Enter') { event.preventDefault(); run(); }
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        }} /><kbd>Esc</kbd></label>
        <div className="px-3.5 pt-2.5 pb-[5px] text-[9px] font-bold tracking-[0.08em] text-dim uppercase">可用命令</div>
        <div className="max-h-[calc(min(620px,72vh)_-_110px)] overflow-auto px-[7px] pt-1 pb-2">
          {visible.length ? visible.map((command, index) => { const IconComponent = command.icon; return <button className={`grid w-full min-h-[50px] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-[9px] border-0 bg-transparent px-[9px] py-[7px] text-left text-inherit cursor-pointer${index === activeIndex ? ' bg-accent-subtle!' : ''} hover:bg-accent-subtle`} type="button" key={command.label} onMouseEnter={() => setActiveIndex(index)} onClick={() => run(index)}><span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-muted text-[14px]"><IconComponent size={14} /></span><span><span className="text-[12px] font-semibold text-primary">{command.label}</span><span className="block text-[10px] text-dim">{command.description}</span></span>{command.shortcut ? <kbd className="text-dim">{command.shortcut}</kbd> : <span />}</button>; }) : <div className="px-5 py-9 text-center text-dim">没有匹配的命令</div>}
        </div>
        <div className="flex gap-[15px] border-t border-t-line px-3.5 py-2 text-[9px] text-dim"><span><ArrowUp size={10} className="inline-block align-[-1px]" /><ArrowDown size={10} className="inline-block align-[-1px]" /> 选择</span><span>Enter 执行</span><span>Ctrl+/ 查看全部快捷键</span></div>
      </div>
    </>
  );
}

export function ToastRegion() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<Omit<ToastMessage, 'id'>>).detail || { title: '提示' };
      const item: ToastMessage = { id: uniqueId('toast'), title: detail.title || '提示', message: detail.message, type: detail.type || 'info', duration: detail.duration ?? 3600 };
      setToasts((current) => [...current, item]);
      if ((item.duration || 0) > 0) window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== item.id)), item.duration);
    };
    window.addEventListener('pi-studio:toast', listener);
    return () => window.removeEventListener('pi-studio:toast', listener);
  }, []);
  const icons: Record<string, LucideIcon> = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info };
  return (
    <div className="pointer-events-none fixed bottom-[18px] right-[18px] z-[1000] flex w-[min(360px,calc(100vw_-_36px))] flex-col gap-2" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => { const ToastIcon = icons[toast.type || 'info']; return <div className={`pointer-events-auto grid grid-cols-[20px_1fr_auto] items-start gap-[9px] rounded-[11px] border border-line-hover bg-elevated px-3 py-[11px] text-secondary shadow-lg animate-[toastEnter_var(--duration)_var(--ease)] ${toast.type || 'info'}`} key={toast.id}><span className={`${toast.type === 'success' ? 'text-success' : toast.type === 'error' ? 'text-error' : toast.type === 'warning' ? 'text-warning' : 'text-dim'}`}><ToastIcon size={13} /></span><span><span className="text-[11px] font-semibold text-primary">{toast.title}</span>{toast.message ? <span className="mt-0.5 block text-[10px] text-dim">{toast.message}</span> : null}</span><button className="inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-dim cursor-pointer hover:bg-glass-hover hover:text-primary" type="button" aria-label="关闭通知" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X size={12} /></button></div>; })}
    </div>
  );
}

function optionLabel(option: string | { label: string; value: unknown }): string {
  return typeof option === 'string' ? option : option.label;
}

function optionValue(option: string | { label: string; value: unknown }): unknown {
  return typeof option === 'string' ? option : option.value;
}

export function ExtensionDialog({ request }: { request: ExtensionUiRequest | null }) {
  const [value, setValue] = useState('');
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!request || !isInteractiveExtensionRequest(request)) return;
    setValue(String(request?.value || request?.defaultValue || request?.prefill || ''));
    const timeout = request.timeout ? window.setTimeout(() => controller.respondToExtension(request, { cancelled: true }), Number(request.timeout)) : null;
    window.requestAnimationFrame(() => fieldRef.current?.focus());
    return () => { if (timeout != null) window.clearTimeout(timeout); };
  }, [request]);
  if (!request || !isInteractiveExtensionRequest(request) || isPermissionRequest(request)) return null;
  const cancel = () => controller.respondToExtension(request, { cancelled: true });
  const title = request.title || ({ select: '请选择', confirm: '确认操作', input: '输入内容', editor: '编辑内容', notify: '扩展通知' } as Record<string, string>)[request.method] || '扩展请求';
  return (
    <div id="dialog-container" className="fixed inset-0 z-[800] grid place-items-center bg-[rgba(3,5,9,0.58)] p-5 [backdrop-filter:blur(4px)]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel(); }}>
      <div className={`w-[min(480px,100%)] max-h-[min(680px,86vh)] overflow-auto rounded-[15px] border border-line-hover bg-elevated p-5 shadow-lg animate-[paletteEnter_var(--duration)_var(--ease)]${request.method === 'editor' ? '' : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event: ReactKeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key === 'Enter' && request.method === 'input') { event.preventDefault(); controller.respondToExtension(request, value.trim() ? { value: value.trim() } : { cancelled: true }); }
      }}>
        <div className="text-[16px] font-semibold text-primary whitespace-pre-wrap">{title}</div>
        {request.message ? <div className="mt-2 text-secondary">{request.message}</div> : null}
        {request.method === 'select' ? <div className="mt-3.5 grid gap-1.5">{(request.options || []).map((option) => <button className="w-full rounded-[9px] border border-line bg-panel px-[11px] py-2.5 text-left text-secondary cursor-pointer hover:border-line-hover hover:bg-muted hover:text-primary" type="button" key={optionLabel(option)} onClick={() => controller.respondToExtension(request, { value: optionValue(option) })}>{optionLabel(option)}</button>)}</div> : null}
        {request.method === 'input' ? <input ref={fieldRef as React.RefObject<HTMLInputElement>} className="mt-3.5 w-full rounded-[9px] border border-line bg-panel px-2.5 py-[9px] text-primary outline-0 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-subtle)]" type="text" placeholder={String(request.placeholder || '')} value={value} onChange={(event) => setValue(event.target.value)} /> : null}
        {request.method === 'editor' ? <textarea ref={fieldRef as React.RefObject<HTMLTextAreaElement>} className="mt-3.5 min-h-[140px] w-full resize-y rounded-[9px] border border-line bg-panel px-2.5 py-[9px] font-mono text-[11px] leading-[1.55] text-primary outline-0 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-subtle)]" value={value} onChange={(event) => setValue(event.target.value)} /> : null}
        <div className="mt-4 flex justify-end gap-2">
          {request.method !== 'notify' ? <button className="min-h-[34px] min-w-[76px] rounded-lg border border-line bg-panel px-[13px] text-secondary cursor-pointer enabled:hover:border-line-hover enabled:hover:bg-muted enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => request.method === 'confirm' ? controller.respondToExtension(request, { confirmed: false }) : cancel()}>取消</button> : null}
          {request.method === 'confirm' ? <button className={`min-h-[34px] min-w-[76px] rounded-lg px-[13px] text-white cursor-pointer enabled:hover:border-line-hover enabled:hover:bg-muted enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 ${request.destructive ? 'border-error bg-error' : 'border-accent bg-accent'}`} type="button" onClick={() => controller.respondToExtension(request, { confirmed: true })}>确认</button> : null}
          {request.method === 'input' || request.method === 'editor' ? <button className="min-h-[34px] min-w-[76px] rounded-lg border border-accent bg-accent px-[13px] text-white cursor-pointer enabled:hover:border-line-hover enabled:hover:bg-muted enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => controller.respondToExtension(request, value ? { value } : { cancelled: true })}>{request.method === 'editor' ? '保存' : '提交'}</button> : null}
          {request.method === 'notify' ? <button className="min-h-[34px] min-w-[76px] rounded-lg border border-accent bg-accent px-[13px] text-white cursor-pointer enabled:hover:border-line-hover enabled:hover:bg-muted enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => controller.respondToExtension(request, { acknowledged: true })}>知道了</button> : null}
        </div>
      </div>
    </div>
  );
}
