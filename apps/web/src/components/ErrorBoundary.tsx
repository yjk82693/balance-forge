import { Component, type ReactNode } from "react";

interface State {
  failed: boolean;
}

/** Last line of defence: a screen that throws shows a plain panel instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };
  static getDerivedStateFromError(): State {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn("screen crashed", error);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="boundary">
        <div className="panel server-down" role="alert">
          <p className="eyebrow" style={{ color: "var(--danger)" }}>
            Something broke
          </p>
          <h1 className="h3">This screen stopped working.</h1>
          <p className="text-2">Reload to start again. Your room code stays the same while the server runs.</p>
          <div className="server-down-actions">
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
            <a className="btn secondary" href="#/" onClick={() => this.setState({ failed: false })}>
              Back to games
            </a>
          </div>
        </div>
      </main>
    );
  }
}
