import { cn, capitalizeFirst } from '../../lib/utils';

interface BadgeProps {
  label: string;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple' | 'gray';
  size?: 'sm' | 'md';
  className?: string;
  dot?: boolean;
}

const variantClasses = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-yellow-50 text-yellow-700',
  error: 'bg-red-50 text-red-700',
  info: 'bg-blue-50 text-blue-700',
  purple: 'bg-purple-50 text-purple-700',
  gray: 'bg-gray-100 text-gray-500',
};

const dotColors = {
  default: 'bg-gray-500',
  success: 'bg-emerald-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  purple: 'bg-purple-500',
  gray: 'bg-gray-400',
};

export function Badge({ label, variant = 'default', size = 'sm', className, dot = false }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium rounded-full',
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        variantClasses[variant],
        className
      )}
    >
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColors[variant])} />
      )}
      {capitalizeFirst(label)}
    </span>
  );
}

export function getStatusVariant(status: string): BadgeProps['variant'] {
  const map: Record<string, BadgeProps['variant']> = {
    active: 'success',
    available: 'success',
    completed: 'success',
    approved: 'success',
    occupied: 'info',
    open: 'info',
    in_progress: 'warning',
    maintenance: 'warning',
    pending: 'warning',
    pending_approval: 'warning',
    scheduled: 'info',
    reviewed: 'info',
    expired: 'error',
    terminated: 'error',
    rejected: 'error',
    failed: 'error',
    inactive: 'error',
    analyzing: 'info',
    unassigned: 'info',
    cancelled: 'gray',
    draft: 'gray',
    reserved: 'purple',
    flagged: 'error',
    low: 'gray',
    medium: 'warning',
    high: 'error',
    urgent: 'error',
  };
  return map[status] ?? 'default';
}
