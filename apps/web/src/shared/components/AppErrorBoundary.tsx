import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshButtonIcon } from "./ActionIcons";

interface Props {
  children: ReactNode;
  onReset?(): void;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled application render failure", {
      name: error.name,
      componentStack: info.componentStack,
    });
  }

  private reset = () => {
    if (this.props.onReset) {
      this.setState({ failed: false });
      this.props.onReset();
      return;
    }
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="loading-page app-error-page" role="alert">
        <span aria-hidden="true">!</span>
        <h1>화면을 표시하지 못했습니다.</h1>
        <p>작업 중인 내용을 확인한 뒤 화면을 새로고침해 주세요.</p>
        <button type="button" className="exam-primary-button" onClick={this.reset}>
          <RefreshButtonIcon />
          <span>화면 새로고침</span>
        </button>
      </main>
    );
  }
}
