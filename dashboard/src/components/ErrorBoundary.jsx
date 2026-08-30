import React from "react";
import Icon from "./Icon.jsx";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-96 w-full flex-col items-center justify-center gap-4 rounded-xl border border-error/30 bg-surface-container-low p-8 text-center">
          <Icon name="error" className="text-4xl text-error" />
          <div>
            <h3 className="text-title-md font-bold text-on-surface">Something went wrong in this view</h3>
            <p className="mt-1 font-code-sm text-body-sm text-error">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
          </div>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onReset) this.props.onReset();
            }}
            className="flex items-center gap-2 rounded-lg bg-primary-container px-4 py-2 font-code-sm text-body-sm font-semibold text-on-primary-container shadow transition-all hover:bg-primary-container/90"
          >
            <Icon name="refresh" className="text-base" />
            Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
