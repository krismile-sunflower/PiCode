import { useEffect, useRef, useState } from 'react';

export interface ConfirmOptions {
  title: string;
  message?: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  resolve(value: boolean): void;
}

let nextId = 1;
let publish: ((pending: PendingConfirm | null) => void) | null = null;
let queued: PendingConfirm | null = null;

/**
 * Themed replacement for `window.confirm`.
 *
 * The native dialog ignored the app's theme, could not be dismissed from the
 * keyboard in a predictable way, and blocked the whole webview. This resolves
 * to `true` only when the user explicitly confirms; if no host is mounted the
 * action is refused rather than silently allowed.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const pending: PendingConfirm = { ...options, id: nextId++, resolve };
    if (publish) publish(pending);
    else queued = pending;
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    publish = setPending;
    if (queued) {
      setPending(queued);
      queued = null;
    }
    return () => {
      publish = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        pending.resolve(false);
        setPending(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  if (!pending) return null;

  const settle = (value: boolean) => {
    pending.resolve(value);
    setPending(null);
  };

  return (
    <div className="confirm-overlay" role="presentation" onClick={() => settle(false)}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`confirm-title-${pending.id}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-title" id={`confirm-title-${pending.id}`}>{pending.title}</div>
        {pending.message ? <p className="confirm-message">{pending.message}</p> : null}
        {pending.detail ? <p className="confirm-detail" title={pending.detail}>{pending.detail}</p> : null}
        <div className="confirm-actions">
          <button className="settings-action-btn" type="button" onClick={() => settle(false)}>
            {pending.cancelLabel || '取消'}
          </button>
          <button
            className={`settings-action-btn ${pending.danger === false ? 'primary' : 'danger'}`}
            type="button"
            ref={confirmRef}
            onClick={() => settle(true)}
          >
            {pending.confirmLabel || '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
