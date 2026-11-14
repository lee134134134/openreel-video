import * as React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class InspectorTabErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-center text-xs text-fg-2">
          此面板出错。请切换标签页后再切回以重试。
        </div>
      );
    }
    return this.props.children;
  }
}
