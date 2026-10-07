import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Search, Plus, Phone, Home, UserCheck, X, Mail, Calendar,
  DollarSign, Pencil, UserX, Send, RefreshCw, Ban,
} from 'lucide-react';
import { tenantsApi, unitsApi } from '../lib/api';
import type { Tenant, TenantInvitation, Unit } from '../types';
import { formatDate, formatCurrency, extractApiError } from '../lib/utils';
import { Badge, getStatusVariant } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { useToast } from '../components/ui/Toast';
import { useDebounce } from '../lib/useDebounce';

const AVATAR_COLORS = [
  'from-blue-500 to-blue-700', 'from-emerald-500 to-emerald-700',
  'from-purple-500 to-purple-700', 'from-orange-500 to-orange-700',
  'from-pink-500 to-pink-700', 'from-cyan-500 to-cyan-700',
];

// ── Confirm Deactivate ─────────────────────────────────────────────────────
function ConfirmDeactivate({ name, onCancel, onConfirm, isPending }: {
  name: string; onCancel: () => void; onConfirm: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center"><UserX className="w-5 h-5 text-orange-600" /></div>
          <div><h3 className="text-base font-bold text-slate-900">Deactivate Tenant</h3><p className="text-sm text-gray-500">They will lose access to the portal.</p></div>
        </div>
        <p className="text-sm text-gray-700">Deactivate <span className="font-semibold">"{name}"</span>? Their data will be kept.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancel</button>
          <button onClick={onConfirm} disabled={isPending}
            className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-60">
            {isPending ? 'Deactivating...' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Tenant Modal ──────────────────────────────────────────────────────
function EditTenantModal({ tenant, onClose, onSuccess }: { tenant: Tenant; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    first_name: tenant.first_name ?? '',
    last_name: tenant.last_name ?? '',
    phone: tenant.phone ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => tenantsApi.update(tenant.id, data),
    onSuccess: () => { onSuccess(); onClose(); },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.first_name.trim()) e.first_name = 'Required';
    if (!form.last_name.trim()) e.last_name = 'Required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const ic = (k: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${errors[k] ? 'border-red-300' : 'border-gray-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Edit Tenant</h2>
            <p className="text-xs text-gray-500 mt-0.5">{tenant.email}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (validate()) mutation.mutate({ first_name: form.first_name, last_name: form.last_name, phone: form.phone || undefined }); }} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First Name *</label>
              <input type="text" {...field('first_name')} className={ic('first_name')} />
              {errors.first_name && <p className="text-xs text-red-600 mt-1">{errors.first_name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last Name *</label>
              <input type="text" {...field('last_name')} className={ic('last_name')} />
              {errors.last_name && <p className="text-xs text-red-600 mt-1">{errors.last_name}</p>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
            <input type="tel" {...field('phone')} placeholder="+1 555 000 0000" className={ic('phone')} />
          </div>
          {mutation.isError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Failed to update. Please try again.</p>}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={mutation.isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
              {mutation.isPending ? 'Saving...' : <><Pencil className="w-4 h-4" /> Save Changes</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Tenant Modal ───────────────────────────────────────────────────────
interface AddTenantForm {
  first_name: string; last_name: string; email: string; password: string;
  phone: string; unit: string; move_in_date: string;
}

function AddTenantModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<AddTenantForm>({
    first_name: '', last_name: '', email: '', password: '',
    phone: '', unit: '', move_in_date: '',
  });
  const [errors, setErrors] = useState<Partial<AddTenantForm>>({});

  const { data: unitsData } = useQuery<{ results: Unit[] }>({
    queryKey: ['units-available'],
    queryFn: async () => (await unitsApi.getAll({ occupancy_status: 'available', limit: 100 })).data,
  });
  const availableUnits = unitsData?.results ?? [];

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => tenantsApi.create(data),
    onSuccess: () => { onSuccess(); onClose(); },
  });

  const validate = () => {
    const e: Partial<AddTenantForm> = {};
    if (!form.first_name.trim()) e.first_name = 'Required';
    if (!form.last_name.trim()) e.last_name = 'Required';
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = 'Valid email required';
    if (!form.password || form.password.length < 4) e.password = 'Min 4 characters';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    mutation.mutate({ first_name: form.first_name, last_name: form.last_name, email: form.email, password: form.password, phone: form.phone, unit: form.unit || undefined, move_in_date: form.move_in_date || undefined });
  };

  const field = (key: keyof AddTenantForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const inputClass = (key: keyof AddTenantForm) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${errors[key] ? 'border-red-300' : 'border-gray-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div><h2 className="text-lg font-bold text-slate-900">Add Tenant</h2><p className="text-xs text-gray-500 mt-0.5">Create a new tenant account</p></div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First Name *</label>
              <input type="text" {...field('first_name')} placeholder="John" className={inputClass('first_name')} />
              {errors.first_name && <p className="text-xs text-red-600 mt-1">{errors.first_name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last Name *</label>
              <input type="text" {...field('last_name')} placeholder="Smith" className={inputClass('last_name')} />
              {errors.last_name && <p className="text-xs text-red-600 mt-1">{errors.last_name}</p>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email Address *</label>
            <input type="email" {...field('email')} placeholder="tenant@example.com" className={inputClass('email')} />
            {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password *</label>
            <input type="password" {...field('password')} placeholder="Min 4 characters" className={inputClass('password')} />
            {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
            <input type="tel" {...field('phone')} placeholder="+1 555 000 0000" className={inputClass('phone')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Assign Unit</label>
              <select {...field('unit')} className={inputClass('unit')}>
                <option value="">— No unit —</option>
                {availableUnits.map(u => <option key={u.id} value={u.id}>{u.label}{u.building_name ? ` · ${u.building_name}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Move-in Date</label>
              <input type="date" {...field('move_in_date')} className={inputClass('move_in_date')} />
            </div>
          </div>
          {mutation.isError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {(mutation.error as { response?: { data?: { email?: string[]; detail?: string } } })?.response?.data?.email?.[0]
                || (mutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                || 'Failed to create tenant. Please try again.'}
            </div>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={mutation.isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
              {mutation.isPending ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Creating...</> : <><Plus className="w-4 h-4" /> Add Tenant</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Invite Tenant Modal ────────────────────────────────────────────────────
function InviteTenantModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ unit: '', email: '', first_name: '', last_name: '', move_in_date: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: unitsData } = useQuery<{ results: Unit[] }>({
    queryKey: ['units-all'],
    queryFn: async () => (await unitsApi.getAll({ limit: 200 })).data,
    staleTime: 5 * 60 * 1000,
  });
  // Available units first, so the sensible choices are at the top
  const units = [...(unitsData?.results ?? [])].sort((a, b) =>
    (a.occupancy_status === 'available' ? 0 : 1) - (b.occupancy_status === 'available' ? 0 : 1));

  const mutation = useMutation({
    mutationFn: () => tenantsApi.sendInvitation({
      unit: Number(form.unit),
      email: form.email.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      move_in_date: form.move_in_date || undefined,
    }),
    onSuccess: () => {
      toast('Invitation sent');
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      onClose();
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to send invitation.'), 'error'),
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.unit) e.unit = 'Select a unit';
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = 'Valid email required';
    if (!form.first_name.trim()) e.first_name = 'Required';
    if (!form.last_name.trim()) e.last_name = 'Required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const ic = (k: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${errors[k] ? 'border-red-300' : 'border-gray-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Invite Tenant</h2>
            <p className="text-xs text-gray-500 mt-0.5">Send a portal invitation by email</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (validate()) mutation.mutate(); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Unit *</label>
            <select {...field('unit')} className={ic('unit')}>
              <option value="">— Select unit —</option>
              {units.map(u => (
                <option key={u.id} value={u.id}>
                  {u.label}{u.building_name ? ` · ${u.building_name}` : ''}{u.occupancy_status !== 'available' ? ` (${u.occupancy_status})` : ''}
                </option>
              ))}
            </select>
            {errors.unit && <p className="text-xs text-red-600 mt-1">{errors.unit}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
            <input type="email" {...field('email')} placeholder="tenant@example.com" className={ic('email')} />
            {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First Name *</label>
              <input type="text" {...field('first_name')} placeholder="John" className={ic('first_name')} />
              {errors.first_name && <p className="text-xs text-red-600 mt-1">{errors.first_name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last Name *</label>
              <input type="text" {...field('last_name')} placeholder="Smith" className={ic('last_name')} />
              {errors.last_name && <p className="text-xs text-red-600 mt-1">{errors.last_name}</p>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Move-in Date</label>
            <input type="date" {...field('move_in_date')} className={ic('move_in_date')} />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={mutation.isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
              {mutation.isPending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Send Invitation</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Invitations View ───────────────────────────────────────────────────────
function invitationVariant(status: TenantInvitation['status']) {
  if (status === 'accepted') return 'success' as const;
  if (status === 'expired') return 'error' as const;
  if (status === 'revoked') return 'gray' as const;
  return 'warning' as const; // pending
}

function InvitationsView() {
  const [revoking, setRevoking] = useState<TenantInvitation | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = useQuery<TenantInvitation[]>({
    queryKey: ['invitations'],
    queryFn: async () => {
      const d = (await tenantsApi.getInvitations({ limit: 100 })).data;
      return Array.isArray(d) ? d : d.results ?? [];
    },
    staleTime: 30 * 1000,
  });

  // Map unit id → label (the invitation serializer only returns the unit id)
  const { data: unitsData } = useQuery<{ results: Unit[] }>({
    queryKey: ['units-all'],
    queryFn: async () => (await unitsApi.getAll({ limit: 200 })).data,
    staleTime: 5 * 60 * 1000,
  });
  const unitLabel = (id: number) => {
    const u = unitsData?.results?.find(u => u.id === id);
    return u ? `${u.label}${u.building_name ? ` · ${u.building_name}` : ''}` : `Unit #${id}`;
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['invitations'] });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => tenantsApi.revokeInvitation(id),
    onSuccess: () => { toast('Invitation revoked'); setRevoking(null); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to revoke invitation.'), 'error'),
  });

  const [resendingId, setResendingId] = useState<number | null>(null);
  const resendMutation = useMutation({
    mutationFn: (id: number) => { setResendingId(id); return tenantsApi.resendInvitation(id); },
    onSuccess: () => { toast('Invitation resent'); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to resend invitation.'), 'error'),
    onSettled: () => setResendingId(null),
  });

  const invitations = data ?? [];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {revoking && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><Ban className="w-5 h-5 text-red-600" /></div>
              <div><h3 className="text-base font-bold text-slate-900">Revoke Invitation</h3><p className="text-sm text-gray-500">The link will stop working.</p></div>
            </div>
            <p className="text-sm text-gray-700">Revoke the invitation sent to <span className="font-semibold">{revoking.email}</span>?</p>
            <div className="flex gap-3">
              <button onClick={() => setRevoking(null)} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancel</button>
              <button onClick={() => revokeMutation.mutate(revoking.id)} disabled={revokeMutation.isPending}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60">
                {revokeMutation.isPending ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isError ? (
        <QueryError label="invitations" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="p-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : invitations.length === 0 ? (
        <EmptyState icon={<Mail className="w-8 h-8" />} title="No invitations yet"
          description="Invite a tenant by email to let them set up their own portal account." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Sent</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Expires</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invitations.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-medium text-slate-900">{inv.email}</td>
                  <td className="px-5 py-3.5 text-sm text-slate-700">
                    {`${inv.first_name ?? ''} ${inv.last_name ?? ''}`.trim() || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-700">{unitLabel(inv.unit)}</td>
                  <td className="px-5 py-3.5"><Badge label={inv.status} variant={invitationVariant(inv.status)} dot /></td>
                  <td className="px-5 py-3.5 text-sm text-gray-500">{formatDate(inv.created_at)}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-500">{inv.expires_at ? formatDate(inv.expires_at) : '—'}</td>
                  <td className="px-5 py-3.5">
                    {inv.status === 'pending' ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => resendMutation.mutate(inv.id)}
                          disabled={resendingId === inv.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50 transition-colors"
                        >
                          {resendingId === inv.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Resend
                        </button>
                        <button
                          onClick={() => setRevoking(inv)}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                        >
                          <Ban className="w-3 h-3" /> Revoke
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tenant Detail Modal ────────────────────────────────────────────────────
function TenantDetailModal({ tenant, avatarColor, onClose, onEdit, onDeactivate }: {
  tenant: Tenant; avatarColor: string; onClose: () => void; onEdit: () => void; onDeactivate: () => void;
}) {
  const initials = `${tenant.first_name?.charAt(0) ?? ''}${tenant.last_name?.charAt(0) ?? ''}`.toUpperCase() || tenant.email.charAt(0).toUpperCase();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 bg-gradient-to-br ${avatarColor} rounded-full flex items-center justify-center flex-shrink-0`}>
              <span className="text-base font-bold text-white">{initials}</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{tenant.first_name} {tenant.last_name}</h2>
              <Badge label={tenant.status} variant={getStatusVariant(tenant.status)} />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-2 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={onDeactivate} className="p-2 hover:bg-orange-50 text-gray-400 hover:text-orange-600 rounded-lg transition-colors" title="Deactivate">
              <UserX className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0"><Mail className="w-4 h-4 text-blue-600" /></div>
              <span>{tenant.email}</span>
            </div>
            {tenant.phone && (
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0"><Phone className="w-4 h-4 text-emerald-600" /></div>
                <span>{tenant.phone}</span>
              </div>
            )}
          </div>
          {(tenant.unit_number || tenant.property_name) && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              {tenant.unit_number && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Home className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span>Unit <strong className="text-slate-800">{tenant.unit_number}</strong></span>
                </div>
              )}
              {tenant.property_name && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span className="w-4" /><span>{tenant.property_name}</span>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {tenant.move_in_date && (
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide mb-1"><UserCheck className="w-3 h-3" /> Move-in</div>
                <p className="text-sm font-semibold text-slate-800">{formatDate(tenant.move_in_date)}</p>
              </div>
            )}
            {tenant.lease_start && (
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide mb-1"><Calendar className="w-3 h-3" /> Lease Start</div>
                <p className="text-sm font-semibold text-slate-800">{formatDate(tenant.lease_start)}</p>
              </div>
            )}
            {tenant.lease_end && (
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide mb-1"><Calendar className="w-3 h-3" /> Lease End</div>
                <p className="text-sm font-semibold text-slate-800">{formatDate(tenant.lease_end)}</p>
              </div>
            )}
            {tenant.monthly_rent != null && (
              <div className="bg-emerald-50 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide mb-1"><DollarSign className="w-3 h-3" /> Monthly Rent</div>
                <p className="text-sm font-semibold text-emerald-700">{formatCurrency(tenant.monthly_rent)}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400">Added {formatDate(tenant.created_at)}</p>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function TenantsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [view, setView] = useState<'tenants' | 'invitations'>('tenants');
  const [showModal, setShowModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<{ tenant: Tenant; color: string } | null>(null);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [deactivatingTenant, setDeactivatingTenant] = useState<Tenant | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, refetch } = useQuery<{ results: Tenant[]; count: number }>({
    queryKey: ['tenants', { search: debouncedSearch, status: statusFilter }],
    queryFn: async () => (await tenantsApi.getAll({ search: debouncedSearch || undefined, status: statusFilter || undefined, limit: 50 })).data,
    staleTime: 60 * 1000,
  });

  const tenants = data?.results ?? [];
  const total = data?.count ?? 0;
  const activeCount = tenants.filter(t => t.status === 'active').length;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tenants'] });
    queryClient.invalidateQueries({ queryKey: ['tenants-all'] });
  };

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => tenantsApi.deactivate(id),
    onSuccess: () => { toast('Tenant deactivated'); setDeactivatingTenant(null); setSelectedTenant(null); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to deactivate tenant.'), 'error'),
  });

  return (
    <div className="space-y-5">
      {showModal && <AddTenantModal onClose={() => setShowModal(false)} onSuccess={invalidate} />}
      {showInviteModal && <InviteTenantModal onClose={() => setShowInviteModal(false)} />}
      {editingTenant && (
        <EditTenantModal tenant={editingTenant} onClose={() => setEditingTenant(null)} onSuccess={() => { invalidate(); setSelectedTenant(null); }} />
      )}
      {deactivatingTenant && (
        <ConfirmDeactivate
          name={`${deactivatingTenant.first_name} ${deactivatingTenant.last_name}`.trim() || deactivatingTenant.email}
          isPending={deactivateMutation.isPending}
          onCancel={() => setDeactivatingTenant(null)}
          onConfirm={() => deactivateMutation.mutate(deactivatingTenant.id)}
        />
      )}
      {selectedTenant && !editingTenant && !deactivatingTenant && (
        <TenantDetailModal
          tenant={selectedTenant.tenant}
          avatarColor={selectedTenant.color}
          onClose={() => setSelectedTenant(null)}
          onEdit={() => { setEditingTenant(selectedTenant.tenant); setSelectedTenant(null); }}
          onDeactivate={() => setDeactivatingTenant(selectedTenant.tenant)}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Tenants</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} tenants · {activeCount} active</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" icon={<Send className="w-4 h-4" />} onClick={() => setShowInviteModal(true)}>Invite</Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowModal(true)}>Add Tenant</Button>
        </div>
      </div>

      {/* Tenants | Invitations segmented control */}
      <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 w-fit" role="group" aria-label="Tenants view">
        <button onClick={() => setView('tenants')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            view === 'tenants' ? 'bg-white text-slate-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Users className="w-3.5 h-3.5" /> Tenants
        </button>
        <button onClick={() => setView('invitations')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            view === 'invitations' ? 'bg-white text-slate-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Mail className="w-3.5 h-3.5" /> Invitations
        </button>
      </div>

      {view === 'invitations' ? (
        <InvitationsView />
      ) : (
        <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search tenants..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700">
          <option value="">All Status</option>
          <option value="active">Active</option><option value="unassigned">Unassigned</option><option value="inactive">Inactive</option>
        </select>
      </div>

      {isError ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <QueryError label="tenants" onRetry={() => refetch()} />
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 animate-pulse">
              <div className="flex items-center gap-3 mb-4"><div className="w-11 h-11 bg-gray-200 rounded-full" /><div className="flex-1"><div className="h-4 bg-gray-200 rounded w-3/4 mb-2" /><div className="h-3 bg-gray-100 rounded w-1/2" /></div></div>
              <div className="space-y-2"><div className="h-3 bg-gray-100 rounded" /><div className="h-3 bg-gray-100 rounded w-3/4" /></div>
            </div>
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <EmptyState icon={<Users className="w-8 h-8" />} title="No tenants found"
            description={search ? 'Try adjusting your search.' : 'Add your first tenant to get started.'}
            action={{ label: 'Add Tenant', onClick: () => setShowModal(true), icon: <Plus className="w-4 h-4" /> }} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tenants.map((tenant, index) => {
            const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
            const initials = `${tenant.first_name?.charAt(0) ?? ''}${tenant.last_name?.charAt(0) ?? ''}`.toUpperCase() || tenant.email.charAt(0).toUpperCase();
            return (
              <div key={tenant.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3 cursor-pointer flex-1 min-w-0" onClick={() => setSelectedTenant({ tenant, color: avatarColor })}>
                    <div className={`w-11 h-11 bg-gradient-to-br ${avatarColor} rounded-full flex items-center justify-center flex-shrink-0`}>
                      <span className="text-sm font-bold text-white">{initials}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{tenant.first_name} {tenant.last_name}</p>
                      <p className="text-xs text-gray-500 truncate max-w-[140px]">{tenant.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Badge label={tenant.status} variant={getStatusVariant(tenant.status)} />
                    <button onClick={() => setEditingTenant(tenant)}
                      className="p-1.5 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeactivatingTenant(tenant)}
                      className="p-1.5 hover:bg-orange-50 text-gray-400 hover:text-orange-600 rounded-lg transition-colors" title="Deactivate">
                      <UserX className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="space-y-2 cursor-pointer" onClick={() => setSelectedTenant({ tenant, color: avatarColor })}>
                  {tenant.phone && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" /><span>{tenant.phone}</span>
                    </div>
                  )}
                  {tenant.unit_number && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Home className="w-3.5 h-3.5 flex-shrink-0" /><span>Unit {tenant.unit_number}</span>
                    </div>
                  )}
                  {tenant.move_in_date && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <UserCheck className="w-3.5 h-3.5 flex-shrink-0" /><span>Since {formatDate(tenant.move_in_date)}</span>
                    </div>
                  )}
                </div>
                {tenant.monthly_rent && (
                  <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between cursor-pointer" onClick={() => setSelectedTenant({ tenant, color: avatarColor })}>
                    <span className="text-xs text-gray-500">Monthly Rent</span>
                    <span className="text-sm font-semibold text-slate-800">{formatCurrency(tenant.monthly_rent)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}
    </div>
  );
}
