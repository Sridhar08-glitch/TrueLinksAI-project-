import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Plus, Search, Upload, Download, Eye, ChevronLeft,
  ChevronRight, Brain, X, Calendar, DollarSign, Play, AlertTriangle,
  CheckCircle, XCircle, Clock, User, Home, Shield, RefreshCw, PenLine, Trash2,
  UserPlus, Link, Flag, Send, Sparkles, CreditCard,
} from 'lucide-react';
import { leasesApi, leaseFieldsApi, leaseFlagsApi, validationsApi, unitsApi, tenantsApi, paymentsApi } from '../lib/api';
import type { Lease, Unit, PaymentScheduleItem } from '../types';
import { formatCurrency, formatDate, getDaysUntil, extractApiError, fileNameFromUrl } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { useToast } from '../components/ui/Toast';
import { useDebounce } from '../lib/useDebounce';
import { useAuthStore } from '../store/authStore';

function processingBadge(status: Lease['processing_status']) {
  if (status === 'completed') return { label: 'Processed', color: 'bg-emerald-50 text-emerald-700' };
  if (status === 'processing') return { label: 'Processing…', color: 'bg-blue-50 text-blue-700' };
  if (status === 'failed') return { label: 'Failed', color: 'bg-red-50 text-red-700' };
  return { label: 'Pending', color: 'bg-orange-50 text-orange-700' };
}

function approvalBadge(status: Lease['approval_status']) {
  if (status === 'approved') return { label: 'Approved', color: 'bg-emerald-50 text-emerald-700' };
  if (status === 'rejected') return { label: 'Rejected', color: 'bg-red-50 text-red-700' };
  return { label: 'Pending Review', color: 'bg-orange-50 text-orange-700' };
}

function fieldConfidenceColor(confidence: number) {
  if (confidence >= 0.85) return 'text-emerald-600';
  if (confidence >= 0.6) return 'text-orange-500';
  return 'text-red-500';
}

function fieldReviewBadge(status: string) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700';
  if (status === 'rejected') return 'bg-red-50 text-red-700';
  return 'bg-gray-100 text-gray-600';
}

// ── New Lease Modal (PDF upload OR manual entry) ───────────────────────────
function NewLeaseModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [mode, setMode] = useState<'choose' | 'upload' | 'manual'>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState({
    unit: '', tenant_name: '', landlord_name: '',
    start_date: '', end_date: '',
    rent_amount: '', currency: 'QAR', rent_frequency: 'monthly',
    deposit_amount: '', annual_rent: '',
    escalation_clause: '', renewal_terms: '', termination_terms: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const queryClient = useQueryClient();

  const { data: unitsData } = useQuery<{ results: Unit[] }>({
    queryKey: ['units-available'],
    queryFn: async () => {
      const r = await unitsApi.getAll({ occupancy_status: 'available', limit: 200 });
      return r.data;
    },
    enabled: mode === 'manual',
    staleTime: 60 * 1000,
  });
  const availableUnits = unitsData?.results ?? [];

  const uploadMutation = useMutation({
    mutationFn: async (f: File) => {
      const res = await leasesApi.upload(f);
      const leaseId: number = res.data.id;
      // Await processing kickoff so failures surface to the user instead of
      // silently leaving the lease stuck at "Pending".
      await leasesApi.process(leaseId);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      onSuccess(); onClose();
    },
    onError: () => {
      // The upload may have succeeded even if process() failed — refresh the
      // list so the pending lease shows up (polling will keep it fresh).
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });

  const manualMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => leasesApi.createManual(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      onSuccess(); onClose();
    },
  });

  const handleFile = (f: File) => { if (f.type === 'application/pdf') setFile(f); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); };

  const setField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const ic = (k: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${errors[k] ? 'border-red-300' : 'border-gray-200'}`;

  const validateManual = () => {
    const e: Record<string, string> = {};
    if (!form.tenant_name.trim()) e.tenant_name = 'Required';
    if (!form.start_date) e.start_date = 'Required';
    if (!form.end_date) e.end_date = 'Required';
    if (!form.rent_amount || isNaN(Number(form.rent_amount))) e.rent_amount = 'Enter a valid number';
    if (form.start_date && form.end_date && form.end_date <= form.start_date) e.end_date = 'Must be after start date';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateManual()) return;
    const payload: Record<string, unknown> = {
      tenant_name: form.tenant_name,
      landlord_name: form.landlord_name || undefined,
      start_date: form.start_date,
      end_date: form.end_date,
      rent_amount: Number(form.rent_amount),
      currency: form.currency,
      rent_frequency: form.rent_frequency,
    };
    if (form.unit) payload.unit = Number(form.unit);
    if (form.deposit_amount) payload.deposit_amount = Number(form.deposit_amount);
    if (form.annual_rent) payload.annual_rent = Number(form.annual_rent);
    if (form.escalation_clause) payload.escalation_clause = form.escalation_clause;
    if (form.renewal_terms) payload.renewal_terms = form.renewal_terms;
    if (form.termination_terms) payload.termination_terms = form.termination_terms;
    manualMutation.mutate(payload);
  };

  const errorMsg = (mut: typeof uploadMutation | typeof manualMutation) => {
    if (!mut.isError) return null;
    const data = (mut.error as { response?: { data?: unknown } })?.response?.data;
    if (!data) return 'Failed. Please try again.';
    if (typeof data === 'string') return data;
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join(' · ');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add Lease</h2>
            <p className="text-xs text-gray-500 mt-0.5">Upload a PDF or enter details manually</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Choose mode ── */}
          {mode === 'choose' && (
            <div className="p-6 space-y-3">
              <button
                onClick={() => setMode('upload')}
                className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left group"
              >
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200">
                  <Upload className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Upload PDF — AI Extraction</p>
                  <p className="text-xs text-gray-500 mt-0.5">Upload the signed lease PDF. AI (Ollama) will extract all details: tenant, dates, rent, deposit, clauses, and signatures automatically.</p>
                  <span className="inline-flex items-center gap-1 mt-2 text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    <Brain className="w-2.5 h-2.5" /> Recommended
                  </span>
                </div>
              </button>

              <button
                onClick={() => setMode('manual')}
                className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors text-left group"
              >
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-200">
                  <PenLine className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Enter Manually</p>
                  <p className="text-xs text-gray-500 mt-0.5">Type in tenant name, unit, dates, rent, deposit and other lease terms directly. Good when you don't have a PDF or want to enter data yourself.</p>
                </div>
              </button>
            </div>
          )}

          {/* ── PDF Upload ── */}
          {mode === 'upload' && (
            <form onSubmit={(e) => { e.preventDefault(); if (file) uploadMutation.mutate(file); }} className="p-6 space-y-4">
              <button type="button" onClick={() => setMode('choose')} className="text-xs text-blue-600 hover:underline">← Back</button>
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                  dragOver ? 'border-blue-400 bg-blue-50' : file ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                }`}
              >
                <input type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                {file ? (
                  <>
                    <FileText className="w-8 h-8 text-emerald-500 mb-2" />
                    <p className="text-sm font-semibold text-emerald-700 px-4 truncate max-w-full">{file.name}</p>
                    <p className="text-xs text-emerald-600 mt-1">{(file.size / 1024).toFixed(0)} KB · PDF ready</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-300 mb-2" />
                    <p className="text-sm font-medium text-gray-600">Drop PDF here or click to browse</p>
                    <p className="text-xs text-gray-400 mt-1">PDF only · Max 10 MB</p>
                  </>
                )}
              </label>
              <div className="bg-blue-50 rounded-xl p-3 flex items-start gap-2">
                <Brain className="w-3.5 h-3.5 text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700">AI will extract: tenant &amp; landlord names, unit, dates, rent, deposit, currency, escalation, renewal &amp; termination clauses.</p>
              </div>
              {errorMsg(uploadMutation) && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errorMsg(uploadMutation)}</p>}
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={!file || uploadMutation.isPending}
                  className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
                  {uploadMutation.isPending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processing…</> : <><Upload className="w-4 h-4" /> Upload & Extract</>}
                </button>
              </div>
            </form>
          )}

          {/* ── Manual Entry ── */}
          {mode === 'manual' && (
            <form onSubmit={handleManualSubmit} className="p-6 space-y-4">
              <button type="button" onClick={() => setMode('choose')} className="text-xs text-blue-600 hover:underline">← Back</button>

              {/* Parties */}
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Parties</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Tenant Name *</label>
                  <input type="text" value={form.tenant_name} onChange={setField('tenant_name')} placeholder="Full legal name" className={ic('tenant_name')} />
                  {errors.tenant_name && <p className="text-xs text-red-600 mt-1">{errors.tenant_name}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Landlord Name</label>
                  <input type="text" value={form.landlord_name} onChange={setField('landlord_name')} placeholder="Full legal name" className={ic('landlord_name')} />
                </div>
              </div>

              {/* Unit */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Unit (optional)</label>
                <select value={form.unit} onChange={setField('unit')} className={ic('unit')}>
                  <option value="">— Select available unit —</option>
                  {availableUnits.map(u => (
                    <option key={u.id} value={u.id}>{u.label} {u.building_name ? `· ${u.building_name}` : ''}</option>
                  ))}
                </select>
              </div>

              {/* Dates */}
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lease Period</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start Date *</label>
                  <input type="date" value={form.start_date} onChange={setField('start_date')} className={ic('start_date')} />
                  {errors.start_date && <p className="text-xs text-red-600 mt-1">{errors.start_date}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End Date *</label>
                  <input type="date" value={form.end_date} onChange={setField('end_date')} className={ic('end_date')} />
                  {errors.end_date && <p className="text-xs text-red-600 mt-1">{errors.end_date}</p>}
                </div>
              </div>

              {/* Financials */}
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Financials</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Monthly Rent *</label>
                  <input type="number" min="0" step="0.01" value={form.rent_amount} onChange={setField('rent_amount')} placeholder="5000" className={ic('rent_amount')} />
                  {errors.rent_amount && <p className="text-xs text-red-600 mt-1">{errors.rent_amount}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Currency</label>
                  <select value={form.currency} onChange={setField('currency')} className={ic('currency')}>
                    <option value="QAR">QAR – Qatari Riyal</option>
                    <option value="AED">AED – UAE Dirham</option>
                    <option value="SAR">SAR – Saudi Riyal</option>
                    <option value="OMR">OMR – Omani Rial</option>
                    <option value="BHD">BHD – Bahraini Dinar</option>
                    <option value="KWD">KWD – Kuwaiti Dinar</option>
                    <option value="USD">USD – US Dollar</option>
                    <option value="EUR">EUR – Euro</option>
                    <option value="GBP">GBP – British Pound</option>
                    <option value="INR">INR – Indian Rupee</option>
                    <option value="PKR">PKR – Pakistani Rupee</option>
                    <option value="EGP">EGP – Egyptian Pound</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Frequency</label>
                  <select value={form.rent_frequency} onChange={setField('rent_frequency')} className={ic('rent_frequency')}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annually">Annually</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Security Deposit</label>
                  <input type="number" min="0" step="0.01" value={form.deposit_amount} onChange={setField('deposit_amount')} placeholder="10000" className={ic('deposit_amount')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Annual Rent</label>
                  <input type="number" min="0" step="0.01" value={form.annual_rent} onChange={setField('annual_rent')} placeholder="60000" className={ic('annual_rent')} />
                </div>
              </div>

              {/* Clauses */}
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Clauses (optional)</p>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Escalation Clause</label>
                <textarea rows={2} value={form.escalation_clause} onChange={setField('escalation_clause')} placeholder="e.g. Rent increases by 5% annually" className={`${ic('escalation_clause')} resize-none`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Renewal Terms</label>
                  <textarea rows={2} value={form.renewal_terms} onChange={setField('renewal_terms')} placeholder="e.g. 60-day notice required" className={`${ic('renewal_terms')} resize-none`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Termination Terms</label>
                  <textarea rows={2} value={form.termination_terms} onChange={setField('termination_terms')} placeholder="e.g. 30-day notice period" className={`${ic('termination_terms')} resize-none`} />
                </div>
              </div>

              {errorMsg(manualMutation) && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errorMsg(manualMutation)}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={manualMutation.isPending}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-60 flex items-center gap-2">
                  {manualMutation.isPending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</> : <><Plus className="w-4 h-4" /> Create Lease</>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Assign Tenant Modal ────────────────────────────────────────────────────
function AssignTenantModal({ lease, onClose, onSuccess }: { lease: Lease; onClose: () => void; onSuccess: () => void }) {
  // Split extracted tenant name into first / last
  const extractedName = lease.tenant_name?.trim() ?? '';
  const nameParts = extractedName.split(' ');
  const defaultFirst = nameParts[0] ?? '';
  const defaultLast = nameParts.slice(1).join(' ');

  const queryClient = useQueryClient();
  const invalidateTenants = () => {
    queryClient.invalidateQueries({ queryKey: ['tenants'] });
    queryClient.invalidateQueries({ queryKey: ['tenants-all'] });
  };

  const [mode, setMode] = useState<'choose' | 'new' | 'existing'>('choose');
  const [form, setForm] = useState({ first_name: defaultFirst, last_name: defaultLast, email: '', password: '', phone: '' });
  const [existingTenantId, setExistingTenantId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');

  const moveInDate = lease.start_date ?? undefined;

  // Always load tenants so we can auto-match and show all
  const { data: tenantsData, isLoading: tenantsLoading } = useQuery<{ results: Array<{ id: number; first_name: string; last_name: string; email: string; unit: number | null; unit_number?: string }> }>({
    queryKey: ['tenants-all'],
    queryFn: async () => { const r = await tenantsApi.getAll({ limit: 200 }); return r.data; },
    staleTime: 60 * 1000,
  });

  const allTenants = tenantsData?.results ?? [];

  // Sort: name-matched tenants first, then unassigned, then assigned
  const nameMatch = (t: typeof allTenants[0]) => {
    const full = `${t.first_name} ${t.last_name}`.toLowerCase();
    return extractedName && full.includes(extractedName.toLowerCase().split(' ')[0].toLowerCase());
  };
  const sortedTenants = [...allTenants].sort((a, b) => {
    const am = nameMatch(a) ? 0 : a.unit ? 2 : 1;
    const bm = nameMatch(b) ? 0 : b.unit ? 2 : 1;
    return am - bm;
  });

  // Auto-select the best match when tenants load
  useEffect(() => {
    if (!tenantsData) return;
    setExistingTenantId(prev => {
      if (prev) return prev;
      const results = tenantsData.results ?? [];
      const match = results.find(t => nameMatch(t));
      return match ? String(match.id) : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantsData]);

  const newMutation = useMutation({
    mutationFn: () => tenantsApi.create({ ...form, unit: lease.unit, move_in_date: moveInDate }),
    onSuccess: () => { invalidateTenants(); onSuccess(); },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data ?? {};
      const fieldErrs: Record<string, string> = {};
      Object.entries(data).forEach(([k, v]) => { fieldErrs[k] = Array.isArray(v) ? v[0] as string : String(v); });
      if (fieldErrs.detail) { setServerError(fieldErrs.detail); } else { setErrors(fieldErrs); }
    },
  });

  const assignMutation = useMutation({
    mutationFn: () => tenantsApi.createAssignment(Number(existingTenantId), lease.unit as number, moveInDate),
    onSuccess: () => { invalidateTenants(); onSuccess(); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setServerError(msg || 'Failed to assign tenant.');
    },
  });

  const ic = (k: string) => `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${errors[k] ? 'border-red-300' : 'border-gray-200'}`;

  const handleNew = (e: React.FormEvent) => {
    e.preventDefault();
    const e2: Record<string, string> = {};
    if (!form.first_name.trim()) e2.first_name = 'Required';
    if (!form.last_name.trim()) e2.last_name = 'Required';
    if (!form.email.trim()) e2.email = 'Required';
    if (!form.password || form.password.length < 4) e2.password = 'Min 4 characters';
    setErrors(e2);
    if (Object.keys(e2).length === 0) newMutation.mutate();
  };

  // Lease info banner
  const LeaseBanner = () => (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1 mb-1">
      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">From Lease Document</p>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-700">
        {extractedName && <span><span className="text-gray-400">Tenant:</span> <strong>{extractedName}</strong></span>}
        {lease.unit_label && <span><span className="text-gray-400">Unit:</span> <strong>{lease.unit_label}</strong></span>}
        {moveInDate && <span><span className="text-gray-400">Move-in:</span> <strong>{moveInDate}</strong></span>}
        {lease.end_date && <span><span className="text-gray-400">End:</span> <strong>{lease.end_date}</strong></span>}
        {(lease as unknown as { rent_amount?: string | number }).rent_amount && (
          <span><span className="text-gray-400">Rent:</span> <strong>{(lease as unknown as { rent_amount?: string | number; currency?: string }).rent_amount} {(lease as unknown as { currency?: string }).currency ?? ''}</strong></span>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
              <UserPlus className="w-4.5 h-4.5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Assign Tenant to Unit</h3>
              <p className="text-xs text-gray-500">{lease.unit_label || `Unit #${lease.unit}`}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6">
          {mode === 'choose' && (
            <div className="space-y-3">
              <LeaseBanner />
              <p className="text-sm text-gray-600">How would you like to link a tenant to this unit?</p>
              <button
                onClick={() => setMode('existing')}
                className="w-full flex items-center gap-4 p-4 border-2 border-blue-100 hover:border-blue-400 rounded-xl text-left transition-colors group"
              >
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100">
                  <Link className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Use existing tenant account</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {allTenants.length > 0
                      ? `${allTenants.length} tenant${allTenants.length !== 1 ? 's' : ''} in system${extractedName && nameMatch(sortedTenants[0]) ? ` · "${sortedTenants[0].first_name} ${sortedTenants[0].last_name}" matched` : ''}`
                      : tenantsLoading ? 'Loading…' : 'No tenants yet'}
                  </p>
                </div>
              </button>
              <button
                onClick={() => setMode('new')}
                className="w-full flex items-center gap-4 p-4 border-2 border-gray-100 hover:border-blue-400 rounded-xl text-left transition-colors group"
              >
                <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-blue-50">
                  <UserPlus className="w-5 h-5 text-gray-400 group-hover:text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Create new tenant account</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {extractedName ? `Name pre-filled from lease: "${extractedName}"` : 'Set up a portal login for the tenant'}
                  </p>
                </div>
              </button>
            </div>
          )}

          {mode === 'new' && (
            <form onSubmit={handleNew} className="space-y-3">
              <button type="button" onClick={() => setMode('choose')} className="text-xs text-blue-600 hover:underline">← Back</button>
              <LeaseBanner />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">First Name *</label>
                  <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} className={ic('first_name')} placeholder="From lease" />
                  {errors.first_name && <p className="text-xs text-red-600 mt-0.5">{errors.first_name}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Last Name *</label>
                  <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} className={ic('last_name')} />
                  {errors.last_name && <p className="text-xs text-red-600 mt-0.5">{errors.last_name}</p>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email * <span className="text-gray-400 font-normal">(used to log in)</span></label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={ic('email')} placeholder="tenant@email.com" />
                {errors.email && <p className="text-xs text-red-600 mt-0.5">{errors.email}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Password * <span className="text-gray-400 font-normal">(min 4 chars)</span></label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className={ic('password')} />
                {errors.password && <p className="text-xs text-red-600 mt-0.5">{errors.password}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={ic('phone')} placeholder="+974 5000 0000" />
              </div>
              {serverError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{serverError}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={onClose} className="flex-1 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={newMutation.isPending}
                  className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 flex items-center justify-center gap-1.5">
                  {newMutation.isPending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating…</> : <><UserPlus className="w-4 h-4" /> Create & Assign</>}
                </button>
              </div>
            </form>
          )}

          {mode === 'existing' && (
            <div className="space-y-3">
              <button type="button" onClick={() => setMode('choose')} className="text-xs text-blue-600 hover:underline">← Back</button>
              <LeaseBanner />
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Select Tenant</label>
                {tenantsLoading ? (
                  <p className="text-sm text-gray-400 py-3 text-center">Loading tenants…</p>
                ) : sortedTenants.length === 0 ? (
                  <p className="text-sm text-gray-500 py-3 text-center">No tenants in system yet. Create a new one instead.</p>
                ) : (
                  <select value={existingTenantId} onChange={e => setExistingTenantId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50">
                    <option value="">— Select a tenant —</option>
                    {sortedTenants.map(t => {
                      const matched = nameMatch(t);
                      const label = `${t.first_name} ${t.last_name}${matched ? ' ✓ matched' : ''}${t.unit ? ` (currently: ${t.unit_number || 'assigned'})` : ''}`;
                      return <option key={t.id} value={t.id}>{label}</option>;
                    })}
                  </select>
                )}
                {existingTenantId && (() => {
                  const sel = sortedTenants.find(t => String(t.id) === existingTenantId);
                  return sel?.unit ? (
                    <p className="text-xs text-orange-600 mt-1">This tenant is currently assigned to another unit. Assigning here will move them.</p>
                  ) : null;
                })()}
              </div>
              {serverError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{serverError}</p>}
              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button
                  onClick={() => { if (!existingTenantId) { setServerError('Please select a tenant.'); return; } setServerError(''); assignMutation.mutate(); }}
                  disabled={assignMutation.isPending || !existingTenantId}
                  className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 flex items-center justify-center gap-1.5">
                  {assignMutation.isPending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Assigning…</> : <><Link className="w-4 h-4" /> Assign Tenant</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Ask AI Panel (chat about this lease) ───────────────────────────────────
interface AskExchange { q: string; a?: string; error?: string; loading: boolean }

function AskAiPanel({ leaseId }: { leaseId: number }) {
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<AskExchange[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inFlight = exchanges.some(e => e.loading);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [exchanges]);

  const ask = async () => {
    const q = question.trim();
    if (!q || inFlight) return;
    setQuestion('');
    setExchanges(prev => [...prev, { q, loading: true }]);
    try {
      const res = await leasesApi.ask(leaseId, q);
      setExchanges(prev => prev.map((e, i) =>
        i === prev.length - 1 ? { ...e, a: res.data.answer as string, loading: false } : e));
    } catch (err: unknown) {
      setExchanges(prev => prev.map((e, i) =>
        i === prev.length - 1
          ? { ...e, error: extractApiError(err, 'Failed to get an answer. Please try again.'), loading: false }
          : e));
    }
  };

  return (
    <div className="flex flex-col h-full p-5">
      <div className="flex-1 space-y-3 overflow-y-auto min-h-[200px]">
        {exchanges.length === 0 && (
          <div className="text-center py-10">
            <Sparkles className="w-8 h-8 text-purple-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">Ask AI about this lease</p>
            <p className="text-xs text-gray-500 mt-0.5">e.g. "When does the lease expire?" or "What is the notice period?"</p>
          </div>
        )}
        {exchanges.map((ex, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[85%] bg-blue-600 text-white text-sm rounded-2xl rounded-br-md px-3.5 py-2">
                {ex.q}
              </div>
            </div>
            {ex.loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 bg-gray-100 text-gray-500 text-xs rounded-2xl rounded-bl-md px-3.5 py-2.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Asking llama3.2…
                </div>
              </div>
            )}
            {ex.a != null && (
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-gray-50 border border-gray-100 text-slate-700 text-sm rounded-2xl rounded-bl-md px-3.5 py-2 whitespace-pre-wrap">
                  {ex.a}
                </div>
              </div>
            )}
            {ex.error && (
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl rounded-bl-md px-3.5 py-2 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {ex.error}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={e => { e.preventDefault(); ask(); }}
        className="flex items-center gap-2 pt-3 border-t border-gray-100 mt-3"
      >
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask a question about this lease…"
          disabled={inFlight}
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={inFlight || !question.trim()}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-50 transition-colors flex-shrink-0"
        >
          {inFlight ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
        </button>
      </form>
    </div>
  );
}

// ── Lease Payments Tab ──────────────────────────────────────────────────────
function paymentStatusPill(status: PaymentScheduleItem['status']) {
  if (status === 'paid') return 'bg-emerald-50 text-emerald-700';
  if (status === 'overdue') return 'bg-red-50 text-red-700';
  return 'bg-yellow-50 text-yellow-700';
}

function LeasePaymentsTab({ lease }: { lease: Lease }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = useQuery<{ results: PaymentScheduleItem[]; count: number }>({
    queryKey: ['lease-payments', lease.id],
    queryFn: async () => (await paymentsApi.getAll({ lease: lease.id, limit: 100 })).data,
  });

  const generateMutation = useMutation({
    mutationFn: () => leasesApi.generateSchedule(lease.id),
    onSuccess: (res) => {
      const created = res.data?.created ?? 0;
      toast(`${created} payment${created !== 1 ? 's' : ''} created`);
      queryClient.invalidateQueries({ queryKey: ['lease-payments', lease.id] });
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to generate schedule.'), 'error'),
  });

  if (isError) return <QueryError label="payments" onRetry={() => refetch()} />;
  if (isLoading) return <div className="p-8 text-center text-sm text-gray-400">Loading payments…</div>;

  const payments = data?.results ?? [];

  if ((data?.count ?? 0) === 0) {
    return (
      <div className="p-10 text-center">
        <CreditCard className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-700">No payment schedule yet</p>
        <p className="text-xs text-gray-500 mt-0.5 mb-4">Generate the rent payment schedule from the lease terms.</p>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 transition-colors"
        >
          {generateMutation.isPending
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating…</>
            : <><CreditCard className="w-4 h-4" /> Generate schedule</>}
        </button>
      </div>
    );
  }

  return (
    <div className="p-5">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Due Date</th>
            <th className="py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
            <th className="py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
            <th className="py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Paid</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {payments.map(p => (
            <tr key={p.id}>
              <td className="py-2.5 text-sm text-slate-700">{formatDate(p.due_date)}</td>
              <td className="py-2.5 text-sm font-medium text-slate-800">{formatCurrency(Number(p.amount), p.currency)}</td>
              <td className="py-2.5">
                <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full capitalize ${paymentStatusPill(p.status)}`}>
                  {p.status}
                </span>
              </td>
              <td className="py-2.5 text-sm text-gray-500">{p.paid_at ? formatDate(p.paid_at) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Lease Detail Modal ─────────────────────────────────────────────────────
type LeaseTabKey = 'overview' | 'fields' | 'review' | 'document' | 'ask' | 'payments';

function LeaseDetailModal({ lease, onClose, onProcessed }: { lease: Lease; onClose: () => void; onProcessed: () => void }) {
  const [activeTab, setActiveTab] = useState<LeaseTabKey>('overview');
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [showAssignTenant, setShowAssignTenant] = useState(false);
  const [rejectingFieldId, setRejectingFieldId] = useState<number | null>(null);
  const [rejectFieldReason, setRejectFieldReason] = useState('');

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const reviewer = user?.email || 'owner';

  // Payments tab is only available on approved leases — bail out if status changes
  useEffect(() => {
    if (activeTab === 'payments' && lease.approval_status !== 'approved') {
      setActiveTab('overview');
    }
  }, [activeTab, lease.approval_status]);

  const [processError, setProcessError] = useState('');
  const processMutation = useMutation({
    mutationFn: () => leasesApi.process(lease.id),
    onSuccess: () => { onProcessed(); onClose(); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setProcessError(msg || 'Failed to start processing. Please try again.');
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => leasesApi.approve(lease.id, reviewer),
    onSuccess: () => { toast('Lease approved'); onProcessed(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to approve lease.'), 'error'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => leasesApi.reject(lease.id, reviewer, 'Rejected after review'),
    onSuccess: () => { toast('Lease rejected'); onProcessed(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to reject lease.'), 'error'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => leasesApi.cancel(lease.id, cancelReason.trim(), reviewer),
    onSuccess: () => { toast('Lease cancelled'); onProcessed(); onClose(); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCancelError(msg || 'Failed to cancel lease.');
      toast(msg || 'Failed to cancel lease.', 'error');
    },
  });

  // ── Field review (per-field + bulk) ──
  const invalidateFieldReview = () => {
    queryClient.invalidateQueries({ queryKey: ['lease-fields', lease.id] });
    queryClient.invalidateQueries({ queryKey: ['leases'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  };

  const fieldApproveMutation = useMutation({
    mutationFn: (fieldId: number) => leaseFieldsApi.approve(fieldId, reviewer),
    onSuccess: () => { toast('Field approved'); invalidateFieldReview(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to approve field.'), 'error'),
  });

  const fieldRejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => leaseFieldsApi.reject(id, reviewer, reason),
    onSuccess: () => {
      toast('Field rejected');
      setRejectingFieldId(null);
      setRejectFieldReason('');
      invalidateFieldReview();
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to reject field.'), 'error'),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: number[]) => leaseFieldsApi.bulkApprove(ids, reviewer),
    onSuccess: () => { toast('All pending fields approved'); invalidateFieldReview(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to approve fields.'), 'error'),
  });

  // ── Flags & validations (AI Review tab) ──
  const { data: flagsData, isLoading: flagsLoading } = useQuery({
    queryKey: ['lease-flags', lease.id],
    queryFn: async () => {
      const res = await leasesApi.getFlags(lease.id);
      return res.data as Array<{
        id: number;
        severity?: string;
        flag_type?: string;
        title?: string;
        message?: string;
        description?: string;
        status?: string;
      }>;
    },
    enabled: activeTab === 'review',
  });

  const { data: validationsData, isLoading: validationsLoading } = useQuery({
    queryKey: ['lease-validations', lease.id],
    queryFn: async () => {
      const res = await leasesApi.getValidations(lease.id);
      return res.data as Array<{
        id: number;
        rule_id: string;
        rule_name: string;
        result: 'PASS' | 'FAIL' | 'UNDETERMINED';
        reason: string;
        severity: 'high' | 'medium' | 'low';
        is_overridden: boolean;
        override_reason: string;
        overridden_by: string;
      }>;
    },
    enabled: activeTab === 'review',
  });

  const [overrideValidationId, setOverrideValidationId] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const overrideValidationMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => validationsApi.override(id, reason),
    onSuccess: () => {
      toast('Rule overridden');
      setOverrideValidationId(null);
      setOverrideReason('');
      queryClient.invalidateQueries({ queryKey: ['lease-validations', lease.id] });
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to override rule.'), 'error'),
  });
  const clearOverrideMutation = useMutation({
    mutationFn: (id: number) => validationsApi.clearOverride(id),
    onSuccess: () => {
      toast('Override removed');
      queryClient.invalidateQueries({ queryKey: ['lease-validations', lease.id] });
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to remove override.'), 'error'),
  });
  const revalidateMutation = useMutation({
    mutationFn: () => leasesApi.revalidate(lease.id),
    onSuccess: () => {
      toast('Lease re-checked against the current rules');
      queryClient.invalidateQueries({ queryKey: ['lease-validations', lease.id] });
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to re-validate.'), 'error'),
  });

  const flagReviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'acknowledge' | 'resolve' | 'dismiss' }) =>
      leaseFlagsApi.review(id, action, reviewer),
    onSuccess: () => {
      toast('Flag updated');
      queryClient.invalidateQueries({ queryKey: ['lease-flags', lease.id] });
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to update flag.'), 'error'),
  });

  const { data: fieldsData, isLoading: fieldsLoading } = useQuery({
    queryKey: ['lease-fields', lease.id],
    queryFn: async () => {
      const res = await leasesApi.getFields(lease.id);
      return res.data as Array<{
        id: number;
        field_name: string;
        display_label: string;
        extracted_value: string;
        normalized_value: unknown;
        confidence: number;
        review_status: string;
        reviewed_value?: unknown;
        source_page?: number;
        source_text?: string;
      }>;
    },
    enabled: lease.processing_status === 'completed' && activeTab === 'fields',
  });

  const { data: clausesData } = useQuery({
    queryKey: ['lease-clauses', lease.id],
    queryFn: async () => {
      const res = await leasesApi.getClauses(lease.id);
      return res.data as Array<{
        id: number;
        clause_type: string;
        title: string;
        raw_text: string;
        interpretation: string;
        is_unusual: boolean;
        unusual_reason: string;
        confidence: number | null;
        source_page: number | null;
      }>;
    },
    enabled: lease.processing_status === 'completed' && activeTab === 'fields',
  });

  const pb = processingBadge(lease.processing_status);
  const ab = approvalBadge(lease.approval_status);
  const expiryDays = lease.end_date ? getDaysUntil(lease.end_date) : null;
  const expiryColor = expiryDays == null ? '' : expiryDays < 0 ? 'text-red-600' : expiryDays <= 14 ? 'text-red-600' : expiryDays <= 30 ? 'text-orange-500' : 'text-gray-500';

  const FIELD_LABELS: Record<string, string> = {
    tenant_name: 'Tenant Name',
    landlord_name: 'Landlord Name',
    unit_id: 'Unit ID',
    start_date: 'Start Date',
    end_date: 'End Date',
    rent_amount: 'Monthly Rent',
    currency: 'Currency',
    rent_frequency: 'Rent Frequency',
    deposit_amount: 'Security Deposit',
    annual_rent: 'Annual Rent',
    escalation_clause: 'Escalation Clause',
    renewal_terms: 'Renewal Terms',
    termination_terms: 'Termination Terms',
    landlord_signed: 'Landlord Signed',
    tenant_signed: 'Tenant Signed',
  };

  const FIELD_ICONS: Record<string, React.ReactNode> = {
    tenant_name: <User className="w-3.5 h-3.5" />,
    landlord_name: <User className="w-3.5 h-3.5" />,
    unit_id: <Home className="w-3.5 h-3.5" />,
    start_date: <Calendar className="w-3.5 h-3.5" />,
    end_date: <Calendar className="w-3.5 h-3.5" />,
    rent_amount: <DollarSign className="w-3.5 h-3.5" />,
    deposit_amount: <DollarSign className="w-3.5 h-3.5" />,
    annual_rent: <DollarSign className="w-3.5 h-3.5" />,
    landlord_signed: <Shield className="w-3.5 h-3.5" />,
    tenant_signed: <Shield className="w-3.5 h-3.5" />,
  };

  const orderedFields = (fieldsData ?? []).sort((a, b) => {
    const order = Object.keys(FIELD_LABELS);
    const ai = order.indexOf(a.field_name);
    const bi = order.indexOf(b.field_name);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const extractedFields = orderedFields.filter(f => f.extracted_value && f.extracted_value !== 'NOT_FOUND' && f.extracted_value !== 'None');
  const notFoundFields = orderedFields.filter(f => !f.extracted_value || f.extracted_value === 'NOT_FOUND' || f.extracted_value === 'None');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {lease.tenant_name || `Lease #${lease.id}`}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${pb.color}`}>
                  {lease.processing_status === 'completed' ? <CheckCircle className="w-3 h-3" /> :
                   lease.processing_status === 'processing' ? <Clock className="w-3 h-3" /> :
                   lease.processing_status === 'failed' ? <AlertTriangle className="w-3 h-3" /> :
                   <Clock className="w-3 h-3" />}
                  {pb.label}
                </span>
                <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${ab.color}`}>{ab.label}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 flex-shrink-0 overflow-x-auto">
          {([
            'overview', 'fields', 'review', 'document', 'ask',
            ...(lease.approval_status === 'approved' ? (['payments'] as const) : []),
          ] as LeaseTabKey[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'fields' ? 'Extracted Fields' : tab === 'review' ? 'AI Review' : tab === 'ask' ? 'Ask AI' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'fields' && lease.processing_status === 'completed' && (
                <span className="ml-1.5 bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {(extractedFields.length || orderedFields.length) + (clausesData?.length ?? 0)}
                </span>
              )}
              {tab === 'review' && lease.open_flags_count != null && lease.open_flags_count > 0 && (
                <span className="ml-1.5 bg-orange-100 text-orange-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {lease.open_flags_count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Overview Tab ── */}
          {activeTab === 'overview' && (
            <div className="p-5 space-y-4">
              {/* Process button */}
              {(lease.processing_status === 'pending' || lease.processing_status === 'failed') && (
                <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-orange-800">
                      {lease.processing_status === 'failed' ? 'AI extraction failed — click to retry' : 'AI extraction not started'}
                    </p>
                    <p className="text-xs text-orange-600 mt-0.5">Click Process to extract all lease data with Ollama AI</p>
                  </div>
                  <button
                    onClick={() => processMutation.mutate()}
                    disabled={processMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-60 transition-colors"
                  >
                    {processMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    {processMutation.isPending ? 'Processing…' : 'Process'}
                  </button>
                </div>
              )}
              {processError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{processError}</p>
              )}

              {lease.processing_error && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                  <p className="text-xs font-semibold text-red-700">Processing error</p>
                  <p className="text-xs text-red-600 mt-0.5 font-mono">{lease.processing_error}</p>
                </div>
              )}

              {/* Extracted summary (only when processed) */}
              {lease.processing_status === 'completed' && (
                <>
                  {/* Parties */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-xl p-3.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <User className="w-3 h-3" /> Tenant
                      </p>
                      <p className="text-sm font-semibold text-slate-800">{lease.tenant_name || '—'}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <User className="w-3 h-3" /> Landlord
                      </p>
                      <p className="text-sm font-semibold text-slate-800">{lease.landlord_name || '—'}</p>
                    </div>
                  </div>

                  {/* Unit + dates */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 rounded-xl p-3.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <Home className="w-3 h-3" /> Unit
                      </p>
                      <p className="text-sm font-semibold text-slate-800">
                        {lease.unit_label || (lease.unit ? `Unit #${lease.unit}` : 'Not linked')}
                      </p>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-3.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> Duration
                      </p>
                      {lease.start_date ? (
                        <div>
                          <p className="text-xs font-medium text-slate-800">{formatDate(lease.start_date)}</p>
                          {lease.end_date && (
                            <p className="text-xs text-gray-500">
                              → {formatDate(lease.end_date)}
                              {expiryDays != null && <span className={`ml-1 font-semibold ${expiryColor}`}> ({expiryDays < 0 ? 'expired' : `${expiryDays}d left`})</span>}
                            </p>
                          )}
                        </div>
                      ) : <p className="text-sm text-gray-400">—</p>}
                    </div>
                  </div>

                  {/* Financials */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-emerald-50 rounded-xl p-3.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" /> Rent
                      </p>
                      <p className="text-sm font-bold text-emerald-700">
                        {lease.rent_amount ? `${formatCurrency(lease.rent_amount, lease.currency)}${lease.rent_frequency ? `/${lease.rent_frequency}` : '/mo'}` : '—'}
                      </p>
                      {lease.currency && <p className="text-[10px] text-gray-400 mt-0.5">{lease.currency}</p>}
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" /> Deposit
                      </p>
                      <p className="text-sm font-semibold text-slate-800">
                        {lease.deposit_amount ? formatCurrency(lease.deposit_amount, lease.currency) : '—'}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" /> Annual
                      </p>
                      <p className="text-sm font-semibold text-slate-800">
                        {lease.annual_rent ? formatCurrency(lease.annual_rent, lease.currency) : '—'}
                      </p>
                    </div>
                  </div>

                  {/* AI flags */}
                  {lease.open_flags_count != null && lease.open_flags_count > 0 && (
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 flex items-center gap-2">
                      <Brain className="w-4 h-4 text-purple-600 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-purple-700">{lease.open_flags_count} AI flag{lease.open_flags_count !== 1 ? 's' : ''} detected</p>
                        <p className="text-xs text-purple-600">Switch to Extracted Fields tab to review all data.</p>
                      </div>
                    </div>
                  )}

                  {/* Approve / Reject buttons (only when pending review) */}
                  {lease.approval_status === 'pending_review' && (
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={() => approveMutation.mutate()}
                        disabled={approveMutation.isPending}
                        className="flex-1 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle className="w-4 h-4" /> Approve Lease
                      </button>
                      <button
                        onClick={() => rejectMutation.mutate()}
                        disabled={rejectMutation.isPending}
                        className="flex-1 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <X className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  )}

                  {/* Assign Tenant button — shown when lease is completed or approved and has a unit */}
                  {lease.unit && (lease.processing_status === 'completed' || lease.approval_status === 'approved') && (
                    <div className="pt-2">
                      <button
                        onClick={() => setShowAssignTenant(true)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                      >
                        <UserPlus className="w-4 h-4" /> Assign Tenant to Unit
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Extracted Fields Tab ── */}
          {activeTab === 'fields' && (
            <div className="p-5">
              {lease.processing_status !== 'completed' ? (
                <div className="text-center py-10 text-gray-400 text-sm">
                  Run AI extraction first to see extracted fields.
                </div>
              ) : fieldsLoading ? (
                <div className="text-center py-10 text-gray-400 text-sm">Loading extracted fields…</div>
              ) : orderedFields.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No extracted fields found.</div>
              ) : (
                <div className="space-y-4">
                  {/* Bulk approve pending fields */}
                  {(() => {
                    const pendingIds = orderedFields.filter(f => f.review_status === 'pending').map(f => f.id);
                    if (pendingIds.length === 0) return null;
                    return (
                      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-blue-700 font-medium">
                          {pendingIds.length} field{pendingIds.length !== 1 ? 's' : ''} pending review
                        </p>
                        <button
                          onClick={() => bulkApproveMutation.mutate(pendingIds)}
                          disabled={bulkApproveMutation.isPending}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 transition-colors flex-shrink-0"
                        >
                          {bulkApproveMutation.isPending
                            ? <RefreshCw className="w-3 h-3 animate-spin" />
                            : <CheckCircle className="w-3 h-3" />}
                          Approve all pending
                        </button>
                      </div>
                    );
                  })()}

                  {/* Extracted */}
                  {extractedFields.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Extracted ({extractedFields.length})
                      </p>
                      <div className="space-y-2">
                        {extractedFields.map((field) => (
                          <div key={field.id} className="bg-gray-50 rounded-xl p-3 flex items-start gap-3">
                            <div className="w-6 h-6 bg-white rounded-lg border border-gray-200 flex items-center justify-center flex-shrink-0 text-gray-400 mt-0.5">
                              {FIELD_ICONS[field.field_name] ?? <FileText className="w-3 h-3" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-gray-600">
                                  {FIELD_LABELS[field.field_name] || field.field_name.replace(/_/g, ' ')}
                                </p>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <span className={`text-[10px] font-semibold ${fieldConfidenceColor(field.confidence)}`}>
                                    {Math.round(field.confidence * 100)}%
                                  </span>
                                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${fieldReviewBadge(field.review_status)}`}>
                                    {field.review_status}
                                  </span>
                                  {field.review_status === 'pending' && (
                                    <>
                                      <button
                                        onClick={() => fieldApproveMutation.mutate(field.id)}
                                        disabled={fieldApproveMutation.isPending}
                                        className="p-1 rounded-md text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 transition-colors disabled:opacity-50"
                                        title="Approve field"
                                      >
                                        <CheckCircle className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          setRejectingFieldId(rejectingFieldId === field.id ? null : field.id);
                                          setRejectFieldReason('');
                                        }}
                                        className="p-1 rounded-md text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition-colors"
                                        title="Reject field"
                                      >
                                        <XCircle className="w-3 h-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              <p className="text-sm font-medium text-slate-800 mt-0.5 break-words">
                                {String(field.reviewed_value ?? field.normalized_value ?? field.extracted_value)}
                              </p>
                              {field.source_text && (
                                <p className="text-[10px] text-gray-400 mt-1 italic truncate" title={field.source_text}>
                                  From doc: "{field.source_text}"
                                </p>
                              )}
                              {rejectingFieldId === field.id && (
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    autoFocus
                                    value={rejectFieldReason}
                                    onChange={e => setRejectFieldReason(e.target.value)}
                                    placeholder="Reason for rejection…"
                                    className="flex-1 px-2.5 py-1.5 text-xs border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                                  />
                                  <button
                                    onClick={() => {
                                      if (!rejectFieldReason.trim()) return;
                                      fieldRejectMutation.mutate({ id: field.id, reason: rejectFieldReason.trim() });
                                    }}
                                    disabled={!rejectFieldReason.trim() || fieldRejectMutation.isPending}
                                    className="px-2.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 flex-shrink-0"
                                  >
                                    {fieldRejectMutation.isPending ? 'Rejecting…' : 'Reject'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Not found */}
                  {notFoundFields.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        Not Found in Document ({notFoundFields.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {notFoundFields.map((field) => (
                          <span key={field.id} className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-lg">
                            {FIELD_LABELS[field.field_name] || field.field_name.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Clauses section ── */}
                  {clausesData && clausesData.length > 0 && (
                    <div className="pt-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Clauses &amp; Contract Terms ({clausesData.length})
                      </p>
                      <div className="space-y-2">
                        {clausesData.map((clause) => (
                          <div key={clause.id} className={`rounded-xl p-3 border ${clause.is_unusual ? 'bg-orange-50 border-orange-100' : 'bg-gray-50 border-transparent'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-semibold text-gray-700">{clause.title || clause.clause_type.replace(/_/g, ' ')}</p>
                                {clause.is_unusual && (
                                  <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                    <AlertTriangle className="w-2.5 h-2.5" /> Unusual
                                  </span>
                                )}
                              </div>
                              {clause.confidence != null && (
                                <span className={`text-[10px] font-semibold flex-shrink-0 ${fieldConfidenceColor(clause.confidence)}`}>
                                  {Math.round(clause.confidence * 100)}%
                                </span>
                              )}
                            </div>
                            {clause.raw_text && (
                              <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">{clause.raw_text}</p>
                            )}
                            {clause.interpretation && clause.interpretation !== clause.raw_text && (
                              <p className="text-[11px] text-gray-500 mt-1 italic">{clause.interpretation}</p>
                            )}
                            {clause.is_unusual && clause.unusual_reason && (
                              <p className="text-[11px] text-orange-700 mt-1 font-medium">⚠ {clause.unusual_reason}</p>
                            )}
                            {clause.source_page != null && (
                              <p className="text-[10px] text-gray-400 mt-1">Page {clause.source_page}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── AI Review Tab (Flags + Validations) ── */}
          {activeTab === 'review' && (
            <div className="p-5 space-y-5">
              {/* Flags */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5" /> AI Flags {flagsData ? `(${flagsData.length})` : ''}
                </p>
                {flagsLoading ? (
                  <p className="text-sm text-gray-400 py-4 text-center">Loading flags…</p>
                ) : !flagsData || flagsData.length === 0 ? (
                  <p className="text-sm text-gray-500 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                    No AI flags on this lease.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {flagsData.map(flag => {
                      const severity = (flag.severity ?? 'low').toLowerCase();
                      const sevCls = severity === 'critical' || severity === 'high'
                        ? 'bg-red-50 text-red-700'
                        : severity === 'medium'
                          ? 'bg-orange-50 text-orange-700'
                          : 'bg-gray-100 text-gray-600';
                      const isOpen = !flag.status || flag.status === 'open' || flag.status === 'pending';
                      return (
                        <div key={flag.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${sevCls}`}>
                                {severity}
                              </span>
                              {flag.flag_type && (
                                <span className="text-[10px] font-medium text-gray-500">{flag.flag_type.replace(/_/g, ' ')}</span>
                              )}
                            </div>
                            {flag.status && (
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize flex-shrink-0 ${
                                isOpen ? 'bg-orange-50 text-orange-700' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {flag.status.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-700 mt-1.5">
                            {flag.message || flag.description || flag.title || 'Flag raised by AI review.'}
                          </p>
                          {isOpen && (
                            <div className="flex items-center gap-1.5 mt-2">
                              <button
                                onClick={() => flagReviewMutation.mutate({ id: flag.id, action: 'resolve' })}
                                disabled={flagReviewMutation.isPending}
                                className="px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg disabled:opacity-50"
                              >
                                Resolve
                              </button>
                              <button
                                onClick={() => flagReviewMutation.mutate({ id: flag.id, action: 'dismiss' })}
                                disabled={flagReviewMutation.isPending}
                                className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
                              >
                                Dismiss
                              </button>
                              <button
                                onClick={() => flagReviewMutation.mutate({ id: flag.id, action: 'acknowledge' })}
                                disabled={flagReviewMutation.isPending}
                                className="px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50"
                              >
                                Acknowledge
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Validations scorecard */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Validation Checks {validationsData ? `(${validationsData.length})` : ''}
                  </p>
                  <button
                    onClick={() => revalidateMutation.mutate()}
                    disabled={revalidateMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50"
                    title="Re-run the owner's rules against this lease (after a rule change)"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${revalidateMutation.isPending ? 'animate-spin' : ''}`} />
                    Re-validate
                  </button>
                </div>
                {validationsLoading ? (
                  <p className="text-sm text-gray-400 py-4 text-center">Loading validations…</p>
                ) : !validationsData || validationsData.length === 0 ? (
                  <p className="text-sm text-gray-400 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                    No validation results yet.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {[...validationsData]
                      .sort((a, b) => {
                        const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
                        return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || a.rule_id.localeCompare(b.rule_id);
                      })
                      .map(v => {
                        const sevCls = v.severity === 'high'
                          ? 'bg-red-50 text-red-700'
                          : v.severity === 'medium'
                            ? 'bg-orange-50 text-orange-700'
                            : 'bg-gray-100 text-gray-600';
                        return (
                          <div key={v.id} className="flex items-start gap-2.5 bg-gray-50 rounded-xl px-3 py-2.5">
                            {v.result === 'PASS'
                              ? <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                              : v.result === 'FAIL'
                                ? <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                                : <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-xs font-semibold text-slate-700">{v.rule_id} — {v.rule_name}</p>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${sevCls}`}>
                                  {v.severity}
                                </span>
                              </div>
                              {v.reason && <p className="text-[11px] text-gray-500 mt-0.5">{v.reason}</p>}
                              {v.is_overridden && (
                                <p className="text-[11px] text-blue-700 bg-blue-50 rounded-lg px-2 py-1 mt-1.5">
                                  Overridden by {v.overridden_by}: {v.override_reason}
                                </p>
                              )}
                              {overrideValidationId === v.id ? (
                                <div className="flex items-center gap-1.5 mt-2">
                                  <input
                                    value={overrideReason}
                                    onChange={e => setOverrideReason(e.target.value)}
                                    placeholder="Reason for overriding this rule…"
                                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => overrideValidationMutation.mutate({ id: v.id, reason: overrideReason })}
                                    disabled={!overrideReason.trim() || overrideValidationMutation.isPending}
                                    className="px-2 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    onClick={() => { setOverrideValidationId(null); setOverrideReason(''); }}
                                    className="px-2 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : v.result !== 'PASS' && !v.is_overridden ? (
                                <button
                                  onClick={() => { setOverrideValidationId(v.id); setOverrideReason(''); }}
                                  className="mt-2 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                                >
                                  Override
                                </button>
                              ) : v.is_overridden ? (
                                <button
                                  onClick={() => clearOverrideMutation.mutate(v.id)}
                                  disabled={clearOverrideMutation.isPending}
                                  className="mt-1.5 px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
                                >
                                  Undo override
                                </button>
                              ) : null}
                            </div>
                            <span className={`text-[10px] font-semibold flex-shrink-0 ${
                              v.result === 'PASS' ? 'text-emerald-600' : v.result === 'FAIL' ? 'text-red-600' : 'text-orange-600'
                            }`}>
                              {v.result}{v.is_overridden ? ' · OVERRIDDEN' : ''}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Document Tab ── */}
          {activeTab === 'document' && (
            <div className="p-5 space-y-3">
              {lease.document ? (
                <>
                  <div className="bg-gray-50 rounded-xl p-4 text-center">
                    <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">Lease document PDF</p>
                    <p className="text-xs text-gray-400 mt-0.5 break-all">{fileNameFromUrl(lease.document)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={lease.document} target="_blank" rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                      <Eye className="w-4 h-4" /> View in Browser
                    </a>
                    <a href={lease.document} download
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                      <Download className="w-4 h-4" /> Download
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-center text-sm text-gray-400 py-10">No document attached.</p>
              )}
              <p className="text-xs text-gray-400 text-center">Uploaded {formatDate(lease.created_at)}</p>
            </div>
          )}

          {/* ── Ask AI Tab (kept mounted so the conversation survives tab switches) ── */}
          <div className={activeTab === 'ask' ? 'h-full' : 'hidden'}>
            <AskAiPanel key={lease.id} leaseId={lease.id} />
          </div>

          {/* ── Payments Tab ── */}
          {activeTab === 'payments' && lease.approval_status === 'approved' && (
            <LeasePaymentsTab lease={lease} />
          )}
        </div>

        {/* Footer — Cancel Lease */}
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end flex-shrink-0">
          <button
            onClick={() => { setCancelReason(''); setCancelError(''); setShowCancelDialog(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Cancel Lease
          </button>
        </div>
      </div>

      {/* Assign Tenant Modal */}
      {showAssignTenant && (
        <AssignTenantModal
          lease={lease}
          onClose={() => setShowAssignTenant(false)}
          onSuccess={() => { setShowAssignTenant(false); onProcessed(); }}
        />
      )}

      {/* Cancel Confirmation Dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Cancel Lease</h3>
                <p className="text-xs text-gray-500 mt-0.5">Lease #{lease.id} · {lease.tenant_name || 'Unprocessed'}</p>
              </div>
            </div>

            {lease.approval_status === 'approved' && lease.unit && (
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-xs text-orange-700">
                <span className="font-semibold">Warning:</span> This lease is approved and has a unit assigned. Cancelling will mark the unit as available.
              </div>
            )}

            {lease.processing_status === 'processing' && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700">
                AI extraction is currently running. Wait for it to finish before cancelling.
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Reason for cancellation <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={cancelReason}
                onChange={e => { setCancelReason(e.target.value); setCancelError(''); }}
                placeholder="e.g. Tenant withdrew, incorrect document, duplicate entry…"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 bg-gray-50 resize-none"
              />
            </div>

            {cancelError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{cancelError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelDialog(false)}
                className="flex-1 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Keep Lease
              </button>
              <button
                onClick={() => {
                  if (!cancelReason.trim()) { setCancelError('Please enter a reason.'); return; }
                  cancelMutation.mutate();
                }}
                disabled={cancelMutation.isPending || lease.processing_status === 'processing'}
                className="flex-1 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
              >
                {cancelMutation.isPending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Cancelling…</> : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function LeasesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedLeaseId, setSelectedLeaseId] = useState<number | null>(null);
  const [reanalyzingId, setReanalyzingId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const debouncedSearch = useDebounce(search, 300);
  const pageSize = 15;

  const { data, isLoading, isError, refetch } = useQuery<{ results: Lease[]; count: number }>({
    queryKey: ['leases', { search: debouncedSearch, status: statusFilter, page, expiring: expiringOnly }],
    queryFn: async () => {
      const res = await leasesApi.getAll({
        search: debouncedSearch || undefined,
        processing_status: statusFilter || undefined,
        expiring_within: expiringOnly ? 90 : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        // Backend sorts the expiring view by end_date itself
        ordering: expiringOnly ? undefined : '-created_at',
      });
      return res.data;
    },
    staleTime: 30 * 1000,
    // Poll while anything is processing OR pending (recently uploaded) so a
    // lease can never silently stay stuck at "Pending" in the UI.
    refetchInterval: (query) =>
      query.state.data?.results.some(
        l => l.processing_status === 'processing' || l.processing_status === 'pending'
      ) ? 5000 : false,
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async (id: number) => {
      setReanalyzingId(id);
      await leasesApi.process(id);
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to start re-analysis.'), 'error'),
    onSettled: () => {
      setReanalyzingId(null);
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });

  const leases = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  // Derive the open modal's lease from the cached list so background
  // refetches keep the modal fresh (no stale snapshot in state).
  const selectedLease = selectedLeaseId != null
    ? leases.find(l => l.id === selectedLeaseId) ?? null
    : null;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['leases'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  };

  return (
    <div className="space-y-5">
      {showNewModal && (
        <NewLeaseModal onClose={() => setShowNewModal(false)} onSuccess={handleRefresh} />
      )}
      {selectedLease && (
        <LeaseDetailModal
          lease={selectedLease}
          onClose={() => setSelectedLeaseId(null)}
          onProcessed={handleRefresh}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Leases</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} lease document{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" icon={<Upload className="w-4 h-4" />} onClick={() => setShowNewModal(true)}>
            Upload Lease
          </Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowNewModal(true)}>New Lease</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by tenant name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
          />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700">
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label="Expiry filter">
          <button
            onClick={() => { setExpiringOnly(false); setPage(1); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              !expiringOnly ? 'bg-white text-slate-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            All
          </button>
          <button
            onClick={() => { setExpiringOnly(true); setPage(1); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              expiringOnly ? 'bg-white text-slate-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Clock className="w-3.5 h-3.5" /> Expiring ≤90d
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isError ? (
          <QueryError label="leases" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading leases...</div>
        ) : leases.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-8 h-8" />}
            title="No lease documents"
            description="Upload a PDF lease document to get started. AI will extract all the details."
            action={{ label: 'Upload Lease', onClick: () => setShowNewModal(true), icon: <Upload className="w-4 h-4" /> }}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tenant</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Dates</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Rent</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Deposit</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Processing</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Approval</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {leases.map((lease) => {
                    const pb = processingBadge(lease.processing_status);
                    const ab = approvalBadge(lease.approval_status);
                    const daysLeft = lease.end_date ? getDaysUntil(lease.end_date) : null;
                    return (
                      <tr key={lease.id}
                        onClick={() => setSelectedLeaseId(lease.id)}
                        className="hover:bg-gray-50 transition-colors cursor-pointer">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 bg-blue-50 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-blue-600">
                                {(lease.tenant_name ?? 'L').charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-900 truncate max-w-[140px]">
                                {lease.tenant_name || <span className="text-gray-400 italic">Not extracted</span>}
                              </p>
                              {lease.landlord_name && (
                                <p className="text-xs text-gray-400 truncate max-w-[140px]">{lease.landlord_name}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-700">
                          {lease.unit_label || (lease.unit ? `Unit #${lease.unit}` : <span className="text-gray-400">—</span>)}
                        </td>
                        <td className="px-5 py-3.5">
                          {lease.start_date ? (
                            <>
                              <p className="text-xs text-gray-600">{formatDate(lease.start_date)}</p>
                              {lease.end_date && (
                                <p className="text-xs text-gray-400">
                                  → {formatDate(lease.end_date)}
                                  {!expiringOnly && daysLeft != null && daysLeft <= 30 && (
                                    <span className={`ml-1 font-medium ${daysLeft < 0 ? 'text-red-600' : 'text-orange-500'}`}>
                                      ({daysLeft < 0 ? 'expired' : `${daysLeft}d`})
                                    </span>
                                  )}
                                </p>
                              )}
                              {expiringOnly && daysLeft != null && (
                                <span className={`inline-flex mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  daysLeft <= 30 ? 'bg-red-50 text-red-700'
                                    : daysLeft <= 60 ? 'bg-amber-50 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'}`}
                                >
                                  {daysLeft < 0 ? 'Expired' : `${daysLeft}d left`}
                                </span>
                              )}
                            </>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-medium text-slate-700">
                          {lease.rent_amount ? `${formatCurrency(lease.rent_amount, lease.currency)}/mo` : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-700">
                          {lease.deposit_amount ? formatCurrency(lease.deposit_amount, lease.currency) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${pb.color}`}>{pb.label}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${ab.color}`}>{ab.label}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => setSelectedLeaseId(lease.id)}
                              className="p-1.5 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors"
                              title="View details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {lease.document && (
                              <a href={lease.document} download
                                className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                                title="Download document">
                                <Download className="w-3.5 h-3.5" />
                              </a>
                            )}
                            {lease.document && ['pending', 'failed'].includes(lease.processing_status) && (
                              <button
                                onClick={() => reanalyzeMutation.mutate(lease.id)}
                                disabled={reanalyzingId === lease.id}
                                className="p-1.5 hover:bg-purple-50 text-gray-400 hover:text-purple-600 rounded-lg transition-colors disabled:opacity-50"
                                title="Re-analyze with AI"
                              >
                                {reanalyzingId === lease.id
                                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  : <Brain className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 text-gray-600">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-gray-600 px-2">Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 text-gray-600">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
