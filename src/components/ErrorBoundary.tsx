import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string;
}

/**
 * Last line of defence for render-time crashes.
 *
 * Without this, a single bad message payload or a null-deref in one card takes
 * the whole window to a blank screen with no way back — the user loses the
 * conversation they were reading and has no error text to report.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack || '' });
    console.error('[PiCode] 渲染崩溃', error, info.componentStack);
  }

  private details(): string {
    const { error, componentStack } = this.state;
    return [error?.stack || String(error), componentStack].filter(Boolean).join('\n\n');
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <div className="crash-title">界面出错了</div>
          <p className="crash-summary">
            PiCode 的某个界面组件渲染失败，会话数据没有受影响——重新加载即可继续。
          </p>
          <pre className="crash-detail">{error.message || String(error)}</pre>
          <div className="crash-actions">
            <button className="settings-action-btn primary" type="button" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <button
              className="settings-action-btn"
              type="button"
              onClick={() => void navigator.clipboard.writeText(this.details())}
            >
              复制错误详情
            </button>
            <button
              className="settings-action-btn"
              type="button"
              onClick={() => this.setState({ error: null, componentStack: '' })}
            >
              尝试恢复
            </button>
          </div>
        </div>
      </div>
    );
  }
}
