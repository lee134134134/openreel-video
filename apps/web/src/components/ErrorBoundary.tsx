import React from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[ErrorBoundary] Component error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center bg-background-secondary/50 rounded-lg m-2">
          <Text type="supporting" weight="medium" className="text-red-400 text-sm mb-2">
            出错了
          </Text>
          <Text type="supporting" color="secondary" className="text-text-muted text-xs mb-4 max-w-xs">
            {this.state.error?.message || "发生了意外错误"}
          </Text>
          <Button
            label="重试"
            variant="ghost"
            size="sm"
            onClick={this.handleRetry}
            className="px-4 py-2 bg-primary/20 hover:bg-primary/30 text-primary text-xs rounded transition-colors"
          />
        </div>
      );
    }

    return this.props.children;
  }
}

interface PanelErrorBoundaryProps {
  name: string;
  children: React.ReactNode;
}

/** Panel-level boundary with a real retry: remounting the boundary (key) also
 * remounts the failed lazy child, so React re-runs the dynamic import without
 * needing a full page reload (dev HMR can leave stale chunks behind). */
export const PanelErrorBoundary: React.FC<PanelErrorBoundaryProps> = ({
  name,
  children,
}) => {
  const [attempt, setAttempt] = React.useState(0);
  return (
    <PanelErrorBoundaryInner
      key={attempt}
      name={name}
      onRetry={() => setAttempt((value) => value + 1)}
    >
      {children}
    </PanelErrorBoundaryInner>
  );
};

const PanelErrorBoundaryInner: React.FC<
  PanelErrorBoundaryProps & { onRetry: () => void }
> = ({ name, children, onRetry }) => (
  <ErrorBoundary
    fallback={
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <Text type="supporting" color="secondary" className="text-text-muted text-xs">
          {name}加载失败，请刷新页面重试。
        </Text>
        <Button
          label={`重试加载${name}`}
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs"
        />
      </div>
    }
  >
    {children}
  </ErrorBoundary>
);
