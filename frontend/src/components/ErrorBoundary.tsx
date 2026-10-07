import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center space-y-4">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Something went wrong</h1>
              <p className="text-sm text-gray-500 mt-1">
                An unexpected error occurred. Please reload the page and try again.
              </p>
              {this.state.message && (
                <p className="text-xs text-gray-400 mt-2 font-mono break-words">{this.state.message}</p>
              )}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
