import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Home, Plus, Search, ChevronLeft, ChevronRight, X, Pencil, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import { unitsApi, buildingsApi } from '../lib/api';
import type { Unit, Building } from '../types';
import { capitalizeFirst } from '../lib/utils';
import { UnitOverviewDrawer } from '../components/UnitOverviewDrawer';
import { Badge, getStatusVariant } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { useDebounce } from '../lib/useDebounce';

const UNIT_TYPE_LABELS: Record<string, string> = {
  studio: 'Studio', '1br': '1 Bedroom', '2br': '2 Bedrooms',
  '3br': '3 Bedrooms', '4br': '4 Bedrooms', commercial: 'Commercial', penthouse: 'Penthouse',
};

const STATUS_COLORS: Record<string, string> = {
  available: 'text-emerald-700 bg-emerald-50',
  occupied: 'text-blue-700 bg-blue-50',
  maintenance: 'text-orange-700 bg-orange-50',
  archived: 'text-gray-600 bg-gray-100',
};

function ic(err?: string) {
  return `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${err ? 'border-red-300' : 'border-gray-200'}`;
}

// ── Confirm Delete Dialog ──────────────────────────────────────────────────
function ConfirmDeleteDialog({
  name, onCancel, onConfirm, isPending, errorMsg,
}: { name: string; onCancel: () => void; onConfirm: () => void; isPending: boolean; errorMsg?: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Delete Unit</h3>
            <p className="text-sm text-gray-500 mt-0.5">This action cannot be undone.</p>
          </div>
        </div>
        <p className="text-sm text-gray-700">
          Are you sure you want to delete unit <span className="font-semibold text-slate-900">"{name}"</span>?
        </p>
        {errorMsg && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errorMsg}</p>}
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

// ── Unit Form Modal (Add + Edit) ───────────────────────────────────────────
function UnitFormModal({
  onClose, onSuccess, existing,
}: {
  onClose: () => void;
  onSuccess: () => void;
  existing?: Unit;
}) {
  const isEdit = !!existing;
  const [form, setForm] = useState({
    label: existing?.label ?? '',
    building: existing?.building ? String(existing.building) : '',
    unit_type: existing?.unit_type ?? '1br',
    occupancy_status: existing?.occupancy_status ?? 'available',
    floor_number: existing?.floor_number != null ? String(existing.floor_number) : '',
    area_sqm: existing?.area_sqm != null ? String(existing.area_sqm) : '',
    bedrooms: existing?.bedrooms != null ? String(existing.bedrooms) : '',
    bathrooms: existing?.bathrooms != null ? String(existing.bathrooms) : '',
    parking_bay: existing?.parking_bay ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const { data: buildingsData } = useQuery<{ results: Building[] }>({
    queryKey: ['buildings-list'],
    queryFn: async () => (await buildingsApi.getAll({ limit: 100 })).data,
    staleTime: 5 * 60 * 1000,
  });
  const buildings = buildingsData?.results ?? [];

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      isEdit ? unitsApi.update(existing!.id, data) : unitsApi.create(data),
    onSuccess: () => { onSuccess(); setSaved(true); setTimeout(onClose, 600); },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.label.trim()) e.label = 'Required';
    if (!form.building) e.building = 'Select a building';
    if (!form.area_sqm || Number(form.area_sqm) <= 0) e.area_sqm = 'Enter a valid area';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const field = (key: string) => ({
    value: form[key as keyof typeof form],
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: ev.target.value })),
  });

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    mutation.mutate({
      label: form.label,
      building: Number(form.building),
      unit_type: form.unit_type,
      occupancy_status: form.occupancy_status,
      floor_number: form.floor_number ? Number(form.floor_number) : undefined,
      area_sqm: Number(form.area_sqm),
      bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
      bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
      parking_bay: form.parking_bay || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{isEdit ? 'Edit Unit' : 'Add Unit'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{isEdit ? `Editing: ${existing!.label}` : 'Create a new unit'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit Label *</label>
              <input type="text" {...field('label')} placeholder="e.g. Unit 101" className={ic(errors.label)} />
              {errors.label && <p className="text-xs text-red-600 mt-1">{errors.label}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Floor</label>
              <input type="number" min="1" {...field('floor_number')} placeholder="1" className={ic()} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Parking Bay</label>
            <input type="text" {...field('parking_bay')} placeholder="e.g. P-12, B2-05 (leave blank if none)" className={ic()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Building *</label>
            <select {...field('building')} className={ic(errors.building)}>
              <option value="">— Select building —</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {errors.building && <p className="text-xs text-red-600 mt-1">{errors.building}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit Type</label>
              <select {...field('unit_type')} className={ic()}>
                {Object.entries(UNIT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select {...field('occupancy_status')} className={ic()}>
                <option value="available">Available</option>
                <option value="occupied">Occupied</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Area (m²) *</label>
              <input type="number" min="0" step="0.01" {...field('area_sqm')} placeholder="75" className={ic(errors.area_sqm)} />
              {errors.area_sqm && <p className="text-xs text-red-600 mt-1">{errors.area_sqm}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Bedrooms</label>
              <input type="number" min="0" {...field('bedrooms')} placeholder="1" className={ic()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Bathrooms</label>
              <input type="number" min="0" step="0.5" {...field('bathrooms')} placeholder="1" className={ic()} />
            </div>
          </div>
          {mutation.isError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Failed. Please try again.</p>}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={mutation.isPending || saved}
              className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
              {saved ? <><CheckCircle className="w-4 h-4" /> Saved!</> : mutation.isPending ? 'Saving...' : isEdit ? <><Pencil className="w-4 h-4" /> Save Changes</> : <><Plus className="w-4 h-4" /> Add Unit</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function UnitsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [buildingFilter, setBuildingFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [deletingUnit, setDeletingUnit] = useState<Unit | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const queryClient = useQueryClient();
  const debouncedSearch = useDebounce(search, 300);
  const pageSize = 15;

  const { data: buildingsData } = useQuery<{ results: Building[] }>({
    queryKey: ['buildings-list'],
    queryFn: async () => (await buildingsApi.getAll({ limit: 100 })).data,
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, isError, refetch } = useQuery<{ results: Unit[]; count: number }>({
    queryKey: ['units', { search: debouncedSearch, status: statusFilter, building: buildingFilter, page }],
    queryFn: async () => (await unitsApi.getAll({
      search: debouncedSearch || undefined,
      occupancy_status: statusFilter || undefined,
      building: buildingFilter || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    })).data,
    staleTime: 60 * 1000,
  });

  const units = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const buildings = buildingsData?.results ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['units'] });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => unitsApi.delete(id),
    onSuccess: () => { setDeletingUnit(null); setSelectedUnit(null); setDeleteError(''); refresh(); },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setDeleteError(detail ?? 'Failed to delete unit. It may have active leases or work orders.');
    },
  });

  return (
    <div className="space-y-5">
      {showAddModal && <UnitFormModal onClose={() => setShowAddModal(false)} onSuccess={refresh} />}
      {editingUnit && (
        <UnitFormModal existing={editingUnit} onClose={() => setEditingUnit(null)} onSuccess={() => { refresh(); setSelectedUnit(null); }} />
      )}
      {deletingUnit && (
        <ConfirmDeleteDialog
          name={deletingUnit.label}
          isPending={deleteMutation.isPending}
          errorMsg={deleteError}
          onCancel={() => { setDeletingUnit(null); setDeleteError(''); }}
          onConfirm={() => deleteMutation.mutate(deletingUnit.id)}
        />
      )}
      {selectedUnit && !editingUnit && !deletingUnit && (
        <UnitOverviewDrawer unitId={selectedUnit.id} onClose={() => setSelectedUnit(null)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Units</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} units total</p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowAddModal(true)}>Add Unit</Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search units..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700">
          <option value="">All Status</option>
          <option value="available">Available</option>
          <option value="occupied">Occupied</option>
          <option value="maintenance">Maintenance</option>
        </select>
        <select value={buildingFilter} onChange={e => { setBuildingFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700">
          <option value="">All Buildings</option>
          {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isError ? (
          <QueryError label="units" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 text-center">
            <div className="inline-flex items-center gap-2 text-sm text-gray-500">
              <svg className="animate-spin w-4 h-4 text-blue-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading units...
            </div>
          </div>
        ) : units.length === 0 ? (
          <EmptyState icon={<Home className="w-8 h-8" />} title="No units found"
            description={search || statusFilter ? 'Try adjusting your filters.' : 'Add your first unit to get started.'}
            action={{ label: 'Add Unit', onClick: () => setShowAddModal(true), icon: <Plus className="w-4 h-4" /> }} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Building</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Floor</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Area</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Parking</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {units.map(unit => (
                    <tr key={unit.id} onClick={() => setSelectedUnit(unit)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${STATUS_COLORS[unit.occupancy_status] ?? 'text-gray-600 bg-gray-50'}`}>
                            <Home className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-sm font-medium text-slate-900">{unit.label}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{unit.building_name ?? `Building #${unit.building}`}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{UNIT_TYPE_LABELS[unit.unit_type] ?? capitalizeFirst(unit.unit_type)}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{unit.floor_number != null ? `Floor ${unit.floor_number}` : '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{unit.area_sqm ? `${unit.area_sqm} m²` : '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{unit.parking_bay || <span className="text-gray-300">—</span>}</td>
                      <td className="px-5 py-3.5">
                        <Badge label={unit.occupancy_status} variant={getStatusVariant(unit.occupancy_status)} dot />
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                          <button onClick={() => setEditingUnit(unit)}
                            className="p-1.5 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => { setDeleteError(''); setDeletingUnit(unit); }}
                            className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total} units
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed text-gray-600">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = Math.max(1, Math.min(page - 2 + i, totalPages - 4 + i));
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors ${page === p ? 'bg-slate-900 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
                        {p}
                      </button>
                    );
                  })}
                  <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed text-gray-600">
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
