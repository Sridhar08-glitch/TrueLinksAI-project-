import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wrench, Plus, X, CheckCircle, Clock, AlertTriangle,
  ChevronDown, Camera, Pencil, Zap, Sparkles, RotateCcw,
} from 'lucide-react';
import { tenantApi, inspectionsApi } from '../../lib/api';
import { formatDate, formatRelativeTime, capitalizeFirst } from '../../lib/utils';
import { Badge, getStatusVariant } from '../../components/ui/Badge';
import type { Inspection, InspectionFinding } from '../../types';

interface WorkOrderItem {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

const PRIORITIES = [
  { value: 'low', label: 'Low — Not urgent' },
  { value: 'medium', label: 'Medium — Within a week' },
  { value: 'high', label: 'High — Within 48 hours' },
  { value: 'urgent', label: 'Urgent — Emergency' },
];

function statusIcon(s: string) {
  if (s === 'completed') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (s === 'in_progress' || s === 'approved') return <Clock className="w-4 h-4 text-blue-500" />;
  return <AlertTriangle className="w-4 h-4 text-orange-400" />;
}

// Returns null if findings are empty/generic (no real issues identified)
function suggestFromFindings(findings: InspectionFinding[]): { title: string; description: string; priority: string } | null {
  // Filter out generic placeholder findings
  const meaningful = findings.filter(f => {
    if (f.category === 'general' && (f.confidence ?? 0) < 0.6) return false;
    if (!f.damage_description && !f.equipment_name) return false;
    // Skip the mock default message
    if (f.damage_description?.toLowerCase().includes('no specific damage identified')) return false;
    if (f.damage_description?.toLowerCase().includes('image analyzed')) return false;
    return true;
  });

  if (meaningful.length === 0) return null;

  const sorted = [...meaningful].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const top = sorted[0];

  const titleParts = [top.equipment_name, top.damage_description?.split('.')[0]].filter(Boolean);
  const title = titleParts.join(': ') || top.category || 'Issue identified';

  const description = sorted
    .map(f => {
      const parts = [f.equipment_name, f.damage_description || f.condition].filter(Boolean);
      return `• ${parts.join(' — ')}`;
    })
    .join('\n');

  const damageCount = sorted.filter(f => f.category === 'damage').length;
  const topConf = top.confidence ?? 0;
  let priority = 'medium';
  if (damageCount >= 2 || topConf > 0.9) priority = 'urgent';
  else if (damageCount >= 1 || topConf > 0.7) priority = 'high';

  return { title: title.slice(0, 120), description, priority };
}

// ── Modal ──────────────────────────────────────────────────────────────────
type ModalMode = 'choose' | 'ai' | 'manual';
type AiStep = 'upload' | 'analyzing' | 'form' | 'no-findings' | 'failed';

function SubmitModal({ unitId, onClose }: { unitId: number | undefined; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<ModalMode>('choose');
  const [aiStep, setAiStep] = useState<AiStep>('upload');
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [inspectionId, setInspectionId] = useState<number | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState({ title: '', description: '', priority: 'medium' });
  const [aiEdited, setAiEdited] = useState({ title: '', description: '', priority: 'medium' });
  const [manualForm, setManualForm] = useState({ title: '', description: '', priority: 'medium' });
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Poll inspection while analyzing
  const { data: inspectionPoll } = useQuery<Inspection>({
    queryKey: ['inspection-ai-poll', inspectionId],
    queryFn: async () => { const r = await inspectionsApi.getById(inspectionId!); return r.data; },
    enabled: aiStep === 'analyzing' && inspectionId !== null,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 3000;
      return (d.status === 'analyzing' || d.status === 'pending') ? 3000 : false;
    },
  });

  // React to inspection status changes
  useEffect(() => {
    if (!inspectionPoll) return;
    if (inspectionPoll.status === 'completed') {
      const suggested = suggestFromFindings(inspectionPoll.findings);
      if (suggested) {
        setAiSuggestion(suggested);
        setAiEdited(suggested);
        setAiStep('form');
      } else {
        setAiStep('no-findings');
      }
    } else if (inspectionPoll.status === 'failed') {
      setAiStep('failed');
    }
  }, [inspectionPoll?.status]);

  const submitMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => tenantApi.submitMaintenance(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-my-info'] });
      onClose();
    },
    onError: () => setErr('Failed to submit. Please try again.'),
  });

  // ── Image helpers ──────────────────────────────────────────────────────
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

  // ── AI analyze ────────────────────────────────────────────────────────
  const [analyzing, setAnalyzing] = useState(false);
  const handleAnalyze = async () => {
    if (!unitId || images.length === 0) return;
    setAnalyzing(true);
    setErr('');
    try {
      const createRes = await inspectionsApi.create({ unit: unitId, reporter_type: 'tenant', description: 'Tenant photo submission' });
      const id: number = createRes.data.id;
      setInspectionId(id);
      await inspectionsApi.uploadImages(id, images);
      await inspectionsApi.analyze(id);
      setAiStep('analyzing');
    } catch {
      setErr('Could not start analysis. Please try manual entry.');
      setAiStep('failed');
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Submit handlers ───────────────────────────────────────────────────
  const submitAi = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiEdited.title.trim()) { setErr('Title is required.'); return; }
    if (!aiEdited.description.trim()) { setErr('Description is required.'); return; }
    setErr('');
    submitMutation.mutate({
      title: aiEdited.title,
      description: aiEdited.description,
      priority: aiEdited.priority,
      ...(inspectionId ? { inspection_id: inspectionId } : {}),
    });
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.title.trim()) { setErr('Title is required.'); return; }
    if (!manualForm.description.trim()) { setErr('Description is required.'); return; }
    setErr('');
    submitMutation.mutate({ title: manualForm.title, description: manualForm.description, priority: manualForm.priority });
  };

  const ic = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-slate-900">Submit Maintenance Request</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        {/* ── CHOOSE mode ──────────────────────────────────────────────── */}
        {mode === 'choose' && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-500">How would you like to describe the issue?</p>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setMode('ai')}
                className="group flex flex-col items-center gap-3 border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50/40 rounded-2xl p-5 text-left transition-all"
              >
                <div className="w-12 h-12 bg-blue-100 group-hover:bg-blue-200 rounded-xl flex items-center justify-center transition-colors">
                  <Camera className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Upload Photos</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">AI will identify the issue and fill in the details</p>
                </div>
                <span className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-3 h-3" /> AI-Assisted
                </span>
              </button>

              <button
                onClick={() => setMode('manual')}
                className="group flex flex-col items-center gap-3 border-2 border-gray-200 hover:border-slate-400 hover:bg-gray-50 rounded-2xl p-5 text-left transition-all"
              >
                <div className="w-12 h-12 bg-gray-100 group-hover:bg-gray-200 rounded-xl flex items-center justify-center transition-colors">
                  <Pencil className="w-6 h-6 text-gray-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Manual Entry</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">Describe the issue yourself in your own words</p>
                </div>
                <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Standard</span>
              </button>
            </div>
          </div>
        )}

        {/* ── AI mode ──────────────────────────────────────────────────── */}
        {mode === 'ai' && (
          <div className="p-6 space-y-4">
            {/* Upload step */}
            {aiStep === 'upload' && (
              <>
                <p className="text-xs text-gray-500">
                  Upload photos of the issue — our AI will automatically identify the problem and pre-fill the request for you.
                </p>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); addImages(e.dataTransfer.files); }}
                  className="border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl p-6 text-center cursor-pointer transition-colors"
                >
                  <Camera className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-600">Drag & drop or tap to add photos</p>
                  <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP — up to 10 photos</p>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={e => addImages(e.target.files)} />
                </div>

                {previews.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {previews.map((src, idx) => (
                      <div key={idx} className="relative group aspect-square">
                        <img src={src} alt="" className="w-full h-full object-cover rounded-lg" />
                        <button type="button" onClick={() => removeImage(idx)}
                          className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="aspect-square border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-500 transition-colors">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

                <div className="flex justify-between items-center pt-1">
                  <button type="button" onClick={() => setMode('choose')}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
                    Back
                  </button>
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing || images.length === 0}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {analyzing ? (
                      <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg> Starting...</>
                    ) : (
                      <><Zap className="w-4 h-4" /> Analyze {images.length > 0 ? `${images.length} Photo${images.length !== 1 ? 's' : ''}` : 'Photos'}</>
                    )}
                  </button>
                </div>
              </>
            )}

            {/* Analyzing step */}
            {aiStep === 'analyzing' && (
              <div className="py-10 flex flex-col items-center gap-4">
                <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
                  <svg className="animate-spin w-7 h-7 text-blue-600" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-800">Analyzing your photos…</p>
                  <p className="text-xs text-gray-500 mt-1">AI is identifying issues. This usually takes 10–30 seconds.</p>
                </div>
              </div>
            )}

            {/* AI form step — pre-filled, editable */}
            {aiStep === 'form' && (
              <form onSubmit={submitAi} className="space-y-4">
                {/* AI badge */}
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5">
                  <Sparkles className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-emerald-700">Form pre-filled by AI</p>
                    <p className="text-[11px] text-emerald-600">Review and edit the details below before submitting.</p>
                  </div>
                  <button type="button" onClick={() => { setAiEdited(aiSuggestion); }}
                    title="Reset to AI suggestion"
                    className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-500">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Issue Title *</label>
                  <input
                    type="text"
                    value={aiEdited.title}
                    onChange={e => setAiEdited(p => ({ ...p, title: e.target.value }))}
                    className={ic}
                    placeholder="What is the issue?"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={aiEdited.priority}
                    onChange={e => setAiEdited(p => ({ ...p, priority: e.target.value }))}
                    className={ic}
                  >
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
                  <textarea
                    value={aiEdited.description}
                    onChange={e => setAiEdited(p => ({ ...p, description: e.target.value }))}
                    rows={5}
                    className={ic + ' resize-none'}
                    placeholder="Describe the issue..."
                  />
                </div>

                {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

                <div className="flex justify-between items-center pt-1">
                  <button type="button" onClick={() => { setAiStep('upload'); setInspectionId(null); }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
                    Re-upload
                  </button>
                  <button type="submit" disabled={submitMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60">
                    {submitMutation.isPending ? 'Submitting…' : <><Plus className="w-4 h-4" /> Submit Request</>}
                  </button>
                </div>
              </form>
            )}

            {/* No meaningful findings — let user fill in manually with inspection linked */}
            {aiStep === 'no-findings' && (
              <form onSubmit={submitAi} className="space-y-4">
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-700">AI couldn't identify specific issues</p>
                    <p className="text-[11px] text-amber-600 mt-0.5">
                      The photos were saved but no clear issues were detected. Please describe the problem yourself — your photos will still be attached to the request.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Issue Title *</label>
                  <input
                    type="text"
                    value={aiEdited.title}
                    onChange={e => setAiEdited(p => ({ ...p, title: e.target.value }))}
                    placeholder="e.g. Leaking tap in bathroom"
                    className={ic}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={aiEdited.priority}
                    onChange={e => setAiEdited(p => ({ ...p, priority: e.target.value }))}
                    className={ic}
                  >
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
                  <textarea
                    value={aiEdited.description}
                    onChange={e => setAiEdited(p => ({ ...p, description: e.target.value }))}
                    rows={4}
                    placeholder="Describe the issue in detail — where it is, how long it's been happening, how severe it is..."
                    className={ic + ' resize-none'}
                  />
                </div>

                {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

                <div className="flex justify-between items-center pt-1">
                  <button type="button" onClick={() => { setAiStep('upload'); setInspectionId(null); setImages([]); setPreviews([]); }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
                    Re-upload
                  </button>
                  <button type="submit" disabled={submitMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60">
                    {submitMutation.isPending ? 'Submitting…' : <><Plus className="w-4 h-4" /> Submit Request</>}
                  </button>
                </div>
              </form>
            )}

            {/* Failed step */}
            {aiStep === 'failed' && (
              <div className="space-y-4">
                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
                  AI analysis failed. You can try again or switch to manual entry.
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setAiStep('upload'); setInspectionId(null); setImages([]); setPreviews([]); }}
                    className="flex-1 py-2 text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 rounded-lg">
                    Try Again
                  </button>
                  <button onClick={() => setMode('manual')}
                    className="flex-1 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg">
                    Manual Entry
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MANUAL mode ──────────────────────────────────────────────── */}
        {mode === 'manual' && (
          <form onSubmit={submitManual} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Issue Title *</label>
              <input
                type="text"
                value={manualForm.title}
                onChange={e => setManualForm(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Leaking tap in bathroom"
                className={ic}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
              <select
                value={manualForm.priority}
                onChange={e => setManualForm(p => ({ ...p, priority: e.target.value }))}
                className={ic}
              >
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
              <textarea
                value={manualForm.description}
                onChange={e => setManualForm(p => ({ ...p, description: e.target.value }))}
                rows={4}
                placeholder="Describe the issue in detail — where it is, how long it's been happening, how severe it is..."
                className={ic + ' resize-none'}
              />
            </div>

            {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

            <div className="flex justify-between items-center pt-1">
              <button type="button" onClick={() => setMode('choose')}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
                Back
              </button>
              <button type="submit" disabled={submitMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60">
                {submitMutation.isPending ? 'Submitting…' : <><Plus className="w-4 h-4" /> Submit Request</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function TenantMaintenance() {
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ assignment: { unit_id: number } | null; work_orders: WorkOrderItem[] }>({
    queryKey: ['tenant-my-info'],
    queryFn: async () => { const r = await tenantApi.myInfo(); return r.data; },
    staleTime: 30 * 1000,
  });

  const allOrders = data?.work_orders ?? [];
  const unitId = data?.assignment?.unit_id;

  const filtered = filter === 'all' ? allOrders
    : filter === 'open' ? allOrders.filter(w => !['completed', 'rejected'].includes(w.status))
    : allOrders.filter(w => w.status === filter);

  const counts = {
    all: allOrders.length,
    open: allOrders.filter(w => !['completed', 'rejected'].includes(w.status)).length,
    completed: allOrders.filter(w => w.status === 'completed').length,
  };

  return (
    <div className="space-y-5">
      {showModal && <SubmitModal unitId={unitId} onClose={() => setShowModal(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Maintenance Requests</h1>
          <p className="text-sm text-gray-500 mt-0.5">{counts.open} open · {counts.completed} completed</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New Request
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-white rounded-xl shadow-sm border border-gray-100 p-1.5">
        {[
          { key: 'all', label: `All (${counts.all})` },
          { key: 'open', label: `Open (${counts.open})` },
          { key: 'completed', label: `Completed (${counts.completed})` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              filter === key ? 'bg-slate-900 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Wrench className="w-8 h-8 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">No requests found</p>
            <button onClick={() => setShowModal(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700">
              <Plus className="w-3.5 h-3.5" /> Submit one now
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(wo => (
              <div key={wo.id}>
                <button
                  onClick={() => setExpanded(expanded === wo.id ? null : wo.id)}
                  className="w-full px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex-shrink-0">{statusIcon(wo.status)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{wo.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatRelativeTime(wo.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge label={wo.priority} variant={getStatusVariant(wo.priority)} size="sm" />
                    <Badge label={capitalizeFirst(wo.status.replace(/_/g, ' '))} variant={getStatusVariant(wo.status)} size="sm" />
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded === wo.id ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {expanded === wo.id && (
                  <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
                    <p className="text-sm text-gray-700 mt-3 leading-relaxed">{wo.description || 'No description provided.'}</p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                      <span>Submitted: {formatDate(wo.created_at)}</span>
                      <span>Updated: {formatDate(wo.updated_at)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
