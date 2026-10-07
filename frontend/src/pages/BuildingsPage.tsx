import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building, Plus, Search, X, Pencil, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import { buildingsApi, propertiesApi } from '../lib/api';
import type { Building as BuildingType, Property } from '../types';
import { formatDate, extractApiError } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { useToast } from '../components/ui/Toast';
import { useDebounce } from '../lib/useDebounce';

// ── Shared field hook ──────────────────────────────────────────────────────
function useField<T extends Record<string, string>>(
  state: T,
  setState: React.Dispatch<React.SetStateAction<T>>,
) {
  return (key: keyof T) => ({
    value: state[key] as string,
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setState(s => ({ ...s, [key]: ev.target.value })),
  });
}

function ic(err?: string) {
  return `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${err ? 'border-red-300' : 'border-gray-200'}`;
}

// ── Confirm Delete Dialog ──────────────────────────────────────────────────
function ConfirmDeleteDialog({
  name, onCancel, onConfirm, isPending,
}: { name: string; onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Delete Building</h3>
            <p className="text-sm text-gray-500 mt-0.5">This action cannot be undone.</p>
          </div>
        </div>
        <p className="text-sm text-gray-700">
          Are you sure you want to delete <span className="font-semibold text-slate-900">"{name}"</span>?
          All associated units may also be affected.
        </p>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={isPending}
            className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-60">
            {isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Building Form Modal (Add + Edit) ───────────────────────────────────────
function BuildingFormModal({
  onClose, onSuccess, existing,
}: {
  onClose: () => void;
  onSuccess: () => void;
  existing?: BuildingType;
}) {
  const isEdit = !!existing;
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    property: existing?.property ? String(existing.property) : '',
    floors: existing?.floors ? String(existing.floors) : '1',
    address: existing?.address ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const field = useField(form, setForm);

  const { data: propsData } = useQuery<{ results: Property[] }>({
    queryKey: ['properties-list'],
    queryFn: async () => (await propertiesApi.getAll({ limit: 100 })).data,
    staleTime: 5 * 60 * 1000,
  });
  const properties = propsData?.results ?? [];

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      isEdit ? buildingsApi.update(existing!.id, data) : buildingsApi.create(data),
    onSuccess: () => { onSuccess(); setSaved(true); setTimeout(onClose, 600); },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.property) e.property = 'Select a property';
    if (!form.floors || Number(form.floors) < 1) e.floors = 'Must be at least 1';
    setErrors(e);
    return !Object.keys(e).length;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{isEdit ? 'Edit Building' : 'Add Building'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{isEdit ? `Editing: ${existing!.name}` : 'Create a new building'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (validate()) mutation.mutate({ name: form.name, property: Number(form.property), floors: Number(form.floors), address: form.address || undefined }); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Building Name *</label>
            <input type="text" {...field('name')} placeholder="e.g. Block A" className={ic(errors.name)} />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Property *</label>
            <select {...field('property')} className={ic(errors.property)}>
              <option value="">— Select property —</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {errors.property && <p className="text-xs text-red-600 mt-1">{errors.property}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Floors *</label>
              <input type="number" min="1" {...field('floors')} className={ic(errors.floors)} />
              {errors.floors && <p className="text-xs text-red-600 mt-1">{errors.floors}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Address (optional)</label>
              <input type="text" {...field('address')} placeholder="Building address" className={ic()} />
            </div>
          </div>
          {mutation.isError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Failed. Please try again.</p>}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={mutation.isPending || saved}
              className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
              {saved ? <><CheckCircle className="w-4 h-4" /> Saved!</> : mutation.isPending ? 'Saving...' : isEdit ? <><Pencil className="w-4 h-4" /> Save Changes</> : <><Plus className="w-4 h-4" /> Add Building</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Building Detail Modal ──────────────────────────────────────────────────
function BuildingDetailModal({
  building, onClose, onEdit, onDelete,
}: { building: BuildingType; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500'];
  const color = colors[building.id % colors.length];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center`}>
              <Building className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{building.name}</h2>
              <p className="text-xs text-gray-500">{building.property_name ?? `Property #${building.property}`}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-2 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>
            <button onClick={onDelete} className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{building.floors}</p>
              <p className="text-xs text-gray-500 mt-1">Floors</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{building.units_count}</p>
              <p className="text-xs text-gray-500 mt-1">Units</p>
            </div>
          </div>
          {building.address && (
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <span className="font-medium text-gray-700 flex-shrink-0">Address:</span>
              <span>{building.address}</span>
            </div>
          )}
          <p className="text-xs text-gray-400">Added {formatDate(building.created_at ?? '')}</p>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function BuildingsPage() {
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType | null>(null);
  const [editingBuilding, setEditingBuilding] = useState<BuildingType | null>(null);
  const [deletingBuilding, setDeletingBuilding] = useState<BuildingType | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, refetch } = useQuery<{ results: BuildingType[]; count: number }>({
    queryKey: ['buildings', { search: debouncedSearch }],
    queryFn: async () => (await buildingsApi.getAll({ search: debouncedSearch || undefined, limit: 50 })).data,
    staleTime: 60 * 1000,
  });

  const buildings = data?.results ?? [];
  const total = data?.count ?? 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['buildings'] });
    queryClient.invalidateQueries({ queryKey: ['buildings-list'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => buildingsApi.delete(id),
    onSuccess: () => { toast('Building deleted'); setDeletingBuilding(null); setSelectedBuilding(null); refresh(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to delete building. It may still contain units.'), 'error'),
  });

  return (
    <div className="space-y-5">
      {showAddModal && <BuildingFormModal onClose={() => setShowAddModal(false)} onSuccess={refresh} />}
      {editingBuilding && (
        <BuildingFormModal existing={editingBuilding} onClose={() => setEditingBuilding(null)} onSuccess={() => { refresh(); setSelectedBuilding(null); }} />
      )}
      {deletingBuilding && (
        <ConfirmDeleteDialog
          name={deletingBuilding.name}
          isPending={deleteMutation.isPending}
          onCancel={() => setDeletingBuilding(null)}
          onConfirm={() => deleteMutation.mutate(deletingBuilding.id)}
        />
      )}
      {selectedBuilding && !editingBuilding && !deletingBuilding && (
        <BuildingDetailModal
          building={selectedBuilding}
          onClose={() => setSelectedBuilding(null)}
          onEdit={() => { setEditingBuilding(selectedBuilding); setSelectedBuilding(null); }}
          onDelete={() => setDeletingBuilding(selectedBuilding)}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Buildings</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} buildings total</p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowAddModal(true)}>Add Building</Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search buildings..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isError ? (
          <QueryError label="buildings" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading buildings...</div>
        ) : buildings.length === 0 ? (
          <EmptyState icon={<Building className="w-8 h-8" />} title="No buildings found"
            description="Add a building to your properties."
            action={{ label: 'Add Building', onClick: () => setShowAddModal(true), icon: <Plus className="w-4 h-4" /> }} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
            {buildings.map((building, index) => {
              const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500'];
              const color = colors[index % colors.length];
              return (
                <div key={building.id} className="bg-gray-50 rounded-xl p-4 border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div onClick={() => setSelectedBuilding(building)} className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center flex-shrink-0 cursor-pointer`}>
                      <Building className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedBuilding(building)}>
                      <h3 className="text-sm font-semibold text-slate-900 truncate">{building.name}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{building.property_name ?? `Property #${building.property}`}</p>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={() => setEditingBuilding(building)}
                        className="p-1.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeletingBuilding(building)}
                        className="p-1.5 hover:bg-red-100 text-gray-400 hover:text-red-600 rounded-lg transition-colors" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-4" onClick={() => setSelectedBuilding(building)} style={{ cursor: 'pointer' }}>
                    <div className="bg-white rounded-lg p-2.5 text-center">
                      <p className="text-base font-bold text-slate-900">{building.floors}</p>
                      <p className="text-[10px] text-gray-500">Floors</p>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 text-center">
                      <p className="text-base font-bold text-slate-900">{building.units_count}</p>
                      <p className="text-[10px] text-gray-500">Units</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
