import { AlertTriangle, RefreshCw } from 'lucide-react';

export function QueryError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="p-10 text-center">
      <AlertTriangle className="w-8 h-8 text-red-300 mx-auto mb-2" />
      <p className="text-sm font-semibold text-slate-700">Failed to load {label}</p>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">Something went wrong while fetching data.</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Retry
      </button>
    </div>
  );
}
