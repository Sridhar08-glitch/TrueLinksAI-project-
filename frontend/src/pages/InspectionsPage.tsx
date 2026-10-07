import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, CheckCircle, XCircle, Clock, AlertTriangle,
  ClipboardCheck, X, Camera, Zap, Image, ChevronDown, ChevronUp, Trash2,
  CalendarClock, Play, Power, RefreshCw,
} from 'lucide-react';
import { inspectionsApi, inspectionFindingsApi, inspectionSchedulesApi, unitsApi } from '../lib/api';
import type { Inspection, InspectionSchedule, Unit } from '../types';
import { formatDate, capitalizeFirst, extractApiError } from '../lib/utils';
import { Badge, getStatusVariant } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { useToast } from '../components/ui/Toast';
import { useDebounce } from '../lib/useDebounce';
import { useAuthStore } from '../store/authStore';

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="w-3.5 h-3.5 text-yellow-500" />,
  analyzing: <Zap className="w-3.5 h-3.5 text-blue-500" />,
  completed: <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />,
  failed: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
};

const FINDING_CATEGORY_COLORS: Record<string, string> = {
  damage: 'text-red-700 bg-red-50 border-red-100',
  equipment: 'text-blue-700 bg-blue-50 border-blue-100',
  fixture: 'text-purple-700 bg-purple-50 border-purple-100',
  general: 'text-gray-700 bg-gray-50 border-gray-100',
};

// ── Confirm Delete ─────────────────────────────────────────────────────────
function ConfirmDelete({ label, onCancel, onConfirm, isPending }: {
  label: string; onCancel: () => void; onConfirm: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
          <div><h3 className="text-base font-bold text-slate-900">Delete Inspection</h3><p className="text-sm text-gray-500">This cannot be undone.</p></div>
        </div>
        <p className="text-sm text-gray-700">Delete <span className="font-semibold">{label}</span>? All findings and photos will be removed.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancel</button>
          <button onClick={onConfirm} disabled={isPending} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60">
            {isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Inspection Wizard ──────────────────────────────────────────────────
function NewInspectionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<'form' | 'images'>('form');
  const [inspectionId, setInspectionId] = useState<number | null>(null);
  const [form, setForm] = useState({ unit: '', reporter_type: 'inspector', description: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: unitsData } = useQuery<{ results: Unit[] }>({
    queryKey: ['units-all'],
    queryFn: async () => (await unitsApi.getAll({ limit: 200 })).data,
    staleTime: 5 * 60 * 1000,
  });
  const units = unitsData?.results ?? [];

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => inspectionsApi.create(data),
    onSuccess: (res) => { setInspectionId(res.data.id); setStep('images'); },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.unit) e.unit = 'Select a unit';
    setFormErrors(e);
    return !Object.keys(e).length;
  };

  const handleCreate = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    createMutation.mutate({ unit: Number(form.unit), reporter_type: form.reporter_type, description: form.description || undefined });
  };

  const addImages = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    const newPreviews = newFiles.map(f => URL.createObjectURL(f));
    setImages(prev => [...prev, ...newFiles]);
    setPreviews(prev => [...prev, ...newPreviews]);
  };

  const removeImage = (idx: number) => {
    URL.revokeObjectURL(previews[idx]);
    setImages(prev => prev.filter((_, i) => i !== idx));
    setPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAnalyze = async () => {
    if (!inspectionId) return;
    setAnalyzing(true); setAnalyzeError('');
    try {
      if (images.length > 0) await inspectionsApi.uploadImages(inspectionId, images);
      await inspectionsApi.analyze(inspectionId);
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      onCreated(); onClose();
    } catch { setAnalyzeError('Analysis failed. You can still save and analyze later.'); setAnalyzing(false); }
  };

  const handleSaveOnly = async () => {
    if (!inspectionId) return;
    if (images.length > 0) { try { await inspectionsApi.uploadImages(inspectionId, images); } catch { /* ignore */ } }
    queryClient.invalidateQueries({ queryKey: ['inspections'] });
    onCreated(); onClose();
  };

  const ic = (key: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${formErrors[key] ? 'border-red-300' : 'border-gray-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{step === 'form' ? 'New Inspection' : 'Upload Photos'}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${step === 'form' ? 'bg-slate-900 text-white' : 'bg-emerald-500 text-white'}`}>1</span>
              <span className="text-xs text-gray-400">—</span>
              <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${step === 'images' ? 'bg-slate-900 text-white' : 'bg-gray-200 text-gray-500'}`}>2</span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        {step === 'form' ? (
          <form onSubmit={handleCreate} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit *</label>
              <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className={ic('unit')}>
                <option value="">— Select unit —</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.label}{u.building_name ? ` · ${u.building_name}` : ''}{u.property_name ? ` · ${u.property_name}` : ''}</option>)}
              </select>
              {formErrors.unit && <p className="text-xs text-red-600 mt-1">{formErrors.unit}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reporter Type</label>
              <select value={form.reporter_type} onChange={e => setForm(f => ({ ...f, reporter_type: e.target.value }))} className={ic('reporter_type')}>
                <option value="inspector">Inspector</option><option value="owner">Owner</option><option value="tenant">Tenant</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3}
                placeholder="Describe the inspection scope or specific concerns..." className={ic('description') + ' resize-none'} />
            </div>
            {createMutation.isError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Failed. Please try again.</p>}
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button type="submit" disabled={createMutation.isPending}
                className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60">
                {createMutation.isPending ? 'Creating...' : 'Next: Add Photos'}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-4">
            <p className="text-xs text-gray-500">Upload photos of the unit. Our AI will automatically identify issues and generate findings.</p>
            <div onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); addImages(e.dataTransfer.files); }}
              className="border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl p-6 text-center cursor-pointer transition-colors">
              <Camera className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-600">Drag & drop photos here</p>
              <p className="text-xs text-gray-400 mt-1">or click to select from your device</p>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addImages(e.target.files)} />
            </div>
            {previews.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {previews.map((src, idx) => (
                  <div key={idx} className="relative group aspect-square">
                    <img src={src} alt="" className="w-full h-full object-cover rounded-lg" />
                    <button onClick={() => removeImage(idx)}
                      className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button onClick={() => fileRef.current?.click()}
                  className="aspect-square border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-500 transition-colors">
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            )}
            {analyzeError && <p className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">{analyzeError}</p>}
            <div className="flex justify-between items-center pt-1">
              <button onClick={handleSaveOnly} disabled={analyzing}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-60">
                Save Without Analysis
              </button>
              <button onClick={handleAnalyze} disabled={analyzing || images.length === 0}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 flex items-center gap-2">
                {analyzing ? (
                  <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg> Analyzing...</>
                ) : (
                  <><Zap className="w-4 h-4" /> Analyze with AI ({images.length} photo{images.length !== 1 ? 's' : ''})</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inspection Detail Modal ────────────────────────────────────────────────
function InspectionDetailModal({ inspection, onClose, onReanalyze, onDelete, canDelete, canReview }: {
  inspection: Inspection; onClose: () => void; onReanalyze: (id: number) => void; onDelete: () => void;
  canDelete: boolean; canReview: boolean;
}) {
  const [showImages, setShowImages] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadPreviews, setUploadPreviews] = useState<{ file: File; url: string }[]>([]);
  const addFileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const reviewer = useAuthStore((s) => s.user?.email);

  const findingReviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'confirmed' | 'dismissed' }) =>
      inspectionFindingsApi.review(id, status, reviewer),
    onSuccess: () => {
      toast('Finding updated');
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      queryClient.invalidateQueries({ queryKey: ['inspection-findings'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to review finding.'), 'error'),
  });

  const handleAddFiles = (files: FileList | null) => {
    if (!files) return;
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
    setUploadPreviews(prev => [...prev, ...imgs.map(f => ({ file: f, url: URL.createObjectURL(f) }))]);
  };

  const handleUploadAndReanalyze = async () => {
    if (!uploadPreviews.length) return;
    setUploadingImages(true);
    try {
      await inspectionsApi.uploadImages(inspection.id, uploadPreviews.map(p => p.file));
      uploadPreviews.forEach(p => URL.revokeObjectURL(p.url));
      setUploadPreviews([]);
      onReanalyze(inspection.id);
    } catch {
      setUploadingImages(false);
    }
  };

  const canReanalyze = inspection.status !== 'analyzing' && inspection.images.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-base font-bold text-slate-900">Inspection #{inspection.id}</h2>
            <p className="text-xs text-gray-500">{inspection.unit_label ?? `Unit ${inspection.unit}`} · {formatDate(inspection.created_at)}</p>
          </div>
          <div className="flex items-center gap-1">
            {canDelete && (
              <button onClick={onDelete} className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge label={inspection.status} variant={getStatusVariant(inspection.status)} dot />
            <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full">{capitalizeFirst(inspection.reporter_type)}</span>
            {inspection.images.length > 0 && (
              <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full">{inspection.images.length} photo{inspection.images.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          {inspection.description && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-gray-700">{inspection.description}</p>
            </div>
          )}
          {/* Add new photos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Add More Photos</p>
              <button onClick={() => addFileRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-gray-100 hover:bg-gray-200 rounded-lg">
                <Camera className="w-3.5 h-3.5" /> Select Photos
              </button>
              <input ref={addFileRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => handleAddFiles(e.target.files)} />
            </div>
            {uploadPreviews.length > 0 && (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-1.5">
                  {uploadPreviews.map((p, i) => (
                    <div key={i} className="relative aspect-square">
                      <img src={p.url} alt="" className="w-full h-full object-cover rounded-lg" />
                      <button onClick={() => { URL.revokeObjectURL(p.url); setUploadPreviews(prev => prev.filter((_, j) => j !== i)); }}
                        className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 text-white rounded-full flex items-center justify-center">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={handleUploadAndReanalyze} disabled={uploadingImages}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60">
                  {uploadingImages ? (
                    <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg> Uploading & Analyzing...</>
                  ) : (
                    <><Zap className="w-4 h-4" /> Upload & Re-analyze ({uploadPreviews.length} new photo{uploadPreviews.length !== 1 ? 's' : ''})</>
                  )}
                </button>
              </div>
            )}
          </div>

          {canReanalyze && uploadPreviews.length === 0 && (
            <button onClick={() => onReanalyze(inspection.id)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg">
              <Zap className="w-4 h-4" />
              {inspection.status === 'failed' ? 'Retry Analysis' : 'Re-analyze with AI'}
            </button>
          )}
          {inspection.images.length > 0 && (
            <div>
              <button onClick={() => setShowImages(!showImages)} className="flex items-center gap-2 text-xs font-medium text-gray-600 hover:text-gray-900 mb-2">
                <Image className="w-3.5 h-3.5" />Photos ({inspection.images.length})
                {showImages ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showImages && (
                <div className="grid grid-cols-3 gap-2">
                  {inspection.images.map(img => (
                    <a key={img.id} href={img.image} target="_blank" rel="noreferrer">
                      <img src={img.image} alt={img.original_filename} className="w-full aspect-square object-cover rounded-lg hover:opacity-90 transition-opacity" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          {(inspection.status === 'completed' || inspection.findings.length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  AI Findings ({inspection.findings.length})
                </p>
                {inspection.analyzed_at && (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full font-medium">
                    Fresh · {formatDate(inspection.analyzed_at)} · {inspection.images.length} photo{inspection.images.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {inspection.findings.length === 0 ? (
                <p className="text-sm text-gray-500 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">No issues found — unit is in good condition.</p>
              ) : (
                <div className="space-y-2">
                  {inspection.findings.map(f => {
                    const fromImage = inspection.images.find(img => img.id === f.image);
                    return (
                      <div key={f.id} className={`border rounded-xl p-3 ${FINDING_CATEGORY_COLORS[f.category] ?? 'text-gray-700 bg-gray-50 border-gray-100'}`}>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-semibold uppercase tracking-wide">{f.category}</span>
                          {f.confidence != null && <span className="text-[10px] opacity-70">{Math.round(f.confidence * 100)}% confidence</span>}
                          {fromImage && (
                            <span className="text-[10px] opacity-50 truncate max-w-[120px]">· {fromImage.original_filename}</span>
                          )}
                          <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${
                            f.review_status === 'confirmed' ? 'bg-emerald-100 text-emerald-700'
                              : f.review_status === 'dismissed' ? 'bg-gray-200 text-gray-600'
                              : 'bg-white/60 opacity-70'
                          }`}>
                            {f.review_status}
                          </span>
                        </div>
                        {f.equipment_name && <p className="text-sm font-medium">{f.equipment_name}</p>}
                        {f.damage_description && <p className="text-xs opacity-80 mt-0.5">{f.damage_description}</p>}
                        {f.condition && <p className="text-xs opacity-60 mt-0.5">Condition: {f.condition}</p>}
                        {canReview && f.review_status === 'pending' && (
                          <div className="flex items-center gap-1.5 mt-2">
                            <button
                              onClick={() => findingReviewMutation.mutate({ id: f.id, status: 'confirmed' })}
                              disabled={findingReviewMutation.isPending}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 rounded-lg disabled:opacity-50 transition-colors"
                            >
                              <CheckCircle className="w-3 h-3" /> Confirm
                            </button>
                            <button
                              onClick={() => findingReviewMutation.mutate({ id: f.id, status: 'dismissed' })}
                              disabled={findingReviewMutation.isPending}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg disabled:opacity-50 transition-colors"
                            >
                              <XCircle className="w-3 h-3" /> Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {inspection.status === 'analyzing' && (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <svg className="animate-spin w-4 h-4 text-blue-600 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <p className="text-sm text-blue-700">AI analysis in progress…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── New Schedule Modal ─────────────────────────────────────────────────────
function NewScheduleModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ unit: '', title: '', description: '', frequency_months: '6', next_due_date: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: unitsData } = useQuery<{ results: Unit[] }>({
    queryKey: ['units-all'],
    queryFn: async () => (await unitsApi.getAll({ limit: 200 })).data,
    staleTime: 5 * 60 * 1000,
  });
  const units = unitsData?.results ?? [];

  const mutation = useMutation({
    mutationFn: () => inspectionSchedulesApi.create({
      unit: Number(form.unit),
      title: form.title.trim(),
      description: form.description.trim(),
      frequency_months: Number(form.frequency_months),
      next_due_date: form.next_due_date,
    }),
    onSuccess: () => {
      toast('Schedule created');
      queryClient.invalidateQueries({ queryKey: ['inspection-schedules'] });
      onClose();
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to create schedule.'), 'error'),
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.unit) e.unit = 'Select a unit';
    if (!form.title.trim()) e.title = 'Required';
    if (!form.frequency_months || Number(form.frequency_months) < 1) e.frequency_months = 'Enter months (≥ 1)';
    if (!form.next_due_date) e.next_due_date = 'Required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const ic = (k: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${errors[k] ? 'border-red-300' : 'border-gray-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">New Inspection Schedule</h2>
            <p className="text-xs text-gray-500 mt-0.5">Recurring inspections for a unit</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (validate()) mutation.mutate(); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Unit *</label>
            <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className={ic('unit')}>
              <option value="">— Select unit —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.label}{u.building_name ? ` · ${u.building_name}` : ''}</option>)}
            </select>
            {errors.unit && <p className="text-xs text-red-600 mt-1">{errors.unit}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Quarterly HVAC check" className={ic('title')} />
            {errors.title && <p className="text-xs text-red-600 mt-1">{errors.title}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What should be checked…" className={ic('description') + ' resize-none'} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Every N Months *</label>
              <input type="number" min="1" value={form.frequency_months}
                onChange={e => setForm(f => ({ ...f, frequency_months: e.target.value }))} className={ic('frequency_months')} />
              {errors.frequency_months && <p className="text-xs text-red-600 mt-1">{errors.frequency_months}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Next Due Date *</label>
              <input type="date" value={form.next_due_date}
                onChange={e => setForm(f => ({ ...f, next_due_date: e.target.value }))} className={ic('next_due_date')} />
              {errors.next_due_date && <p className="text-xs text-red-600 mt-1">{errors.next_due_date}</p>}
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={mutation.isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
              {mutation.isPending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating…</> : <><Plus className="w-4 h-4" /> Create Schedule</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Schedules View ─────────────────────────────────────────────────────────
function SchedulesView({ canWrite, onNew }: { canWrite: boolean; onNew: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [runningId, setRunningId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<InspectionSchedule[]>({
    queryKey: ['inspection-schedules'],
    queryFn: async () => {
      const d = (await inspectionSchedulesApi.getAll({ limit: 100 })).data;
      return Array.isArray(d) ? d : d.results ?? [];
    },
    staleTime: 30 * 1000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['inspection-schedules'] });

  const runNowMutation = useMutation({
    mutationFn: (id: number) => { setRunningId(id); return inspectionSchedulesApi.runNow(id); },
    onSuccess: () => {
      toast('Inspection created');
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to run schedule.'), 'error'),
    onSettled: () => setRunningId(null),
  });

  const toggleMutation = useMutation({
    mutationFn: (s: InspectionSchedule) => { setTogglingId(s.id); return inspectionSchedulesApi.update(s.id, { is_active: !s.is_active }); },
    onSuccess: (_res, s) => { toast(s.is_active ? 'Schedule deactivated' : 'Schedule activated'); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to update schedule.'), 'error'),
    onSettled: () => setTogglingId(null),
  });

  const schedules = data ?? [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isOverdue = (s: InspectionSchedule) => new Date(s.next_due_date) < today;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {isError ? (
        <QueryError label="inspection schedules" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="p-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState icon={<CalendarClock className="w-8 h-8" />} title="No inspection schedules"
          description="Set up recurring inspections so units are checked on a regular cadence."
          action={canWrite ? { label: 'New Schedule', onClick: onNew, icon: <Plus className="w-4 h-4" /> } : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Frequency</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Next Due</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                {canWrite && <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {schedules.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 text-sm text-slate-700">{s.unit_label ?? `Unit ${s.unit}`}</td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-medium text-slate-900">{s.title}</p>
                    {s.description && <p className="text-xs text-gray-400 truncate max-w-[220px]">{s.description}</p>}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">
                    Every {s.frequency_months} month{s.frequency_months !== 1 ? 's' : ''}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-sm font-medium ${isOverdue(s) ? 'text-red-600' : 'text-slate-700'}`}>
                      {formatDate(s.next_due_date)}
                    </span>
                    {isOverdue(s) && (
                      <span className="ml-1.5 inline-flex text-[10px] font-semibold bg-red-50 text-red-700 px-1.5 py-0.5 rounded-full">Overdue</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge label={s.is_active ? 'active' : 'inactive'} variant={s.is_active ? 'success' : 'gray'} dot />
                  </td>
                  {canWrite && (
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => runNowMutation.mutate(s.id)}
                          disabled={runningId === s.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50 transition-colors"
                          title="Create an inspection from this schedule now"
                        >
                          {runningId === s.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run now
                        </button>
                        <button
                          onClick={() => toggleMutation.mutate(s)}
                          disabled={togglingId === s.id}
                          className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors ${
                            s.is_active ? 'text-gray-600 bg-gray-100 hover:bg-gray-200' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}
                        >
                          <Power className="w-3 h-3" /> {s.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function InspectionsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [view, setView] = useState<'inspections' | 'schedules'>('inspections');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showNewScheduleModal, setShowNewScheduleModal] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deletingInspection, setDeletingInspection] = useState<Inspection | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const role = useAuthStore((s) => s.user?.role);
  const canDelete = role !== 'maintenance_staff';
  const canReview = role === 'owner' || role === 'property_manager';
  // Schedules are read-only for maintenance staff
  const canWriteSchedules = role === 'owner' || role === 'property_manager';

  const { data, isLoading, isError, refetch } = useQuery<{ results: Inspection[]; count: number }>({
    queryKey: ['inspections', { search: debouncedSearch, status: statusFilter }],
    queryFn: async () => (await inspectionsApi.getAll({
      search: debouncedSearch || undefined, status: statusFilter || undefined, limit: 50, ordering: '-created_at',
    })).data,
    staleTime: 30 * 1000,
    refetchInterval: (query) => {
      const results = (query.state.data as { results: Inspection[] } | undefined)?.results ?? [];
      return results.some((i: Inspection) => i.status === 'analyzing') ? 3000 : false;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['inspections'] });

  const inspections = data?.results ?? [];
  const total = data?.count ?? 0;
  const analyzing = inspections.filter(i => i.status === 'analyzing').length;

  // Derive the open detail modal entity from the cached list so background
  // polling automatically refreshes the modal contents.
  const selected = selectedId != null ? inspections.find(i => i.id === selectedId) ?? null : null;

  const analyzeMutation = useMutation({
    mutationFn: (id: number) => inspectionsApi.analyze(id),
    onSuccess: () => { invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to start analysis.'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => inspectionsApi.delete(id),
    onSuccess: () => { toast('Inspection deleted'); setDeletingInspection(null); setSelectedId(null); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to delete inspection.'), 'error'),
  });

  return (
    <div className="space-y-5">
      {showNewModal && <NewInspectionModal onClose={() => setShowNewModal(false)} onCreated={invalidate} />}
      {showNewScheduleModal && <NewScheduleModal onClose={() => setShowNewScheduleModal(false)} />}
      {deletingInspection && (
        <ConfirmDelete
          label={`Inspection #${deletingInspection.id} (${deletingInspection.unit_label ?? `Unit ${deletingInspection.unit}`})`}
          isPending={deleteMutation.isPending}
          onCancel={() => setDeletingInspection(null)}
          onConfirm={() => deleteMutation.mutate(deletingInspection.id)}
        />
      )}
      {selected && !deletingInspection && (
        <InspectionDetailModal inspection={selected} onClose={() => setSelectedId(null)}
          onReanalyze={(id) => analyzeMutation.mutate(id)}
          onDelete={() => setDeletingInspection(selected)}
          canDelete={canDelete}
          canReview={canReview}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Inspections</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} total
            {analyzing > 0 && <span className="ml-2 text-blue-600 font-medium">• {analyzing} analyzing</span>}
          </p>
        </div>
        {view === 'schedules'
          ? (canWriteSchedules && (
              <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowNewScheduleModal(true)}>New Schedule</Button>
            ))
          : <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowNewModal(true)}>New Inspection</Button>}
      </div>

      {/* Inspections | Schedules segmented control */}
      <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 w-fit" role="group" aria-label="Inspections view">
        <button onClick={() => setView('inspections')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            view === 'inspections' ? 'bg-white text-slate-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <ClipboardCheck className="w-3.5 h-3.5" /> Inspections
        </button>
        <button onClick={() => setView('schedules')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            view === 'schedules' ? 'bg-white text-slate-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <CalendarClock className="w-3.5 h-3.5" /> Schedules
        </button>
      </div>

      {view === 'schedules' ? (
        <SchedulesView canWrite={canWriteSchedules} onNew={() => setShowNewScheduleModal(true)} />
      ) : (
      <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search inspections..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700">
          <option value="">All Status</option>
          <option value="pending">Pending</option><option value="analyzing">Analyzing</option>
          <option value="completed">Completed</option><option value="failed">Failed</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isError ? (
          <QueryError label="inspections" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading inspections...</div>
        ) : inspections.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="w-8 h-8" />} title="No inspections found"
            description="Create an inspection to assess unit conditions with AI."
            action={{ label: 'New Inspection', onClick: () => setShowNewModal(true), icon: <Plus className="w-4 h-4" /> }} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Inspection</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Reporter</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Photos</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Findings</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {inspections.map(insp => (
                  <tr key={insp.id} onClick={() => setSelectedId(insp.id)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center">
                          {STATUS_ICONS[insp.status] ?? <ClipboardCheck className="w-3.5 h-3.5 text-blue-500" />}
                        </div>
                        <span className="text-sm font-medium text-slate-900">#{insp.id}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-700">{insp.unit_label ?? `Unit ${insp.unit}`}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{capitalizeFirst(insp.reporter_type)}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      {insp.images.length > 0 ? <span className="flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> {insp.images.length}</span> : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      {insp.findings.length > 0 ? <span className="text-orange-600 font-medium">{insp.findings.length} found</span>
                        : insp.status === 'completed' ? <span className="text-emerald-600">None</span> : '—'}
                    </td>
                    <td className="px-5 py-3.5"><Badge label={insp.status} variant={getStatusVariant(insp.status)} dot /></td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">{formatDate(insp.created_at)}</td>
                    <td className="px-3 py-3.5">
                      {canDelete && (
                        <button onClick={e => { e.stopPropagation(); setDeletingInspection(insp); }}
                          className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
