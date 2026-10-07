import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList, Plus, Search, CheckCircle, XCircle, Clock,
  AlertTriangle, Wrench, X, Play, Flag, Pencil, Trash2, UserCog, UserX,
  List, LayoutGrid, ChevronDown, ChevronUp, ShieldCheck, RefreshCw,
} from 'lucide-react';
import { workOrdersApi, unitsApi, staffApi, inspectionsApi } from '../lib/api';
import { WorkOrderBoard, useBoardWorkOrders } from '../components/WorkOrderBoard';
import type { WorkOrder, WorkOrderVerification, Unit } from '../types';
import { formatDate, capitalizeFirst, extractApiError } from '../lib/utils';
import { Badge, getStatusVariant } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { useToast } from '../components/ui/Toast';
import { useDebounce } from '../lib/useDebounce';
import { useAuthStore } from '../store/authStore';

type StaffMember = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  profile?: { role?: string };
  is_active: boolean;
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-600 bg-gray-50',
  medium: 'text-yellow-700 bg-yellow-50',
  high: 'text-orange-700 bg-orange-50',
  urgent: 'text-red-700 bg-red-50',
};

const PRIORITY_ICONS: Record<string, React.ReactNode> = {
  low: <Clock className="w-3.5 h-3.5" />,
  medium: <Clock className="w-3.5 h-3.5" />,
  high: <AlertTriangle className="w-3.5 h-3.5" />,
  urgent: <AlertTriangle className="w-3.5 h-3.5" />,
};

function ic(err?: string) {
  return `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${err ? 'border-red-300' : 'border-gray-200'}`;
}

// ── Confirm Delete ─────────────────────────────────────────────────────────
function ConfirmDelete({ name, onCancel, onConfirm, isPending }: {
  name: string; onCancel: () => void; onConfirm: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
          <div><h3 className="text-base font-bold text-slate-900">Delete Work Order</h3><p className="text-sm text-gray-500">This cannot be undone.</p></div>
        </div>
        <p className="text-sm text-gray-700">Delete <span className="font-semibold">"{name}"</span>?</p>
        <div className="flex gap-3"><button onClick={onCancel} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancel</button>
          <button onClick={onConfirm} disabled={isPending} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60">{isPending ? 'Deleting...' : 'Delete'}</button></div>
      </div>
    </div>
  );
}

// ── Work Order Form (Create + Edit) ────────────────────────────────────────
function WorkOrderFormModal({ onClose, onSuccess, existing }: {
  onClose: () => void; onSuccess: () => void; existing?: WorkOrder;
}) {
  const isEdit = !!existing;
  const [form, setForm] = useState({
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    priority: existing?.priority ?? 'medium',
    unit: existing?.unit ? String(existing.unit) : '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: unitsData } = useQuery<{ results: Unit[] }>({
    queryKey: ['units-all'],
    queryFn: async () => (await unitsApi.getAll({ limit: 200 })).data,
    staleTime: 5 * 60 * 1000,
  });
  const units = unitsData?.results ?? [];

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      isEdit ? workOrdersApi.update(existing!.id, data) : workOrdersApi.create(data),
    onSuccess: () => { onSuccess(); onClose(); },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Required';
    if (!form.description.trim()) e.description = 'Required';
    if (!form.unit) e.unit = 'Select a unit';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const field = (key: string) => ({
    value: form[key as keyof typeof form],
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [key]: ev.target.value })),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{isEdit ? 'Edit Work Order' : 'Create Work Order'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{isEdit ? `Editing: ${existing!.title}` : 'Log a new maintenance task'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (validate()) mutation.mutate({ title: form.title, description: form.description, priority: form.priority, unit: Number(form.unit) }); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input type="text" {...field('title')} placeholder="e.g. Fix leaking pipe in unit 101" className={ic(errors.title)} />
            {errors.title && <p className="text-xs text-red-600 mt-1">{errors.title}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Unit *</label>
            <select {...field('unit')} className={ic(errors.unit)}>
              <option value="">— Select unit —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.label}{u.building_name ? ` · ${u.building_name}` : ''}{u.property_name ? ` · ${u.property_name}` : ''}</option>)}
            </select>
            {errors.unit && <p className="text-xs text-red-600 mt-1">{errors.unit}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
            <select {...field('priority')} className={ic()}>
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
            <textarea {...field('description')} rows={3} placeholder="Describe the issue in detail..." className={ic(errors.description) + ' resize-none'} />
            {errors.description && <p className="text-xs text-red-600 mt-1">{errors.description}</p>}
          </div>
          {mutation.isError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Failed. Please try again.</p>}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={mutation.isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
              {mutation.isPending ? 'Saving...' : isEdit ? <><Pencil className="w-4 h-4" /> Save Changes</> : <><Plus className="w-4 h-4" /> Create</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Verification helpers ───────────────────────────────────────────────────
function conditionVariant(condition: string): React.ComponentProps<typeof Badge>['variant'] {
  const c = (condition || '').toLowerCase();
  if (['good', 'excellent', 'new', 'working'].includes(c)) return 'success';
  if (['fair', 'worn', 'aging'].includes(c)) return 'warning';
  if (['poor', 'damaged', 'broken', 'bad', 'critical'].includes(c)) return 'error';
  return 'default';
}

function VerificationFindings({ findings }: { findings: WorkOrderVerification['after'][number]['findings'] }) {
  if (!findings || findings.length === 0) {
    return <p className="text-xs text-gray-400 italic">No findings recorded.</p>;
  }
  return (
    <div className="space-y-1.5">
      {findings.map((f, i) => (
        <div key={i} className="bg-white border border-gray-100 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-semibold text-slate-800">{f.equipment_name || f.category || 'Finding'}</p>
            {f.condition && <Badge label={f.condition} variant={conditionVariant(f.condition)} />}
            {f.confidence != null && (
              <span className="text-[10px] text-gray-400 ml-auto">{Math.round(f.confidence * 100)}%</span>
            )}
          </div>
          {f.damage_description && <p className="text-xs text-gray-500 mt-1">{f.damage_description}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Work Order Detail Modal ────────────────────────────────────────────────
function WorkOrderDetailModal({ wo, onClose, onEdit, onDelete, canManage }: {
  wo: WorkOrder;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [showAssign, setShowAssign] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const canEdit = canManage && (wo.status === 'draft' || wo.status === 'pending_approval');

  const role = useAuthStore((s) => s.user?.role);
  const canStartVerification = role === 'owner' || role === 'property_manager' || role === 'maintenance_staff';
  const hasVerification = wo.status !== 'draft';

  const {
    data: verification,
    isLoading: verificationLoading,
    isError: verificationError,
    refetch: refetchVerification,
  } = useQuery<WorkOrderVerification>({
    queryKey: ['wo-verification', wo.id],
    queryFn: async () => (await workOrdersApi.verification(wo.id)).data,
    enabled: hasVerification && showVerification,
    staleTime: 30 * 1000,
  });

  const startVerificationMutation = useMutation({
    mutationFn: () => inspectionsApi.create({
      unit: wo.unit,
      reporter_type: 'inspector',
      description: `Post-repair verification for WO #${wo.id}`,
      work_order: wo.id,
    }),
    onSuccess: () => {
      toast('Verification inspection created');
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      queryClient.invalidateQueries({ queryKey: ['wo-verification', wo.id] });
      navigate('/inspections');
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to create verification inspection.'), 'error'),
  });

  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  const approveWoMutation = useMutation({
    mutationFn: () => workOrdersApi.approve(wo.id),
    onSuccess: () => { toast('Work order approved'); invalidateList(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to approve.'), 'error'),
  });
  const rejectWoMutation = useMutation({
    mutationFn: (reason: string) => workOrdersApi.reject(wo.id, reason),
    onSuccess: () => {
      toast('Work order rejected');
      setShowRejectInput(false);
      setRejectReason('');
      invalidateList();
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to reject.'), 'error'),
  });
  const startWoMutation = useMutation({
    mutationFn: () => workOrdersApi.start(wo.id),
    onSuccess: () => { toast('Work order started'); invalidateList(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to start.'), 'error'),
  });
  const completeWoMutation = useMutation({
    mutationFn: () => workOrdersApi.complete(wo.id),
    onSuccess: () => { toast('Work order completed'); invalidateList(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to complete.'), 'error'),
  });

  const { data: staffData } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => (await staffApi.list()).data,
    staleTime: 60 * 1000,
    enabled: showAssign,
  });
  const staffList = (staffData ?? []).filter(s => s.is_active);

  const assignMutation = useMutation({
    mutationFn: (userId: number) => workOrdersApi.assign(wo.id, userId),
    onSuccess: () => {
      toast('Staff assigned');
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      setShowAssign(false);
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to assign staff.'), 'error'),
  });

  const unassignMutation = useMutation({
    mutationFn: () => workOrdersApi.unassign(wo.id),
    onSuccess: () => {
      toast('Assignment removed');
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to remove assignment.'), 'error'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center"><Wrench className="w-5 h-5 text-orange-500" /></div>
            <div>
              <h2 className="text-base font-bold text-slate-900 max-w-[200px] truncate">{wo.title}</h2>
              <p className="text-xs text-gray-500">Work Order #{wo.id}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {canEdit && <button onClick={onEdit} className="p-2 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>}
            {canManage && <button onClick={onDelete} className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge label={wo.status.replace(/_/g, ' ')} variant={getStatusVariant(wo.status)} dot />
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full ${PRIORITY_COLORS[wo.priority] ?? 'text-gray-600 bg-gray-50'}`}>
              {PRIORITY_ICONS[wo.priority]}{capitalizeFirst(wo.priority)}
            </span>
          </div>

          {/* Status actions */}
          {canManage && (wo.status === 'pending_approval' || wo.status === 'draft') && (
            showRejectInput ? (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
                <p className="text-xs font-medium text-red-700">Reason for rejection *</p>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="Explain why this request is rejected…"
                  className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-300 resize-none bg-white"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => rejectWoMutation.mutate(rejectReason)}
                    disabled={!rejectReason.trim() || rejectWoMutation.isPending}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                  >
                    Confirm rejection
                  </button>
                  <button
                    onClick={() => { setShowRejectInput(false); setRejectReason(''); }}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => approveWoMutation.mutate()}
                  disabled={approveWoMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-60"
                >
                  <CheckCircle className="w-4 h-4" /> Approve
                </button>
                <button
                  onClick={() => setShowRejectInput(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg"
                >
                  <XCircle className="w-4 h-4" /> Reject
                </button>
              </div>
            )
          )}
          {canStartVerification && wo.status === 'approved' && (
            <button
              onClick={() => startWoMutation.mutate()}
              disabled={startWoMutation.isPending}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
            >
              <Play className="w-4 h-4" /> Start Work
            </button>
          )}
          {canStartVerification && wo.status === 'in_progress' && (
            <button
              onClick={() => completeWoMutation.mutate()}
              disabled={completeWoMutation.isPending}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-60"
            >
              <Flag className="w-4 h-4" /> Mark Completed
            </button>
          )}
          {wo.description && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Description</p>
              <p className="text-sm text-gray-700 leading-relaxed">{wo.description}</p>
            </div>
          )}

          {/* Photos from the linked inspection report */}
          {(wo.inspection_images?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Photos ({wo.inspection_images!.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {wo.inspection_images!.map(img => (
                  <a key={img.id} href={img.url} target="_blank" rel="noopener noreferrer" title={img.original_filename}>
                    <img
                      src={img.url}
                      alt={img.original_filename}
                      className="w-full h-24 object-cover rounded-xl border border-gray-100 hover:opacity-80 transition-opacity"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Unit</p>
              <p className="text-sm font-semibold text-slate-800">{wo.unit_label ?? `Unit ${wo.unit}`}</p>
            </div>
            {wo.approved_by && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{wo.status === 'rejected' ? 'Rejected By' : 'Approved By'}</p>
                <p className="text-sm font-semibold text-slate-800">{wo.approved_by}</p>
              </div>
            )}
          </div>

          {/* Assigned Staff */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <UserCog className="w-3.5 h-3.5" /> Assigned To
              </p>
              {canManage && (wo.assigned_to ? (
                <button
                  onClick={() => unassignMutation.mutate()}
                  disabled={unassignMutation.isPending}
                  className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 disabled:opacity-50"
                >
                  <UserX className="w-3 h-3" /> Remove
                </button>
              ) : (
                <button
                  onClick={() => setShowAssign(v => !v)}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <UserCog className="w-3 h-3" /> {showAssign ? 'Cancel' : 'Assign Staff'}
                </button>
              ))}
            </div>
            {wo.assigned_to ? (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-blue-700">{(wo.assigned_to_name ?? 'S').charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{wo.assigned_to_name}</p>
                  <p className="text-xs text-gray-500">{wo.assigned_to_email}</p>
                </div>
              </div>
            ) : showAssign ? (
              <div className="space-y-1">
                {staffList.length === 0 ? (
                  <p className="text-xs text-gray-400">No staff available.</p>
                ) : (
                  staffList.map(s => (
                    <button
                      key={s.id}
                      onClick={() => assignMutation.mutate(s.id)}
                      disabled={assignMutation.isPending}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 transition-colors text-left disabled:opacity-50"
                    >
                      <div className="w-7 h-7 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-white">{s.first_name.charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800">{s.first_name} {s.last_name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{s.profile?.role?.replace(/_/g, ' ') ?? s.email}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Not assigned yet</p>
            )}
          </div>

          {/* Verification (before/after inspections) */}
          {hasVerification && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <button
                onClick={() => setShowVerification(v => !v)}
                className="w-full flex items-center justify-between text-left"
              >
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> Verification
                </p>
                {showVerification ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {showVerification && (
                verificationError ? (
                  <QueryError label="verification" onRetry={() => refetchVerification()} />
                ) : verificationLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map(i => <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />)}
                  </div>
                ) : verification ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Before */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Before</p>
                        {verification.before ? (
                          <div className="space-y-1.5">
                            <p className="text-[10px] text-gray-400">Inspection #{verification.before.inspection_id}</p>
                            <VerificationFindings findings={verification.before.findings} />
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 italic">No source inspection</p>
                        )}
                      </div>
                      {/* After */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">After</p>
                        {verification.after.length === 0 ? (
                          <p className="text-xs text-gray-400 italic">No verification inspections yet</p>
                        ) : (
                          <div className="space-y-3">
                            {verification.after.map(v => (
                              <div key={v.inspection_id} className="space-y-1.5">
                                <p className="text-[10px] text-gray-400">
                                  Inspection #{v.inspection_id}{v.created_at ? ` · ${formatDate(v.created_at)}` : ''}
                                </p>
                                <VerificationFindings findings={v.findings} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {canStartVerification && (
                      <button
                        onClick={() => startVerificationMutation.mutate()}
                        disabled={startVerificationMutation.isPending}
                        className="w-full flex items-center justify-center gap-2 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 transition-colors"
                      >
                        {startVerificationMutation.isPending
                          ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating…</>
                          : <><ShieldCheck className="w-4 h-4" /> Start verification inspection</>}
                      </button>
                    )}
                  </>
                ) : null
              )}
            </div>
          )}

          {wo.rejection_reason && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-3">
              <p className="text-xs font-medium text-red-600 mb-1">Rejection Reason</p>
              <p className="text-sm text-red-800">{wo.rejection_reason}</p>
            </div>
          )}
          <p className="text-xs text-gray-400">Created {formatDate(wo.created_at)}</p>
        </div>
      </div>
    </div>
  );
}

// ── Reject Dialog ──────────────────────────────────────────────────────────
function RejectDialog({ wo, onClose, onConfirm, isPending }: {
  wo: WorkOrder; onClose: () => void; onConfirm: (reason: string) => void; isPending: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center"><XCircle className="w-4 h-4 text-red-500" /></div>
          <div><h3 className="text-base font-bold text-slate-900">Reject Work Order</h3><p className="text-xs text-gray-500 truncate max-w-[220px]">{wo.title}</p></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reason *</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why..." rows={3}
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

// ── Page ───────────────────────────────────────────────────────────────────
const VIEW_STORAGE_KEY = 'work-orders-view';

export default function WorkOrdersPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [view, setView] = useState<'list' | 'board'>(() =>
    localStorage.getItem(VIEW_STORAGE_KEY) === 'board' ? 'board' : 'list');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedWoId, setSelectedWoId] = useState<number | null>(null);
  const [editingWo, setEditingWo] = useState<WorkOrder | null>(null);
  const [deletingWo, setDeletingWo] = useState<WorkOrder | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WorkOrder | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  // Maintenance staff may only start/complete — mirror backend 403s in the UI
  const role = useAuthStore((s) => s.user?.role);
  const canManage = role !== 'maintenance_staff';

  const { data, isLoading, isError, refetch } = useQuery<{ results: WorkOrder[]; count: number }>({
    queryKey: ['work-orders', { search: debouncedSearch, status: statusFilter, priority: priorityFilter }],
    queryFn: async () => (await workOrdersApi.getAll({
      search: debouncedSearch || undefined, status: statusFilter || undefined,
      priority: priorityFilter || undefined, limit: 50, ordering: '-created_at',
    })).data,
    staleTime: 30 * 1000,
  });

  // Subscribes to the same cache entry the board uses so the detail modal
  // stays fresh when opened from a board card.
  const { data: boardData } = useBoardWorkOrders(debouncedSearch, priorityFilter, view === 'board');

  const setViewMode = (v: 'list' | 'board') => {
    setView(v);
    localStorage.setItem(VIEW_STORAGE_KEY, v);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['work-orders'] });

  const approveMutation = useMutation({
    mutationFn: (id: number) => workOrdersApi.approve(id),
    onSuccess: () => { toast('Work order approved'); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to approve work order.'), 'error'),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => workOrdersApi.reject(id, reason),
    onSuccess: () => { toast('Work order rejected'); invalidate(); setRejectTarget(null); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to reject work order.'), 'error'),
  });
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
  const deleteMutation = useMutation({
    mutationFn: (id: number) => workOrdersApi.delete(id),
    onSuccess: () => { toast('Work order deleted'); setDeletingWo(null); setSelectedWoId(null); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to delete work order.'), 'error'),
  });

  const workOrders = data?.results ?? [];
  const total = data?.count ?? 0;
  const pendingCount = workOrders.filter(wo => wo.status === 'pending_approval' || wo.status === 'draft').length;

  // Derive the open modal entity from the cached list(s) so background refetches
  // keep it fresh (assignment changes, status changes, etc.)
  const selectedWo = selectedWoId != null
    ? workOrders.find(w => w.id === selectedWoId)
      ?? boardData?.results.find(w => w.id === selectedWoId)
      ?? null
    : null;

  return (
    <div className="space-y-5">
      {showCreateModal && <WorkOrderFormModal onClose={() => setShowCreateModal(false)} onSuccess={invalidate} />}
      {editingWo && <WorkOrderFormModal existing={editingWo} onClose={() => setEditingWo(null)} onSuccess={() => { invalidate(); setSelectedWoId(null); }} />}
      {deletingWo && (
        <ConfirmDelete name={deletingWo.title} isPending={deleteMutation.isPending}
          onCancel={() => setDeletingWo(null)} onConfirm={() => deleteMutation.mutate(deletingWo.id)} />
      )}
      {selectedWo && !editingWo && !deletingWo && (
        <WorkOrderDetailModal
          wo={selectedWo}
          onClose={() => setSelectedWoId(null)}
          onEdit={() => { setEditingWo(selectedWo); setSelectedWoId(null); }}
          onDelete={() => setDeletingWo(selectedWo)}
          canManage={canManage}
        />
      )}
      {rejectTarget && (
        <RejectDialog wo={rejectTarget} onClose={() => setRejectTarget(null)}
          onConfirm={(reason) => rejectMutation.mutate({ id: rejectTarget.id, reason })}
          isPending={rejectMutation.isPending} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Work Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} total
            {pendingCount > 0 && <span className="ml-2 text-orange-600 font-medium">• {pendingCount} need review</span>}
          </p>
        </div>
        {canManage && (
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreateModal(true)}>Create Work Order</Button>
        )}
      </div>

      {canManage && pendingCount > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-orange-800">{pendingCount} work order{pendingCount > 1 ? 's' : ''} awaiting review</p>
            <p className="text-xs text-orange-600 mt-0.5">Approve or reject below.</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search work orders..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
        </div>
        {view === 'list' && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700">
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
        )}
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700">
          <option value="">All Priority</option>
          <option value="urgent">Urgent</option><option value="high">High</option>
          <option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label="View mode">
          <button onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <List className="w-3.5 h-3.5" /> List
          </button>
          <button onClick={() => setViewMode('board')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'board' ? 'bg-white text-slate-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <LayoutGrid className="w-3.5 h-3.5" /> Board
          </button>
        </div>
      </div>

      {view === 'board' ? (
        <WorkOrderBoard search={debouncedSearch} priority={priorityFilter} onSelect={setSelectedWoId} />
      ) : (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isError ? (
          <QueryError label="work orders" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading work orders...</div>
        ) : workOrders.length === 0 ? (
          <EmptyState icon={<ClipboardList className="w-8 h-8" />} title="No work orders found"
            description={canManage ? 'Create a work order to track maintenance tasks.' : 'No work orders available yet.'}
            action={canManage ? { label: 'Create Work Order', onClick: () => setShowCreateModal(true), icon: <Plus className="w-4 h-4" /> } : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Assigned</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {workOrders.map(wo => (
                  <tr key={wo.id} onClick={() => setSelectedWoId(wo.id)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 bg-orange-50 rounded-lg flex items-center justify-center"><Wrench className="w-3.5 h-3.5 text-orange-500" /></div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate max-w-[200px]">{wo.title}</p>
                          <p className="text-xs text-gray-400 truncate max-w-[200px]">{wo.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5"><p className="text-sm text-slate-700">{wo.unit_label ?? `Unit ${wo.unit}`}</p></td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full ${PRIORITY_COLORS[wo.priority] ?? 'text-gray-600 bg-gray-50'}`}>
                        {PRIORITY_ICONS[wo.priority]}{capitalizeFirst(wo.priority)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5"><Badge label={wo.status.replace(/_/g, ' ')} variant={getStatusVariant(wo.status)} dot /></td>
                    <td className="px-5 py-3.5">
                      {wo.assigned_to_name ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full font-medium">
                          <UserCog className="w-3 h-3" />{wo.assigned_to_name}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">{formatDate(wo.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        {canManage && (wo.status === 'pending_approval' || wo.status === 'draft') && (
                          <>
                            <button onClick={() => approveMutation.mutate(wo.id)} disabled={approveMutation.isPending}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg">
                              <CheckCircle className="w-3.5 h-3.5" /> Approve
                            </button>
                            <button onClick={() => setRejectTarget(wo)}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg">
                              <XCircle className="w-3.5 h-3.5" /> Reject
                            </button>
                            <button onClick={() => setEditingWo(wo)} className="p-1.5 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg" title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {wo.status === 'approved' && (
                          <button onClick={() => startMutation.mutate(wo.id)} disabled={startMutation.isPending}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg">
                            <Play className="w-3.5 h-3.5" /> Start
                          </button>
                        )}
                        {wo.status === 'in_progress' && (
                          <button onClick={() => completeMutation.mutate(wo.id)} disabled={completeMutation.isPending}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg">
                            <Flag className="w-3.5 h-3.5" /> Complete
                          </button>
                        )}
                        {canManage && (
                          <button onClick={() => setDeletingWo(wo)} className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
