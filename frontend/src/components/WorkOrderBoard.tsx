import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, UserCog, Wrench, X, XCircle } from 'lucide-react';
import { workOrdersApi } from '../lib/api';
import type { WorkOrder } from '../types';
import { capitalizeFirst, extractApiError } from '../lib/utils';
import { Badge, getStatusVariant } from './ui/Badge';
import { QueryError } from './ui/QueryError';
import { useToast } from './ui/Toast';
import { useAuthStore } from '../store/authStore';

type WoStatus = WorkOrder['status'];

const COLUMNS: { status: WoStatus; label: string }[] = [
  { status: 'draft', label: 'Draft' },
  { status: 'pending_approval', label: 'Pending Approval' },
  { status: 'approved', label: 'Approved' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'completed', label: 'Completed' },
  { status: 'rejected', label: 'Rejected' },
];

const MANAGER_TRANSITIONS: Partial<Record<WoStatus, WoStatus[]>> = {
  draft: ['approved', 'rejected'],
  pending_approval: ['approved', 'rejected'],
  approved: ['in_progress', 'rejected'],
  in_progress: ['completed'],
};

const MAINTENANCE_TRANSITIONS: Partial<Record<WoStatus, WoStatus[]>> = {
  approved: ['in_progress'],
  in_progress: ['completed'],
};

const SUCCESS_LABELS: Record<string, string> = {
  approved: 'Work order approved',
  in_progress: 'Work order started',
  completed: 'Work order completed',
  rejected: 'Work order rejected',
};

/** Shared board query — the page subscribes to the same cache entry so the
 *  detail modal stays fresh while the board view is active. */
export function useBoardWorkOrders(search: string, priority: string, enabled = true) {
  return useQuery<{ results: WorkOrder[]; count: number }>({
    queryKey: ['work-orders', { view: 'board', search, priority }],
    queryFn: async () => (await workOrdersApi.getAll({
      search: search || undefined,
      priority: priority || undefined,
      limit: 200,
      ordering: '-created_at',
    })).data,
    staleTime: 30 * 1000,
    enabled,
  });
}

function ageLabel(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'now';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ── Inline reject dialog ───────────────────────────────────────────────────
function BoardRejectDialog({ wo, onClose, onConfirm, isPending }: {
  wo: WorkOrder; onClose: () => void; onConfirm: (reason: string) => void; isPending: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center"><XCircle className="w-4 h-4 text-red-500" /></div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Reject Work Order</h3>
              <p className="text-xs text-gray-500 truncate max-w-[200px]">{wo.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reason *</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why..." rows={3} autoFocus
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 resize-none" />
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={() => onConfirm(reason)} disabled={!reason.trim() || isPending}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60">
            {isPending ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card ───────────────────────────────────────────────────────────────────
function BoardCard({ wo, draggable, isDragging, onDragStart, onDragEnd, onClick }: {
  wo: WorkOrder;
  draggable: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`bg-white rounded-lg border border-gray-200 shadow-sm p-3 space-y-2 transition-opacity select-none ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } hover:border-blue-300 hover:shadow ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="w-6 h-6 bg-orange-50 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5">
          <Wrench className="w-3 h-3 text-orange-500" />
        </div>
        <p className="text-sm font-medium text-slate-900 leading-snug line-clamp-2 flex-1">{wo.title}</p>
      </div>
      <p className="text-xs text-gray-500 truncate">{wo.unit_label ?? `Unit ${wo.unit}`}</p>
      <div className="flex items-center justify-between gap-2">
        <Badge label={capitalizeFirst(wo.priority)} variant={getStatusVariant(wo.priority)} dot />
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 flex-shrink-0">
          <Clock className="w-3 h-3" />{ageLabel(wo.created_at)}
        </span>
      </div>
      {wo.assigned_to_name && (
        <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full font-medium max-w-full">
          <UserCog className="w-3 h-3 flex-shrink-0" /><span className="truncate">{wo.assigned_to_name}</span>
        </span>
      )}
    </div>
  );
}

// ── Board ──────────────────────────────────────────────────────────────────
export function WorkOrderBoard({ search, priority, onSelect }: {
  search: string;
  priority: string;
  onSelect: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const transitions = role === 'maintenance_staff' ? MAINTENANCE_TRANSITIONS : MANAGER_TRANSITIONS;

  const [dragging, setDragging] = useState<WorkOrder | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WorkOrder | null>(null);
  // id -> status override shown while a drop mutation is in flight (optimistic)
  const [optimistic, setOptimistic] = useState<Record<number, WoStatus>>({});

  const { data, isLoading, isError, refetch } = useBoardWorkOrders(search, priority);
  const workOrders = data?.results ?? [];

  const transitionMutation = useMutation({
    mutationFn: ({ wo, target, reason }: { wo: WorkOrder; target: WoStatus; reason?: string }) => {
      switch (target) {
        case 'approved': return workOrdersApi.approve(wo.id);
        case 'in_progress': return workOrdersApi.start(wo.id);
        case 'completed': return workOrdersApi.complete(wo.id);
        case 'rejected': return workOrdersApi.reject(wo.id, reason ?? '');
        default: return Promise.reject(new Error('Invalid transition'));
      }
    },
    onSuccess: (_data, { target }) => {
      toast(SUCCESS_LABELS[target] ?? 'Work order updated');
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
    onError: (err: unknown) => {
      toast(extractApiError(err, 'Failed to update work order.'), 'error');
    },
    onSettled: async (_data, _err, { wo }) => {
      // Refetch first, then drop the optimistic override so the card never flickers back
      await queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      setOptimistic(prev => {
        const next = { ...prev };
        delete next[wo.id];
        return next;
      });
    },
  });

  const displayStatus = (wo: WorkOrder): WoStatus => optimistic[wo.id] ?? wo.status;
  const allowedTargets = (wo: WorkOrder): WoStatus[] => transitions[displayStatus(wo)] ?? [];

  const performDrop = (wo: WorkOrder, target: WoStatus, reason?: string) => {
    setOptimistic(prev => ({ ...prev, [wo.id]: target }));
    transitionMutation.mutate({ wo, target, reason });
  };

  const handleDrop = (target: WoStatus) => {
    const wo = dragging;
    setDragging(null);
    if (!wo || !allowedTargets(wo).includes(target)) return;
    if (target === 'rejected') {
      setRejectTarget(wo);
      return;
    }
    performDrop(wo, target);
  };

  if (isError) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <QueryError label="work orders" onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-4 min-w-max">
          {COLUMNS.map(col => (
            <div key={col.status} className="w-[270px] flex-shrink-0 bg-gray-50 rounded-xl border border-gray-100 p-3 space-y-2 animate-pulse">
              <div className="h-4 w-28 bg-gray-200 rounded" />
              <div className="h-20 bg-gray-100 rounded-lg" />
              <div className="h-20 bg-gray-100 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {rejectTarget && (
        <BoardRejectDialog
          wo={rejectTarget}
          onClose={() => setRejectTarget(null)}
          isPending={transitionMutation.isPending}
          onConfirm={(reason) => {
            performDrop(rejectTarget, 'rejected', reason);
            setRejectTarget(null);
          }}
        />
      )}

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-4 min-w-max items-start">
          {COLUMNS.map(col => {
            const cards = workOrders.filter(wo => displayStatus(wo) === col.status);
            const isValidTarget = !!dragging && allowedTargets(dragging).includes(col.status);
            const isInvalidDuringDrag = !!dragging && !isValidTarget && displayStatus(dragging) !== col.status;
            return (
              <div
                key={col.status}
                onDragOver={(e) => { if (isValidTarget) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                onDrop={(e) => { e.preventDefault(); handleDrop(col.status); }}
                className={`w-[270px] flex-shrink-0 rounded-xl border transition-colors ${
                  isValidTarget
                    ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50/60'
                    : 'border-gray-100 bg-gray-50'
                } ${isInvalidDuringDrag ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between px-3 pt-3 pb-2">
                  <div className="flex items-center gap-2">
                    <Badge label={col.label} variant={getStatusVariant(col.status)} dot />
                  </div>
                  <span className="text-[11px] font-semibold text-gray-500 bg-white border border-gray-200 rounded-full min-w-[22px] h-5 px-1.5 flex items-center justify-center">
                    {cards.length}
                  </span>
                </div>
                <div className="px-2 pb-2 space-y-2 overflow-y-auto max-h-[calc(100vh-340px)] min-h-[80px]">
                  {cards.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-6">No work orders</p>
                  ) : (
                    cards.map(wo => (
                      <BoardCard
                        key={wo.id}
                        wo={wo}
                        draggable={allowedTargets(wo).length > 0}
                        isDragging={dragging?.id === wo.id}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(wo.id));
                          setDragging(wo);
                        }}
                        onDragEnd={() => setDragging(null)}
                        onClick={() => onSelect(wo.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
