import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wrench, CheckCircle, Clock, AlertTriangle, Play, Flag, Inbox } from 'lucide-react';
import { workOrdersApi } from '../lib/api';
import type { WorkOrder } from '../types';
import { formatDate, formatRelativeTime, capitalizeFirst, extractApiError } from '../lib/utils';
import { Badge, getStatusVariant } from '../components/ui/Badge';
import { QueryError } from '../components/ui/QueryError';
import { useToast } from '../components/ui/Toast';
import { useAuthStore } from '../store/authStore';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-600 bg-gray-50',
  medium: 'text-yellow-700 bg-yellow-50',
  high: 'text-orange-700 bg-orange-50',
  urgent: 'text-red-700 bg-red-50',
};

export default function MaintenanceDashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const userId = useAuthStore((s) => s.user?.id);

  // My Work Queue — only work orders assigned to the logged-in staff member
  const { data: mineData, isLoading, isError, refetch } = useQuery<{ results: WorkOrder[]; count: number }>({
    queryKey: ['work-orders', 'mine', userId],
    queryFn: async () => {
      const r = await workOrdersApi.getAll({ assigned_to: userId, limit: 50, ordering: '-created_at' });
      return r.data;
    },
    enabled: userId != null,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  // Available pool — approved work orders that nobody has picked up yet
  const { data: availableData, isLoading: availableLoading, isError: availableError, refetch: refetchAvailable } = useQuery<{ results: WorkOrder[]; count: number }>({
    queryKey: ['work-orders', 'available-pool'],
    queryFn: async () => {
      const r = await workOrdersApi.getAll({ status: 'approved', limit: 50, ordering: '-created_at' });
      return r.data;
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const invalidate = () => {
    // Shared prefix invalidates every work-order query on all pages
    queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  };

  const startMutation = useMutation({
    mutationFn: (id: number) => workOrdersApi.start(id),
    onSuccess: () => { toast('Work order started'); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to start work order.'), 'error'),
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => workOrdersApi.complete(id),
    onSuccess: () => { toast('Work order completed'); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to complete work order.'), 'error'),
  });

  const mine = mineData?.results ?? [];
  const approved = mine.filter(w => w.status === 'approved');
  const inProgress = mine.filter(w => w.status === 'in_progress');
  const completed = mine.filter(w => w.status === 'completed');
  const available = (availableData?.results ?? []).filter(w => w.assigned_to == null);

  const stats = [
    { label: 'To Start', count: approved.length, color: 'bg-blue-50 text-blue-700', icon: <Clock className="w-5 h-5" /> },
    { label: 'In Progress', count: inProgress.length, color: 'bg-orange-50 text-orange-700', icon: <Wrench className="w-5 h-5" /> },
    { label: 'Completed', count: completed.length, color: 'bg-emerald-50 text-emerald-700', icon: <CheckCircle className="w-5 h-5" /> },
    { label: 'Available', count: available.length, color: 'bg-gray-50 text-gray-600', icon: <AlertTriangle className="w-5 h-5" /> },
  ];

  const actionable = [...approved, ...inProgress];

  const workOrderRow = (wo: WorkOrder, showActions: boolean) => (
    <div key={wo.id} className="px-5 py-4 flex items-start gap-4">
      <div className="w-9 h-9 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
        <Wrench className="w-4 h-4 text-orange-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{wo.title}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{wo.description}</p>
        <div className="flex items-center gap-2 mt-2">
          <Badge label={wo.status.replace(/_/g, ' ')} variant={getStatusVariant(wo.status)} size="sm" />
          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${PRIORITY_COLORS[wo.priority] ?? 'text-gray-600 bg-gray-50'}`}>
            {capitalizeFirst(wo.priority)}
          </span>
          <span className="text-xs text-gray-400">{wo.unit_label ?? `Unit ${wo.unit}`}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        {showActions && wo.status === 'approved' && (
          <button
            onClick={() => startMutation.mutate(wo.id)}
            disabled={startMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> Start
          </button>
        )}
        {showActions && wo.status === 'in_progress' && (
          <button
            onClick={() => completeMutation.mutate(wo.id)}
            disabled={completeMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <Flag className="w-3.5 h-3.5" /> Complete
          </button>
        )}
        <span className="text-[10px] text-gray-400 text-right">{formatRelativeTime(wo.created_at)}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">My Work Queue</h1>
        <p className="text-sm text-gray-500 mt-0.5">Maintenance tasks assigned to you</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className={`w-9 h-9 rounded-lg ${s.color} flex items-center justify-center mb-3`}>
              {s.icon}
            </div>
            <p className="text-2xl font-bold text-slate-900">{s.count}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* My active work orders */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-slate-800">My Active Work Orders</h2>
        </div>
        {isError ? (
          <QueryError label="your work orders" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : actionable.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle className="w-8 h-8 text-emerald-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No active work orders assigned to you. All clear!</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {actionable.map(wo => workOrderRow(wo, true))}
          </div>
        )}
      </div>

      {/* Available (approved, unassigned) */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-slate-800">Available (approved, unassigned)</h2>
          <p className="text-xs text-gray-400 mt-0.5">Approved work orders nobody has picked up yet — start one to claim it</p>
        </div>
        {availableError ? (
          <QueryError label="available work orders" onRetry={() => refetchAvailable()} />
        ) : availableLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : available.length === 0 ? (
          <div className="p-8 text-center">
            <Inbox className="w-8 h-8 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No unassigned approved work orders.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {available.map(wo => workOrderRow(wo, true))}
          </div>
        )}
      </div>

      {/* Recent completed */}
      {completed.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-slate-800">Recently Completed</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {completed.slice(0, 5).map(wo => (
              <div key={wo.id} className="px-5 py-3.5 flex items-center gap-3">
                <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{wo.title}</p>
                  <p className="text-xs text-gray-400">{wo.unit_label ?? `Unit ${wo.unit}`}</p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(wo.updated_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
