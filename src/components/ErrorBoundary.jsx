// src/components/ErrorBoundary.jsx
import { Component } from "react";

/**
 * Without this, React's default behavior on an uncaught render error is to
 * unmount the ENTIRE tree -- confirmed directly in this app: a single bad
 * value reaching GrantBrowser's render (e.g. an unexpected contract response
 * shape) took the whole page down to an empty <div></div>, header and all,
 * not just the panel that broke.
 *
 * Wrapping each panel individually means a crash in one tab can't take out
 * the header, nav, or the other two tabs -- the user can still switch away
 * from the broken one. An outer boundary around the whole app (see App.jsx)
 * is the last-resort net in case something outside any panel breaks.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // In a real deployment this is the hook point for error reporting
    // (Sentry, etc). Logging for now so failures aren't silent.
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="card error-fallback" data-testid={this.props.testId || "error-boundary-fallback"}>
          <h2>Something went wrong{this.props.label ? ` in ${this.props.label}` : ""}.</h2>
          <p className="hint" style={{ marginBottom: 16 }}>
            This section hit an unexpected error and couldn't render. The rest of the app is unaffected —
            you can keep using other tabs, or try this one again.
          </p>
          <button type="button" onClick={this.handleReset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
