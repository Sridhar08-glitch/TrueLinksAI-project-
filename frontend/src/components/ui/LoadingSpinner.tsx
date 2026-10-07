import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  text?: string;
  fullPage?: boolean;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-10 h-10',
};

export function LoadingSpinner({ size = 'md', className, text, fullPage = false }: LoadingSpinnerProps) {
  if (fullPage) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm z-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className={cn('animate-spin text-blue-600', sizeClasses.lg)} />
          {text && <p className="text-sm text-gray-600 font-medium">{text}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      <Loader2 className={cn('animate-spin text-blue-600', sizeClasses[size])} />
      {text && <p className="text-sm text-gray-600">{text}</p>}
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64 w-full">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-gray-200 rounded-xl" />
        <div className="flex-1">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={cn('h-3 bg-gray-100 rounded mb-2', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
