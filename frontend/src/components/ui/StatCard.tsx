import { type ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  iconBgColor: string;
  iconColor: string;
  trend?: {
    value: number;
    label?: string;
    direction: 'up' | 'down';
  };
  subtitle?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  icon,
  iconBgColor,
  iconColor,
  trend,
  subtitle,
  className,
}: StatCardProps) {
  return (
    <div className={cn('bg-white rounded-xl p-5 shadow-sm border border-gray-100', className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-500 font-medium truncate">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ml-3', iconBgColor)}>
          <span className={cn('w-5 h-5', iconColor)}>{icon}</span>
        </div>
      </div>
      {trend && (
        <div className="flex items-center gap-1 mt-3">
          {trend.direction === 'up' ? (
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-red-500" />
          )}
          <span
            className={cn(
              'text-xs font-medium',
              trend.direction === 'up' ? 'text-emerald-600' : 'text-red-600'
            )}
          >
            {trend.value}%
          </span>
          {trend.label && (
            <span className="text-xs text-gray-400">{trend.label}</span>
          )}
        </div>
      )}
    </div>
  );
}
