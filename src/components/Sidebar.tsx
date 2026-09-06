import { useEffect, useMemo, useState } from 'react';
import { postJson } from '../lib/desktop';
import type { AppSnapshot, PiInstance, PiSession, SessionProject, WorkspaceView } from '../lib/types';
import { basename, formatRelativeTime } from '../lib/utils';
import { controller } from '../app/controller';
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  GitBranch,
  LayoutGrid,
  PenLine,
  Plus,
  RotateCw,
  Search,
  Settings,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { confirmDialog } from './ConfirmDialog';

interface SidebarProps {
  snapshot: AppSnapshot;
  open: boolean;
  onToggle(): void;
  onClose(): void;
}

interface ContextMenuState {
  x: number;
  y: number;
  session: PiSession;
  project: SessionProject;
}

const NAV_ITEMS: Array<{ view: WorkspaceView; icon: LucideIcon; label: string }> = [
  { view: 'projects', icon: LayoutGrid, label: '项目' },
  { view: 'changes', icon: FileText, label: '变更' },
  { view: 'customization', icon: Download, label: '定制' },
  { view: 'settings', icon: Settings, label: '设置' },
];

function projectKey(project: SessionProject): string {
  return project.noFolder ? '__no_folder__' : project.dirName || project.path || '';
}

function sessionTitle(session: PiSession): string {
  return session.name || session.firstMessage || '空会话';
}

export function Sidebar({ snapshot, open, onToggle, onClose }: SidebarProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [liveOpen, setLiveOpen] = useState(true);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('tau-favourites') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const [archived, setArchived] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('pi-studio:archived-sessions') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  const startIsolated = async () => {
    const label = window.prompt('给这个任务起个短名字（用于隔离副本目录）', 'task');
    if (label === null) return;
    await controller.newIsolatedSession(label);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void controller.searchSessions(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const close = () => {
      setContextMenu(null);
      setModeMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const visible = snapshot.sessionProjects
      .map((project) => ({ ...project, sessions: project.sessions.filter((session) => !archived.includes(session.filePath)) }))
      .filter((project) => project.sessions.length > 0);
    if (!normalized) return visible;
    return visible
      .map((project) => ({
        ...project,
        sessions: project.sessions.filter((session) =>
          `${sessionTitle(session)} ${session.filePath}`.toLowerCase().includes(normalized),
        ),
      }))
      .filter((project) => project.sessions.length > 0);
  }, [archived, query, snapshot.sessionProjects]);

  const archivedSessions = useMemo(
    () => snapshot.sessionProjects.flatMap((project) => project.sessions.filter((session) => archived.includes(session.filePath)).map((session) => ({ session, project }))),
    [archived, snapshot.sessionProjects],
  );

  const favoriteSessions = useMemo(
    () =>
      snapshot.sessionProjects.flatMap((project) =>
        project.sessions
          .filter((session) => favorites.includes(session.filePath))
          .map((session) => ({ session, project })),
      ),
    [favorites, snapshot.sessionProjects],
  );

  const toggleFavorite = (filePath: string) => {
    setFavorites((current) => {
      const next = current.includes(filePath)
        ? current.filter((item) => item !== filePath)
        : [...current, filePath];
      localStorage.setItem('tau-favourites', JSON.stringify(next));
      return next;
    });
  };

  const toggleArchive = (filePath: string) => {
    setArchived((current) => {
      const next = current.includes(filePath)
        ? current.filter((item) => item !== filePath)
        : [...current, filePath];
      localStorage.setItem('pi-studio:archived-sessions', JSON.stringify(next));
      return next;
    });
    setContextMenu(null);
  };

  const stopLiveInstance = async (instance: PiInstance) => {
    if (instance.pid == null) return;
    const path = instance.projectPath || instance.project_path || '';
    const confirmed = await confirmDialog({
      title: `停止 ${basename(path) || '无文件夹'} 的 Pi 实例？`,
      message: '该实例中未完成的生成会中断；会话记录仍保留在磁盘上。',
      confirmLabel: '停止',
    });
    if (!confirmed) return;
    await controller.stopInstance(instance.pid);
  };

  const deleteSession = async (session: PiSession) => {
    const confirmed = await confirmDialog({
      title: `删除“${sessionTitle(session)}”？`,
      message: '该会话记录将从磁盘移除，无法撤销。',
      detail: session.filePath,
    });
    if (!confirmed) return;
    await postJson('/api/sessions/delete', { filePath: session.filePath });
    setFavorites((current) => {
      const next = current.filter((item) => item !== session.filePath);
      localStorage.setItem('tau-favourites', JSON.stringify(next));
      return next;
    });
    setArchived((current) => {
      const next = current.filter((item) => item !== session.filePath);
      localStorage.setItem('pi-studio:archived-sessions', JSON.stringify(next));
      return next;
    });
    if (snapshot.selectedSessionFile === session.filePath) await controller.selectSession(null, null);
    await controller.loadSessions();
  };

  const renameSession = async (session: PiSession, name: string) => {
    const value = name.trim();
    setRenaming(null);
    if (!value || value === sessionTitle(session)) return;
    await controller.rpcCommand({ type: 'set_session_name', name: value });
    await controller.loadSessions();
  };

  const renderSession = (session: PiSession, project: SessionProject) => {
    const active = snapshot.selectedSessionFile === session.filePath;
    const isArchived = archived.includes(session.filePath);
    return (
      <div
        className={`group relative flex min-h-[33px] min-w-0 items-center gap-[7px] my-px rounded-[7px] border border-transparent py-1.5 pl-[11px] pr-[9px] cursor-pointer transition-[background-color,border-color] duration-[var(--duration-fast)] hover:bg-glass-hover focus-visible:border-accent focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--accent-subtle)] active:bg-muted${active ? ' bg-accent-subtle before:absolute before:inset-y-[6px] before:left-0 before:w-0.5 before:rounded-r-[2px] before:bg-accent before:content-[""]' : ''}${isArchived ? ' opacity-[0.76] hover:opacity-100' : ''}`}
        data-file-path={session.filePath}
        role="button"
        tabIndex={0}
        key={session.filePath}
        onClick={() => void controller.selectSession(session, project)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void controller.selectSession(session, project);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, session, project });
        }}
      >
        {favorites.includes(session.filePath) ? <span className="flex-none text-[10px] text-accent-text"><Star size={10} fill="currentColor" /></span> : null}
        {renaming === session.filePath ? (
          <input
            className="w-full min-w-0 rounded-[7px] border border-accent bg-panel px-[7px] py-1 text-[13px] text-primary outline-0 shadow-[0_0_0_2px_var(--accent-subtle)]"
            autoFocus
            defaultValue={sessionTitle(session)}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => void renameSession(session, event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setRenaming(null);
            }}
          />
        ) : (
          <>
            <span className={`min-w-0 flex-1 overflow-hidden text-[13px] leading-[1.45] text-primary text-ellipsis whitespace-nowrap ${active ? '[font-weight:660]' : '[font-weight:520]'}`} title={sessionTitle(session)}>{sessionTitle(session)}</span>
            {session.live ? <span className="flex-none rounded-[4px] border border-[color-mix(in_srgb,var(--success)_30%,var(--border))] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] px-[5px] py-px text-[9px] font-bold tracking-[0.03em] text-success uppercase">live</span> : null}
            {session.tmux ? <span className="flex-none rounded-[4px] border border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-accent-subtle px-[5px] py-px text-[9px] font-bold tracking-[0.03em] text-accent-text uppercase">tmux</span> : null}
            <span className={`flex-none text-[11px] leading-[1.3] tabular-nums whitespace-nowrap ${active ? 'text-accent-text opacity-80' : 'text-ghost group-hover:text-dim'}`}>{formatRelativeTime(session.timestamp)}</span>
          </>
        )}
      </div>
    );
  };

  // Isolated copies run as their own Pi process, so more than one live
  // instance means genuinely parallel sessions worth switching between.
  const liveInstances = snapshot.liveInstances;
  const activePid = liveInstances.find((instance) =>
    (instance.projectPath || instance.project_path || '') === snapshot.workspace.path)?.pid;

  const workspaceLabel = snapshot.workspace.noFolder
    ? '对话'
    : basename(snapshot.workspace.path) || '准备工作区…';
  const workspacePath = snapshot.workspace.noFolder
    ? 'PiCode 专属目录'
    : snapshot.workspace.path || '点击选择项目';

  return (
    <>
      <aside className={`relative z-[120] flex h-full w-(--sidebar-width) min-w-(--sidebar-width) flex-col overflow-hidden border-0 border-r border-r-line bg-[color-mix(in_srgb,var(--bg-sidebar)_94%,transparent)] [backdrop-filter:none] [transition:margin-left_var(--duration-slow)_var(--ease),transform_var(--duration-slow)_var(--ease)] max-compact:fixed! max-compact:top-0 max-compact:bottom-0 max-compact:left-0 max-compact:z-[310] max-compact:w-[min(var(--sidebar-width),88vw)]! max-compact:min-w-[min(var(--sidebar-width),88vw)]! max-compact:max-w-none! max-compact:shadow-lg max-compact:m-0!${open ? ' max-compact:translate-x-0' : ' -ml-[calc(var(--sidebar-width)_+_5px)] max-compact:ml-0! max-compact:translate-x-[-102%]'}`} id="sidebar" aria-label="会话导航">
        <header className="flex min-h-(--header-height) items-center gap-1 border-b border-line pl-2 pr-1.5 [-webkit-app-region:drag]">
          <button className="workspace-chip group" type="button" title={`${workspaceLabel} · ${workspacePath}`} onClick={() => controller.setView('projects')}>
            <img src="/icons/tau-192.png" alt="" className="h-[19px] w-[19px] flex-none rounded-[5px]" />
            <span className="min-w-0 flex-1 overflow-hidden text-[14px] [font-weight:690] tracking-[-0.02em] text-ellipsis whitespace-nowrap">{workspaceLabel}</span>
            <ChevronRight size={13} className="flex-none rotate-90 text-ghost group-hover:text-secondary" />
          </button>
          <button className="icon-btn sidebar-collapse-btn max-compact:hidden!" type="button" onClick={onToggle} title={open ? '折叠会话栏' : '展开会话栏'} aria-expanded={open}>
            <ChevronLeft size={15} />
          </button>
        </header>

        <div className="flex gap-[5px] px-[9px] pt-[9px] pb-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-[7px] rounded-lg border border-line bg-glass px-[9px] text-dim transition-[border-color,box-shadow,background-color,color] duration-[var(--duration-fast)] focus-within:border-accent focus-within:bg-panel focus-within:text-primary focus-within:shadow-[0_0_0_2px_var(--accent-subtle)]">
            <Search size={13} />
            <input type="search" className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13px] text-primary shadow-none outline-none placeholder:text-dim focus:border-0 focus:bg-transparent focus:shadow-none [&::-webkit-search-cancel-button]:hidden" placeholder="搜索会话" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-line bg-glass text-secondary cursor-pointer transition-[color,background-color,border-color,transform] duration-[var(--duration-fast)] hover:border-line-hover hover:bg-elevated hover:text-primary active:scale-[0.94]" type="button" title="刷新会话" aria-label="刷新会话" onClick={() => void controller.loadSessions()}>
            <RotateCw size={14} />
          </button>
          <div className="relative flex items-center gap-px">
            <button className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-accent-strong bg-accent-strong text-white cursor-pointer transition-[color,background-color,border-color,transform] duration-[var(--duration-fast)] hover:border-accent-hover hover:bg-accent-hover hover:text-white active:scale-[0.94]" type="button" title="新建会话 (Ctrl+N)" aria-label="新建会话" onClick={() => void controller.newSession()}>
              <Plus size={15} />
            </button>
            <button
              className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-line bg-glass px-1 text-secondary cursor-pointer transition-[color,background-color,border-color,transform] duration-[var(--duration-fast)] hover:border-line-hover hover:bg-elevated hover:text-primary active:scale-[0.94]"
              type="button"
              title="选择新会话的工作方式"
              aria-label="选择新会话的工作方式"
              aria-expanded={modeMenuOpen}
              onClick={(event) => { event.stopPropagation(); setModeMenuOpen((value) => !value); }}
            >
              <ChevronRight size={11} />
            </button>
            {modeMenuOpen ? (
              <div className="absolute right-0 top-full z-[130] mt-1.5 flex w-[300px] flex-col gap-0.5 rounded-[var(--radius-md)] border border-line-hover bg-elevated p-[5px] shadow-md" onClick={(event) => event.stopPropagation()}>
                <button className="group flex w-full items-start gap-[9px] rounded-lg border border-transparent bg-transparent px-[9px] py-2 text-left text-primary cursor-pointer transition-[background-color,border-color] duration-[var(--duration-fast)] hover:border-line hover:bg-glass-hover" type="button" onClick={() => { setModeMenuOpen(false); void controller.newSession(); }}>
                  <span className="mt-px grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px] bg-glass text-secondary transition-colors group-hover:bg-accent-subtle group-hover:text-accent-text"><PenLine size={12} /></span>
                  <span className="flex min-w-0 flex-col gap-px text-left"><strong className="text-[12.5px] font-semibold leading-[1.35] text-primary">直接改工作区</strong><small className="text-[10.5px] leading-[1.45] text-dim">Pi 直接修改当前项目文件</small></span>
                </button>
                <button className="group flex w-full items-start gap-[9px] rounded-lg border border-transparent bg-transparent px-[9px] py-2 text-left text-primary cursor-pointer transition-[background-color,border-color] duration-[var(--duration-fast)] hover:border-line hover:bg-glass-hover" type="button" onClick={() => { setModeMenuOpen(false); void startIsolated(); }}>
                  <span className="mt-px grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px] bg-glass text-secondary transition-colors group-hover:bg-accent-subtle group-hover:text-accent-text"><GitBranch size={12} /></span>
                  <span className="flex min-w-0 flex-col gap-px text-left"><strong className="text-[12.5px] font-semibold leading-[1.35] text-primary">独立副本（worktree）</strong><small className="text-[10.5px] leading-[1.45] text-dim">改动留在隔离检出中，可并行、审阅后再合并</small></span>
                </button>
                <button className="group flex w-full items-start gap-[9px] rounded-lg border border-transparent bg-transparent px-[9px] py-2 text-left text-primary cursor-pointer transition-[background-color,border-color] duration-[var(--duration-fast)] hover:border-line hover:bg-glass-hover" type="button" onClick={() => { setModeMenuOpen(false); void controller.newResearchSession(); }}>
                  <span className="mt-px grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px] bg-glass text-secondary transition-colors group-hover:bg-accent-subtle group-hover:text-accent-text"><Eye size={12} /></span>
                  <span className="flex min-w-0 flex-col gap-px text-left"><strong className="text-[12.5px] font-semibold leading-[1.35] text-primary">只读调研</strong><small className="text-[10.5px] leading-[1.45] text-dim">以计划模式开始，只读不改</small></span>
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {liveInstances.length > 1 ? (
          <div className="border-b border-line px-2 pt-1 pb-2" aria-label="运行中的会话">
            <button
              className="flex min-h-7 w-full cursor-pointer items-center gap-[7px] mb-[3px] rounded-md border-0 bg-transparent px-[9px] py-1 text-left text-[10px] font-bold tracking-[0.08em] text-dim uppercase select-none transition-[background-color,color] duration-[var(--duration-fast)] hover:bg-glass-hover hover:text-primary"
              type="button"
              aria-expanded={liveOpen}
              onClick={() => setLiveOpen((value) => !value)}
            >
              <span className={`inline-flex w-3 flex-none items-center justify-center text-[12px] leading-none text-secondary transition-transform duration-[var(--duration-fast)]${liveOpen ? '' : ' -rotate-90'}`} aria-hidden="true"><ChevronRight size={12} /></span>
              <span>运行中</span>
              <span className="ml-auto min-w-4 rounded-[4px] bg-muted px-[5px] py-px text-center text-[10px] font-semibold text-dim tabular-nums">{liveInstances.length}</span>
            </button>
            {liveOpen ? liveInstances.map((instance) => {
              const path = instance.projectPath || instance.project_path || '';
              const active = instance.pid === activePid;
              const name = basename(path) || '无文件夹';
              return (
                <div
                  className={`group flex w-full items-center gap-1 rounded-[7px] px-2 py-1.5 text-[11px] text-secondary${active ? ' bg-glass-active text-accent-text' : ' hover:bg-glass-hover'}`}
                  key={instance.pid}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] border-0 bg-transparent p-0 text-left text-inherit cursor-pointer"
                    type="button"
                    title={active ? `${name} · 当前窗口连接的实例` : `切换到 ${name}`}
                    disabled={active}
                    onClick={() => { if (!active && instance.pid) void controller.switchToInstance(instance.pid); }}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full${active ? ' bg-accent-text' : ' bg-success'}`} />
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
                  </button>
                  <span className={`shrink-0 text-[10px] ${active ? 'text-accent-text' : 'text-dim'}`}>
                    {active ? (snapshot.extensionUiRequest ? '等待授权' : snapshot.isStreaming ? '生成中' : '当前窗口') : '可切换'}
                  </span>
                  {!active ? (
                    <button
                      className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-dim opacity-0 transition-[opacity,background-color,color] duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[color-mix(in_srgb,var(--error)_10%,transparent)] hover:text-error focus-visible:opacity-100"
                      type="button"
                      aria-label={`停止 ${name} 的 Pi 实例`}
                      title={`停止 ${name} 的 Pi 实例`}
                      onClick={() => void stopLiveInstance(instance)}
                    >
                      <X size={11} />
                    </button>
                  ) : null}
                </div>
              );
            }) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line-hover" id="session-list">
          {/* Only show skeleton on first empty load — never flash over an existing list. */}
          {snapshot.sessionsLoading && snapshot.sessionProjects.length === 0 ? (
            Array.from({ length: 6 }, (_, index) => (
              <div className="my-px flex min-h-[33px] items-center gap-2 py-1.5 pl-[11px] pr-[9px]" key={index}><div className="h-2.5 flex-1 rounded-[4px] bg-[linear-gradient(90deg,var(--bg-muted)_25%,var(--bg-elevated)_50%,var(--bg-muted)_75%)] bg-[length:200%_100%] animate-[workbenchShimmer_1.5s_infinite]" /><div className="h-2 w-7 flex-none rounded-[4px] bg-[linear-gradient(90deg,var(--bg-muted)_25%,var(--bg-elevated)_50%,var(--bg-muted)_75%)] bg-[length:200%_100%] animate-[workbenchShimmer_1.5s_infinite] [animation-delay:.12s]" /></div>
            ))
          ) : null}

          {/* Two different searches run at once: the list above filters loaded
              session titles, this one is the server's full-text scan of message
              bodies. Labelling and rendering them differently keeps the two
              result sets from looking like one inconsistent list. */}
          {query && snapshot.sessionSearchResults.length ? (
            <div className="mb-3">
              <div className="flex min-h-7 w-full cursor-default items-center gap-[7px] mb-[3px] rounded-md px-[9px] py-1 text-left text-[10px] font-bold tracking-[0.08em] text-accent-text uppercase select-none"><span>消息内容匹配</span><span className="ml-auto min-w-4 rounded-[4px] bg-muted px-[5px] py-px text-center text-[10px] font-semibold text-dim tabular-nums">{snapshot.sessionSearchResults.length}</span></div>
              <div className="flex flex-col gap-0.5 pb-0.5">
                {snapshot.sessionSearchResults.map((result) => {
                  const match = snapshot.sessionProjects
                    .flatMap((project) => project.sessions.map((session) => ({ project, session })))
                    .find(({ session }) => session.filePath === result.filePath);
                  // A hit can name a session the sidebar has not loaded (another
                  // project, or archived). Synthesise just enough to open it.
                  const session = match?.session || {
                    filePath: result.filePath,
                    name: result.sessionName,
                    firstMessage: result.firstMessage,
                    timestamp: result.sessionTimestamp,
                  };
                  const project = match?.project || {
                    path: result.project || '',
                    dirName: '',
                    sessions: [],
                  };
                  return (
                    <div key={result.filePath}>
                      {renderSession(session, project)}
                      {result.matches.slice(0, 3).map((item, index) => (
                        <div className="px-[11px] py-1 text-[10px] leading-[1.45] text-dim" key={`${result.filePath}-${index}`}>{item.snippet}</div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!query && favoriteSessions.length ? (
            <div className="mb-3">
              <div className="flex min-h-7 w-full cursor-default items-center gap-[7px] mb-[3px] rounded-md px-[9px] py-1 text-left text-[10px] font-bold tracking-[0.08em] text-accent-text uppercase select-none"><span className="flex-none text-[10px] text-accent-text"><Star size={12} fill="currentColor" /></span><span>收藏</span><span className="ml-auto min-w-4 rounded-[4px] bg-muted px-[5px] py-px text-center text-[10px] font-semibold text-dim tabular-nums">{favoriteSessions.length}</span></div>
              <div className="flex flex-col gap-0.5 pb-0.5">{favoriteSessions.map(({ session, project }) => renderSession(session, project))}</div>
            </div>
          ) : null}

          {!snapshot.sessionsLoading && filteredProjects.length === 0 && archivedSessions.length === 0 ? (
            <div className="grid justify-items-center gap-1.5 px-4 py-9 text-center">
              <span className="mb-0.5 grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-glass text-ghost"><Folder size={18} /></span>
              <strong className="text-[12px] font-semibold text-secondary">没有找到会话</strong>
              <p className="m-0 text-[11px] leading-[1.5] text-dim">{query ? '换个关键词试试，或新建一个会话。' : '从「+」新建第一个会话开始。'}</p>
            </div>
          ) : null}
          {filteredProjects.map((project) => {
            const key = projectKey(project);
            const isCollapsed = collapsed.has(key);
            return (
              <div className="mb-3" key={key}>
                <button
                  className="flex min-h-7 w-full cursor-pointer items-center gap-[7px] mb-[3px] rounded-md px-[9px] py-1 text-left text-[10px] font-bold tracking-[0.08em] text-dim uppercase select-none transition-[background-color,color] duration-[var(--duration-fast)] hover:bg-glass-hover hover:text-primary"
                  type="button"
                  onClick={() => setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  })}
                >
                  <span className={`inline-flex w-3 flex-none items-center justify-center text-[12px] leading-none text-secondary transition-transform duration-[var(--duration-fast)]${isCollapsed ? ' -rotate-90' : ''}`} aria-hidden="true"><ChevronRight size={12} /></span>
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap" title={project.path}>{project.displayName || (project.noFolder ? '无文件夹' : basename(project.path || ''))}</span>
                  <span className="ml-auto min-w-4 rounded-[4px] bg-muted px-[5px] py-px text-center text-[10px] font-semibold text-dim tabular-nums">{project.sessions.length}</span>
                </button>
                <div className={`flex flex-col gap-0.5 pb-0.5${isCollapsed ? ' hidden' : ''}`}>{project.sessions.map((session) => renderSession(session, project))}</div>
              </div>
            );
          })}
          {!query && archivedSessions.length ? (
            <div className="mb-3">
              <div className="flex min-h-7 w-full cursor-default items-center gap-[7px] mb-[3px] rounded-md px-[9px] py-1 text-left text-[10px] font-bold tracking-[0.08em] text-secondary uppercase select-none"><span className="flex-none text-[13px] text-dim"><Archive size={12} /></span><span>已归档</span><span className="ml-auto min-w-4 rounded-[4px] bg-muted px-[5px] py-px text-center text-[10px] font-semibold text-dim tabular-nums">{archivedSessions.length}</span></div>
              <div className="flex flex-col gap-0.5 pb-0.5">{archivedSessions.map(({ session, project }) => renderSession(session, project))}</div>
            </div>
          ) : null}
        </div>

        <nav className="grid grid-cols-[repeat(4,1fr)] gap-[3px] border-t border-line px-2 pt-1.5 pb-2" aria-label="工作台导航">
          {NAV_ITEMS.map(({ view, icon: IconComponent, label }) => {
            const active = snapshot.view === view;
            return (
              <button
                className={`flex min-w-0 h-[34px] items-center justify-center gap-1.5 rounded-[7px] border border-transparent bg-transparent text-[12px] [font-weight:570] text-dim cursor-pointer transition-[background-color,color] duration-[var(--duration-fast)] hover:bg-glass-hover hover:text-primary [&>svg]:flex-none [&>svg]:opacity-90 [&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap${active ? ' bg-accent-subtle text-accent-text' : ''}`}
                type="button"
                key={view}
                aria-current={active ? 'page' : undefined}
                // Re-clicking the active destination goes back to the conversation —
                // the app mark used to be the only way home.
                title={active ? '返回聊天' : label}
                onClick={() => (active ? controller.returnToChat() : controller.setView(view))}
              >
                <IconComponent size={15} /><span>{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <div className={`hidden max-compact:fixed max-compact:inset-0 max-compact:z-[300] max-compact:block max-compact:bg-[rgba(3,5,9,0.5)] transition-opacity duration-[var(--duration-slow)]${open ? ' max-compact:opacity-100' : ' max-compact:opacity-0 max-compact:pointer-events-none'}`} onClick={onClose} />

      {contextMenu ? (
        <div className="fixed z-[1100] min-w-[176px] rounded-xl border border-line-hover bg-elevated p-1.5 shadow-lg [animation:contextMenuEnter_var(--duration-fast)_var(--ease)]" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button className="context-menu-item" type="button" onClick={() => { toggleFavorite(contextMenu.session.filePath); setContextMenu(null); }}><span className="context-menu-icon">{favorites.includes(contextMenu.session.filePath) ? <Star size={12} fill="currentColor" /> : <Star size={12} />}</span>{favorites.includes(contextMenu.session.filePath) ? '取消收藏' : '收藏'}</button>
          <button className="context-menu-item" type="button" onClick={() => { setRenaming(contextMenu.session.filePath); setContextMenu(null); }}><span className="context-menu-icon"><PenLine size={12} /></span>重命名</button>
          <button className="context-menu-item" type="button" onClick={() => { void controller.forkSession(contextMenu.session.filePath); setContextMenu(null); }}><span className="context-menu-icon"><GitBranch size={12} /></span>复制为分支会话</button>
          <button className="context-menu-item" type="button" onClick={() => { void controller.exportHtml(); setContextMenu(null); }}><span className="context-menu-icon"><ExternalLink size={12} /></span>导出 HTML</button>
          <button className="context-menu-item" type="button" onClick={() => toggleArchive(contextMenu.session.filePath)}><span className="context-menu-icon"><Archive size={12} /></span>{archived.includes(contextMenu.session.filePath) ? '移出归档' : '归档会话'}</button>
          <button className="context-menu-item text-error" type="button" onClick={() => { void deleteSession(contextMenu.session); setContextMenu(null); }}><span className="context-menu-icon"><Trash2 size={12} /></span>删除</button>
        </div>
      ) : null}
    </>
  );
}
