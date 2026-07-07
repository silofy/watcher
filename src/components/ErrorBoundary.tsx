import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/** Last line of defence against a blank window. A render throw anywhere below (e.g. a bad
 *  selector, a malformed captured session) would otherwise tear the whole tree down and leave the
 *  webview black with nothing on screen — the crash still logs to the console, but only if someone
 *  thinks to open it. This catches it and shows the error + component stack in place, so the next
 *  failure is readable at a glance instead of a three-round debugging session. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console breadcrumb too — the boundary is a fallback UI, not a reason to swallow it.
    console.error("The Watcher crashed while rendering:", error, info.componentStack);
    this.setState({ info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-full bg-ink px-5 py-10 text-fg">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <div>
            <span className="label text-signal">The Watcher hit a render error</span>
            <p className="mt-2 text-lg font-semibold leading-snug">
              The report couldn't be drawn. The capture is safe — this is a display bug.
            </p>
            <p className="mt-1 text-sm text-faint">
              Reload to retry. If it recurs, the message below names the failing component.
            </p>
          </div>

          <pre className="mono overflow-x-auto whitespace-pre-wrap rounded-lg border border-edge bg-black/30 p-3 text-xs text-fg">
            {error.message}
            {info?.componentStack ? `\n${info.componentStack}` : ""}
          </pre>

          <div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="label rounded border border-edge px-3 py-1.5 text-fg transition-colors hover:border-signal"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
