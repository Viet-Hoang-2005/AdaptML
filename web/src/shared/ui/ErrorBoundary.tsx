import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled application error', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
        <section className="max-w-md rounded-xl border border-border bg-surface p-8 shadow-[var(--shadow-overlay)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-danger-subtle text-danger"><AlertTriangle className="h-6 w-6" /></span>
          <h1 className="mt-5 text-xl font-bold text-foreground">Something went wrong</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            The page could not be displayed safely. Your request was not submitted again.
          </p>
          <Button
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => window.location.reload()}
            className="mt-6"
          >
            Reload application
          </Button>
        </section>
      </main>
    );
  }
}
