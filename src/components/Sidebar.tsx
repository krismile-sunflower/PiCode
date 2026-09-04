import { useEffect, useMemo, useState } from 'react';
import { postJson } from '../lib/desktop';
import type { AppSnapshot, PiSession, SessionProject, WorkspaceView } from '../lib/types';
import { basename, formatRelativeTime } from '../lib/utils';
import { controller } from '../app/controller';
import { Icon, type IconName } from './Icon';
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

const NAV_ITEMS: Array<{ view: WorkspaceView; icon: IconName; label: string }> = [
  { view: 'projects', icon: 'grid', label: '项目' },
  { view: 'changes', icon: 'changes', label: '变更' },
  { view: 'customization', icon: 'download', label: '定制' },
  { view: 'settings', icon: 'settings', label: '设置' },
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
        className={`session-item${active ? ' active' : ''}${isArchived ? ' archived' : ''}`}
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
        {favorites.includes(session.filePath) ? <span className="session-fav-icon">★</span> : null}
        {renaming === session.filePath ? (
          <input
            className="session-rename-input"
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
            <span className="session-title" title={sessionTitle(session)}>{sessionTitle(session)}</span>
            {session.live ? <span className="session-tag live-tag">live</span> : null}
            {session.tmux ? <span className="session-tag tmux-tag">tmux</span> : null}
            <span className="session-meta">{formatRelativeTime(session.timestamp)}</span>
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
      <aside className={`sidebar${open ? '' : ' collapsed'}`} id="sidebar" aria-label="会话导航">
        <header className="sidebar-head">
          <button className="workspace-chip" type="button" title={`${workspaceLabel} · ${workspacePath}`} onClick={() => controller.setView('projects')}>
            <img src="/icons/tau-192.png" alt="" className="tau-icon" />
            <span className="workspace-chip-name">{workspaceLabel}</span>
            <Icon name="chevron" className="workspace-chip-chevron" width={13} height={13} />
          </button>
          <button className="icon-btn sidebar-collapse-btn" type="button" onClick={onToggle} title={open ? '折叠会话栏' : '展开会话栏'} aria-expanded={open}>
            <Icon name="arrow-left" width={15} height={15} />
          </button>
        </header>

        <div className="sidebar-search-row">
          <label className="sidebar-search">
            <Icon name="search" width={13} height={13} />
            <input type="search" className="sidebar-search-input" placeholder="搜索会话" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button className="sidebar-quick-btn" type="button" title="刷新会话" aria-label="刷新会话" onClick={() => void controller.loadSessions()}>
            <Icon name="refresh" width={14} height={14} />
          </button>
          <div className="new-session-split">
            <button className="sidebar-quick-btn primary" type="button" title="新建会话 ⌘N" aria-label="新建会话" onClick={() => void controller.newSession()}>
              <Icon name="plus" width={15} height={15} />
            </button>
            <button
              className="sidebar-quick-btn new-session-more"
              type="button"
              title="选择新会话的工作方式"
              aria-label="选择新会话的工作方式"
              aria-expanded={modeMenuOpen}
              onClick={(event) => { event.stopPropagation(); setModeMenuOpen((value) => !value); }}
            >
              <Icon name="chevron" width={11} height={11} />
            </button>
            {modeMenuOpen ? (
              <div className="new-session-menu" onClick={(event) => event.stopPropagation()}>
                <button className="context-menu-item" type="button" onClick={() => { setModeMenuOpen(false); void controller.newSession(); }}>
                  <span className="context-menu-icon"><Icon name="edit" width={12} height={12} /></span>
                  <span className="new-session-copy"><strong>直接改工作区</strong><small>Pi 直接修改当前项目文件</small></span>
                </button>
                <button className="context-menu-item" type="button" onClick={() => { setModeMenuOpen(false); void startIsolated(); }}>
                  <span className="context-menu-icon"><Icon name="branch" width={12} height={12} /></span>
                  <span className="new-session-copy"><strong>独立副本（worktree）</strong><small>改动留在隔离检出中，可并行、审阅后再合并</small></span>
                </button>
                <button className="context-menu-item" type="button" onClick={() => { setModeMenuOpen(false); void controller.newResearchSession(); }}>
                  <span className="context-menu-icon"><Icon name="eye" width={12} height={12} /></span>
                  <span className="new-session-copy"><strong>只读调研</strong><small>以计划模式开始，只读不改</small></span>
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {liveInstances.length > 1 ? (
          <div className="live-instances" aria-label="运行中的会话">
            <div className="project-header"><span>运行中</span><span className="project-count">{liveInstances.length}</span></div>
            {liveInstances.map((instance) => {
              const path = instance.projectPath || instance.project_path || '';
              const active = instance.pid === activePid;
              return (
                <button
                  className={`live-instance${active ? ' active' : ''}`}
                  type="button"
                  key={instance.pid}
                  title={path}
                  onClick={() => { if (!active && instance.pid) void controller.switchToInstance(instance.pid); }}
                >
                  <span className="live-instance-dot" />
                  <span className="live-instance-name">{basename(path) || '无文件夹'}</span>
                  <span className="live-instance-state">
                    {active ? (snapshot.extensionUiRequest ? '等待授权' : snapshot.isStreaming ? '生成中' : '当前') : '运行中'}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="session-list" id="session-list">
          {/* Only show skeleton on first empty load — never flash over an existing list. */}
          {snapshot.sessionsLoading && snapshot.sessionProjects.length === 0 ? (
            Array.from({ length: 6 }, (_, index) => (
              <div className="session-skeleton" key={index}><div className="session-skeleton-title" /><div className="session-skeleton-meta" /></div>
            ))
          ) : null}

          {/* Two different searches run at once: the list above filters loaded
              session titles, this one is the server's full-text scan of message
              bodies. Labelling and rendering them differently keeps the two
              result sets from looking like one inconsistent list. */}
          {query && snapshot.sessionSearchResults.length ? (
            <div className="search-results-group">
              <div className="project-header search-results-header"><span>消息内容匹配</span><span className="project-count">{snapshot.sessionSearchResults.length}</span></div>
              <div className="project-sessions">
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
                    <div className="search-result" key={result.filePath}>
                      {renderSession(session, project)}
                      {result.matches.slice(0, 3).map((item, index) => (
                        <div className="search-result-snippet" key={`${result.filePath}-${index}`}>{item.snippet}</div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!query && favoriteSessions.length ? (
            <div className="favourites-group">
              <div className="project-header favourites-header"><span className="fav-star">★</span><span>收藏</span><span className="project-count">{favoriteSessions.length}</span></div>
              <div className="project-sessions">{favoriteSessions.map(({ session, project }) => renderSession(session, project))}</div>
            </div>
          ) : null}

          {!snapshot.sessionsLoading && filteredProjects.length === 0 && archivedSessions.length === 0 ? (
            <div className="session-empty">
              <span className="session-empty-icon"><Icon name="folder" width={18} height={18} /></span>
              <strong>没有找到会话</strong>
              <p>{query ? '换个关键词试试，或新建一个会话。' : '从「+」新建第一个会话开始。'}</p>
            </div>
          ) : null}
          {filteredProjects.map((project) => {
            const key = projectKey(project);
            const isCollapsed = collapsed.has(key);
            return (
              <div className="project-group" key={key}>
                <button
                  className={`project-header${isCollapsed ? ' collapsed' : ''}`}
                  type="button"
                  onClick={() => setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  })}
                >
                  <span className="chevron" aria-hidden="true">›</span>
                  <span title={project.path}>{project.displayName || (project.noFolder ? '无文件夹' : basename(project.path || ''))}</span>
                  <span className="project-count">{project.sessions.length}</span>
                </button>
                <div className={`project-sessions${isCollapsed ? ' collapsed' : ''}`}>{project.sessions.map((session) => renderSession(session, project))}</div>
              </div>
            );
          })}
          {!query && archivedSessions.length ? (
            <div className="archived-group">
              <div className="project-header archived-header"><span className="archive-icon">▱</span><span>已归档</span><span className="project-count">{archivedSessions.length}</span></div>
              <div className="project-sessions">{archivedSessions.map(({ session, project }) => renderSession(session, project))}</div>
            </div>
          ) : null}
        </div>

        <nav className="sidebar-footer" aria-label="工作台导航">
          {NAV_ITEMS.map(({ view, icon, label }) => {
            const active = snapshot.view === view;
            return (
              <button
                className={`sidebar-nav-item${active ? ' active' : ''}`}
                type="button"
                key={view}
                aria-current={active ? 'page' : undefined}
                // Re-clicking the active destination goes back to the conversation —
                // the app mark used to be the only way home.
                title={active ? '返回聊天' : label}
                onClick={() => (active ? controller.returnToChat() : controller.setView(view))}
              >
                <Icon name={icon} width={15} height={15} /><span>{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <div className={`sidebar-overlay${open ? ' visible' : ''}`} onClick={onClose} />

      {contextMenu ? (
        <div className="session-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button className="context-menu-item" type="button" onClick={() => { toggleFavorite(contextMenu.session.filePath); setContextMenu(null); }}><span className="context-menu-icon">{favorites.includes(contextMenu.session.filePath) ? '★' : '☆'}</span>{favorites.includes(contextMenu.session.filePath) ? '取消收藏' : '收藏'}</button>
          <button className="context-menu-item" type="button" onClick={() => { setRenaming(contextMenu.session.filePath); setContextMenu(null); }}><span className="context-menu-icon">A</span>重命名</button>
          <button className="context-menu-item" type="button" onClick={() => { void controller.forkSession(contextMenu.session.filePath); setContextMenu(null); }}><span className="context-menu-icon">⑂</span>复制为分支会话</button>
          <button className="context-menu-item" type="button" onClick={() => { void controller.exportHtml(); setContextMenu(null); }}><span className="context-menu-icon">↗</span>导出 HTML</button>
          <button className="context-menu-item" type="button" onClick={() => toggleArchive(contextMenu.session.filePath)}><span className="context-menu-icon">▱</span>{archived.includes(contextMenu.session.filePath) ? '移出归档' : '归档会话'}</button>
          <button className="context-menu-item danger" type="button" onClick={() => { void deleteSession(contextMenu.session); setContextMenu(null); }}><span className="context-menu-icon">×</span>删除</button>
        </div>
      ) : null}
    </>
  );
}
