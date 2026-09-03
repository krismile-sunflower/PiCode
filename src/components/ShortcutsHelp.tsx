import { useEffect, useRef } from 'react';

interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string; label: string }>;
}

/**
 * Single source of truth for the app's key bindings.
 *
 * Everything listed here is bound somewhere in `App.tsx`, `Composer`, or the
 * permission card. Previously the only way to find most of these was to run
 * `/hotkeys` inside the CLI.
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '全局',
    items: [
      { keys: '⌘K', label: '打开命令面板' },
      { keys: '⌘N', label: '新建会话' },
      { keys: '⌘B', label: '显示/隐藏会话栏' },
      { keys: '⌘⇧F', label: '显示/隐藏文件栏' },
      { keys: '⌘⇧G', label: '打开 Git 变更审阅' },
      { keys: '⌘/', label: '打开这份快捷键清单' },
      { keys: 'Esc', label: '逐级退出：面板 → 视图 → 停止生成' },
    ],
  },
  {
    title: '输入框',
    items: [
      { keys: '/', label: '从任意位置聚焦输入框' },
      { keys: 'Enter', label: '发送' },
      { keys: 'Shift+Enter', label: '换行' },
      { keys: '↑ / ↓', label: '回溯最近 50 条输入历史' },
      { keys: '/ + Tab', label: '补全斜杠命令' },
    ],
  },
  {
    title: '权限请求',
    items: [
      { keys: '⌘Enter', label: '仅允许本次' },
      { keys: '⌘⇧Enter', label: '本会话允许' },
      { keys: 'Esc', label: '拒绝（5 分钟无响应自动拒绝）' },
    ],
  },
  {
    title: '桌面端全局热键',
    items: [
      { keys: 'Ctrl+Alt+T', label: '显示/隐藏 PiCode 窗口' },
      { keys: 'Ctrl+Alt+N', label: '唤起窗口并打开项目启动器' },
    ],
  },
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      restoreFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="shortcuts-overlay" role="presentation" onClick={onClose}>
      <div
        className="shortcuts-panel"
        role="dialog"
        aria-modal="true"
        aria-label="键盘快捷键"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shortcuts-head">
          <strong>键盘快捷键</strong>
          <button className="icon-btn" type="button" ref={closeRef} aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <div className="shortcuts-grid">
          {SHORTCUT_GROUPS.map((group) => (
            <section className="shortcuts-group" key={group.title}>
              <div className="eyebrow">{group.title}</div>
              {group.items.map((item) => (
                <div className="shortcuts-row" key={`${group.title}-${item.keys}`}>
                  <span>{item.label}</span>
                  <kbd>{item.keys}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
