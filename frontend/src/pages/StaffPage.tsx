import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserCog, Search, Plus, Phone, Mail, Calendar, Pencil, UserX, X, RefreshCw, Shield,
} from 'lucide-react';
import { staffApi } from '../lib/api';
import { formatDate } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { useToast } from '../components/ui/Toast';

type StaffMember = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  phone?: string;
  is_active: boolean;
  date_joined: string;
};

const AVATAR_COLORS = [
  'from-blue-500 to-blue-700', 'from-emerald-500 to-emerald-700',
  'from-purple-500 to-purple-700', 'from-orange-500 to-orange-700',
  'from-pink-500 to-pink-700', 'from-cyan-500 to-cyan-700',
];

function roleBadge(role: string) {
  if (role === 'property_manager') return { label: 'Property Manager', cls: 'bg-blue-50 text-blue-700' };
  if (role === 'maintenance_staff') return { label: 'Maintenance Staff', cls: 'bg-orange-50 text-orange-700' };
  if (role === 'owner') return { label: 'Owner', cls: 'bg-purple-50 text-purple-700' };
  return { label: role.replace(/_/g, ' '), cls: 'bg-gray-100 text-gray-600' };
}

function extractError(err: unknown): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!data) return 'Cannot reach server. Make sure the backend is running.';
  if (typeof data === 'string') return 'Server error — backend may be down or returned an unexpected response.';
  const d = data as Record<string, unknown>;
  if (typeof d.detail === 'string') return d.detail;
  const first = Object.values(d)[0];
  if (Array.isArray(first)) return first[0] as string;
  if (typeof first === 'string') return first;
  return 'Something went wrong. Please try again.';
}

const ic = (err?: string) =>
  `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${err ? 'border-red-300' : 'border-gray-200'}`;

// ── Confirm Deactivate ─────────────────────────────────────────────────────
function ConfirmDeactivate({ name, onCancel, onConfirm, isPending }: {
  name: string; onCancel: () => void; onConfirm: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <UserX className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Deactivate Staff</h3>
            <p className="text-sm text-gray-500">They will lose access immediately.</p>
          </div>
        </div>
        <p className="text-sm text-gray-700">
          Deactivate <span className="font-semibold">"{name}"</span>?
          Their data will be kept and the account can be reactivated by resetting their password.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60 flex items-center justify-center gap-2">
            {isPending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Deactivating…</> : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create / Edit Staff Modal ──────────────────────────────────────────────
function StaffModal({ existing, onClose, onSuccess }: {
  existing?: StaffMember;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!existing;
  const [form, setForm] = useState({
    first_name: existing?.first_name ?? '',
    last_name: existing?.last_name ?? '',
    email: existing?.email ?? '',
    password: '',
    phone: existing?.phone ?? '',
    role: existing?.role ?? 'property_manager',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (isEdit) {
        return (await staffApi.update(existing!.id, data)).data;
      }
      return (await staffApi.create(data as Parameters<typeof staffApi.create>[0])).data;
    },
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err) => setErrors({ _server: extractError(err) }),
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.first_name.trim()) e.first_name = 'Required';
    if (!form.last_name.trim()) e.last_name = 'Required';
    if (!isEdit) {
      if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = 'Valid email required';
      if (!form.password || form.password.length < 4) e.password = 'Min 4 characters';
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const payload: Record<string, unknown> = {
      first_name: form.first_name,
      last_name: form.last_name,
      phone: form.phone || undefined,
      role: form.role,
    };
    if (!isEdit) {
      payload.email = form.email;
      payload.password = form.password;
    }
    mutation.mutate(payload);
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{isEdit ? 'Edit Staff' : 'Add Staff Member'}</h2>
            {isEdit && <p className="text-xs text-gray-500 mt-0.5">{existing!.email}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First Name *</label>
              <input type="text" value={form.first_name} onChange={set('first_name')} placeholder="Jane" className={ic(errors.first_name)} />
              {errors.first_name && <p className="text-xs text-red-600 mt-1">{errors.first_name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last Name *</label>
              <input type="text" value={form.last_name} onChange={set('last_name')} placeholder="Smith" className={ic(errors.last_name)} />
              {errors.last_name && <p className="text-xs text-red-600 mt-1">{errors.last_name}</p>}
            </div>
          </div>

          {!isEdit && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email Address *</label>
                <input type="email" value={form.email} onChange={set('email')} placeholder="staff@example.com" className={ic(errors.email)} />
                {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Password *</label>
                <input type="password" value={form.password} onChange={set('password')} placeholder="Min 4 characters" className={ic(errors.password)} />
                {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password}</p>}
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={set('phone')} placeholder="+1 555 000 0000" className={ic()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
              <select value={form.role} onChange={set('role')} className={ic()}>
                <option value="property_manager">Property Manager</option>
                <option value="maintenance_staff">Maintenance Staff</option>
              </select>
            </div>
          </div>

          {errors._server && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errors._server}</p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
              {mutation.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> {isEdit ? 'Saving…' : 'Creating…'}</>
                : <><Plus className="w-4 h-4" /> {isEdit ? 'Save Changes' : 'Add Staff'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Staff Detail Modal ─────────────────────────────────────────────────────
function StaffDetailModal({ staff, avatarColor, onClose, onEdit, onDeactivate }: {
  staff: StaffMember; avatarColor: string; onClose: () => void; onEdit: () => void; onDeactivate: () => void;
}) {
  const initials = `${staff.first_name?.charAt(0) ?? ''}${staff.last_name?.charAt(0) ?? ''}`.toUpperCase()
    || staff.email.charAt(0).toUpperCase();
  const rb = roleBadge(staff.role);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 bg-gradient-to-br ${avatarColor} rounded-full flex items-center justify-center flex-shrink-0`}>
              <span className="text-base font-bold text-white">{initials}</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{staff.first_name} {staff.last_name}</h2>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${rb.cls}`}>{rb.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-2 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={onDeactivate} className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors" title="Deactivate">
              <UserX className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <Mail className="w-4 h-4 text-blue-600" />
              </div>
              <span>{staff.email}</span>
            </div>
            {staff.phone && (
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Phone className="w-4 h-4 text-emerald-600" />
                </div>
                <span>{staff.phone}</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <Shield className="w-4 h-4 text-purple-600" />
              </div>
              <span>{roleBadge(staff.role).label}</span>
            </div>
          </div>
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide mb-1">
              <Calendar className="w-3 h-3" /> Joined
            </div>
            <p className="text-sm font-semibold text-slate-800">{formatDate(staff.date_joined)}</p>
          </div>
          <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${staff.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${staff.is_active ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {staff.is_active ? 'Active' : 'Inactive'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function StaffPage() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [deactivatingStaff, setDeactivatingStaff] = useState<StaffMember | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<{ staff: StaffMember; color: string } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: staffList = [], isLoading, isError, refetch } = useQuery<StaffMember[]>({
    queryKey: ['staff', roleFilter],
    queryFn: async () => {
      const res = await staffApi.list(roleFilter ? { role: roleFilter } : undefined);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['staff'] });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => staffApi.deactivate(id),
    onSuccess: () => {
      toast('Staff member deactivated');
      setDeactivatingStaff(null);
      setSelectedStaff(null);
      invalidate();
    },
    onError: (err: unknown) => toast(extractError(err), 'error'),
  });

  const filtered = staffList.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.first_name.toLowerCase().includes(q) ||
      s.last_name.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q)
    );
  });

  const pmCount = staffList.filter(s => s.role === 'property_manager').length;
  const mainCount = staffList.filter(s => s.role === 'maintenance_staff').length;

  return (
    <div className="space-y-5">
      {showCreate && (
        <StaffModal onClose={() => setShowCreate(false)} onSuccess={invalidate} />
      )}
      {editingStaff && (
        <StaffModal
          existing={editingStaff}
          onClose={() => setEditingStaff(null)}
          onSuccess={() => { invalidate(); setSelectedStaff(null); }}
        />
      )}
      {deactivatingStaff && (
        <ConfirmDeactivate
          name={`${deactivatingStaff.first_name} ${deactivatingStaff.last_name}`.trim() || deactivatingStaff.email}
          isPending={deactivateMutation.isPending}
          onCancel={() => setDeactivatingStaff(null)}
          onConfirm={() => deactivateMutation.mutate(deactivatingStaff.id)}
        />
      )}
      {selectedStaff && !editingStaff && !deactivatingStaff && (
        <StaffDetailModal
          staff={selectedStaff.staff}
          avatarColor={selectedStaff.color}
          onClose={() => setSelectedStaff(null)}
          onEdit={() => { setEditingStaff(selectedStaff.staff); setSelectedStaff(null); }}
          onDeactivate={() => setDeactivatingStaff(selectedStaff.staff)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Staff</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {pmCount} property manager{pmCount !== 1 ? 's' : ''} · {mainCount} maintenance staff
          </p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>Add Staff</Button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700"
        >
          <option value="">All Roles</option>
          <option value="property_manager">Property Managers</option>
          <option value="maintenance_staff">Maintenance Staff</option>
        </select>
      </div>

      {/* Grid */}
      {isError ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <QueryError label="staff" onRetry={() => refetch()} />
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 animate-pulse">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 bg-gray-200 rounded-full" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-3 bg-gray-100 rounded" />
                <div className="h-3 bg-gray-100 rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <EmptyState
            icon={<UserCog className="w-8 h-8" />}
            title="No staff found"
            description={search ? 'Try adjusting your search.' : 'Add your first staff member to get started.'}
            action={{ label: 'Add Staff', onClick: () => setShowCreate(true), icon: <Plus className="w-4 h-4" /> }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((staff, index) => {
            const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
            const initials = `${staff.first_name?.charAt(0) ?? ''}${staff.last_name?.charAt(0) ?? ''}`.toUpperCase()
              || staff.email.charAt(0).toUpperCase();
            const rb = roleBadge(staff.role);

            return (
              <div key={staff.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div
                    className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                    onClick={() => setSelectedStaff({ staff, color: avatarColor })}
                  >
                    <div className={`w-11 h-11 bg-gradient-to-br ${avatarColor} rounded-full flex items-center justify-center flex-shrink-0`}>
                      <span className="text-sm font-bold text-white">{initials}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {staff.first_name} {staff.last_name}
                      </p>
                      <p className="text-xs text-gray-500 truncate max-w-[140px]">{staff.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditingStaff(staff)}
                      className="p-1.5 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeactivatingStaff(staff)}
                      className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                      title="Deactivate"
                    >
                      <UserX className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div
                  className="space-y-2 cursor-pointer"
                  onClick={() => setSelectedStaff({ staff, color: avatarColor })}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${rb.cls}`}>{rb.label}</span>
                    <span className={`flex items-center gap-1 text-xs font-medium ${staff.is_active ? 'text-emerald-600' : 'text-red-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${staff.is_active ? 'bg-emerald-500' : 'bg-red-400'}`} />
                      {staff.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {staff.phone && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{staff.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Joined {formatDate(staff.date_joined)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
