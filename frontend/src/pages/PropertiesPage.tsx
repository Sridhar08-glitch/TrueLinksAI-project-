import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Plus, Search, MapPin, Pencil,
  Grid, List, X, CheckCircle,
} from 'lucide-react';
import { propertiesApi } from '../lib/api';
import type { Property } from '../types';
import { formatDate, getOccupancyRate } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { useDebounce } from '../lib/useDebounce';

const PROPERTY_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-cyan-500'];

function getBgGradient(index: number) {
  const g = ['#2563eb,#1d4ed8', '#059669,#047857', '#7c3aed,#6d28d9', '#d97706,#b45309', '#db2777,#be185d', '#0891b2,#0e7490'];
  return g[index % g.length];
}

// ── Add / Edit Property Modal ──────────────────────────────────────────────
function PropertyFormModal({
  onClose, onSuccess, existing,
}: {
  onClose: () => void;
  onSuccess: () => void;
  existing?: Property;
}) {
  const isEdit = !!existing;
  const [form, setForm] = useState({ name: existing?.name ?? '', location: existing?.location ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      isEdit ? propertiesApi.update(existing!.id, data) : propertiesApi.create(data),
    onSuccess: () => { onSuccess(); setSaved(true); setTimeout(onClose, 600); },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.location.trim()) e.location = 'Required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const ic = (k: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${errors[k] ? 'border-red-300' : 'border-gray-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{isEdit ? 'Edit Property' : 'Add Property'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{isEdit ? `Editing: ${existing!.name}` : 'Create a new property'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (validate()) mutation.mutate({ name: form.name, location: form.location }); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Property Name *</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sunset Apartments" className={ic('name')} />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Location / Address *</label>
            <textarea value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              rows={2} placeholder="e.g. Lusail Marina District, Doha" className={ic('location') + ' resize-none'} />
            {errors.location && <p className="text-xs text-red-600 mt-1">{errors.location}</p>}
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {(() => {
                const d = (mutation.error as { response?: { data?: Record<string, unknown> } })?.response?.data;
                if (!d) return 'Failed. Please try again.';
                if (typeof d.detail === 'string') return d.detail;
                const msgs = Object.entries(d).flatMap(([k, v]) => Array.isArray(v) ? v.map((s: unknown) => `${k}: ${s}`) : [`${k}: ${String(v)}`]);
                return msgs.length ? msgs.join('; ') : 'Failed. Please try again.';
              })()}
            </p>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={mutation.isPending || saved}
              className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60 flex items-center gap-2">
              {saved ? <><CheckCircle className="w-4 h-4" /> Saved!</> : mutation.isPending ? 'Saving...' : isEdit ? <><Pencil className="w-4 h-4" /> Save Changes</> : <><Plus className="w-4 h-4" /> Add Property</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Property Detail Modal ──────────────────────────────────────────────────
function PropertyDetailModal({ property, onClose, onEdit }: { property: Property; onClose: () => void; onEdit: () => void }) {
  const occupancyRate = getOccupancyRate(property.occupied_units, property.total_units);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{property.name}</h2>
            {property.ownership_entity && <span className="text-xs text-gray-500">{property.ownership_entity.name}</span>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-2 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit property">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex items-start gap-3">
            <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-gray-700">{property.location}</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-slate-900">{property.total_units}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Total Units</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-emerald-600">{property.occupied_units}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Occupied</p>
            </div>
            <div className="bg-orange-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-orange-500">{property.available_units}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Available</p>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-700">Occupancy Rate</span>
              <span className="text-xs font-bold text-slate-800">{occupancyRate}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full">
              <div className="h-2 bg-blue-500 rounded-full transition-all" style={{ width: `${occupancyRate}%` }} />
            </div>
          </div>
          {property.buildings && property.buildings.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Buildings</p>
              <div className="space-y-1.5">
                {property.buildings.map(b => (
                  <div key={b.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-slate-700">{b.name}</span>
                    <span className="text-xs text-gray-500">{b.unit_count} units</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-gray-400">Added {formatDate(property.created_at)}</p>
        </div>
      </div>
    </div>
  );
}

// ── Property Card ──────────────────────────────────────────────────────────
function PropertyCard({ property, index, onClick, onEdit }: { property: Property; index: number; onClick: () => void; onEdit: () => void }) {
  const occupancyRate = getOccupancyRate(property.occupied_units, property.total_units);
  const color = PROPERTY_COLORS[index % PROPERTY_COLORS.length];
  return (
    <div onClick={onClick} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow cursor-pointer">
      <div className="h-28 relative" style={{ background: `linear-gradient(135deg, ${getBgGradient(index)})` }}>
        <div className="absolute inset-0 flex items-center justify-center opacity-20">
          <Building2 className="w-20 h-20 text-white" />
        </div>
        <div className="absolute top-3 right-3">
          <button onClick={e => { e.stopPropagation(); onEdit(); }}
            className="w-7 h-7 bg-white/20 hover:bg-white/40 rounded-lg flex items-center justify-center text-white transition-colors" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
        {property.buildings && property.buildings.length > 0 && (
          <div className="absolute bottom-3 left-4">
            <span className="text-xs font-medium text-white/90 bg-white/20 px-2 py-0.5 rounded-full">
              {property.buildings.length} building{property.buildings.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 truncate mb-1">{property.name}</h3>
        <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
          <MapPin className="w-3 h-3 flex-shrink-0" /><span className="truncate">{property.location}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center"><p className="text-base font-bold text-slate-900">{property.total_units}</p><p className="text-[10px] text-gray-500">Total</p></div>
          <div className="text-center border-x border-gray-100"><p className="text-base font-bold text-emerald-600">{property.occupied_units}</p><p className="text-[10px] text-gray-500">Occupied</p></div>
          <div className="text-center"><p className="text-base font-bold text-orange-500">{property.available_units}</p><p className="text-[10px] text-gray-500">Available</p></div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">Occupancy</span>
            <span className="text-xs font-semibold text-slate-700">{occupancyRate}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full">
            <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${occupancyRate}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PropertyRow({ property, index, onClick, onEdit }: { property: Property; index: number; onClick: () => void; onEdit: () => void }) {
  const occupancyRate = getOccupancyRate(property.occupied_units, property.total_units);
  const color = PROPERTY_COLORS[index % PROPERTY_COLORS.length];
  return (
    <tr onClick={onClick} className="hover:bg-gray-50 transition-colors cursor-pointer">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center flex-shrink-0`}>
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{property.name}</p>
            <p className="text-xs text-gray-500 truncate">{property.location}</p>
          </div>
        </div>
      </td>
      <td className="px-5 py-3.5 text-sm text-gray-600">{property.ownership_entity?.name ?? '—'}</td>
      <td className="px-5 py-3.5 text-sm text-slate-700 font-medium">{property.total_units}</td>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="w-20 h-1.5 bg-gray-100 rounded-full">
            <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${occupancyRate}%` }} />
          </div>
          <span className="text-xs font-medium text-slate-700">{occupancyRate}%</span>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <button onClick={e => { e.stopPropagation(); onEdit(); }}
          className="p-1.5 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit">
          <Pencil className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function PropertiesPage() {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const queryClient = useQueryClient();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, refetch } = useQuery<{ results: Property[]; count: number }>({
    queryKey: ['properties', { search: debouncedSearch }],
    queryFn: async () => (await propertiesApi.getAll({ search: debouncedSearch || undefined, limit: 50 })).data,
    staleTime: 60 * 1000,
  });

  const properties = data?.results ?? [];
  const total = data?.count ?? 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['properties'] });

  return (
    <div className="space-y-5">
      {showAddModal && <PropertyFormModal onClose={() => setShowAddModal(false)} onSuccess={refresh} />}
      {editingProperty && (
        <PropertyFormModal existing={editingProperty} onClose={() => setEditingProperty(null)} onSuccess={() => { refresh(); setSelectedProperty(null); }} />
      )}
      {selectedProperty && !editingProperty && (
        <PropertyDetailModal
          property={selectedProperty}
          onClose={() => setSelectedProperty(null)}
          onEdit={() => { setEditingProperty(selectedProperty); setSelectedProperty(null); }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Properties</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} properties total</p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowAddModal(true)}>Add Property</Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search properties..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
        </div>
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={() => setViewMode('grid')} className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-slate-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}><Grid className="w-4 h-4" /></button>
          <button onClick={() => setViewMode('list')} className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-slate-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}><List className="w-4 h-4" /></button>
        </div>
      </div>

      {isError ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <QueryError label="properties" onRetry={() => refetch()} />
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : properties.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <EmptyState icon={<Building2 className="w-8 h-8" />} title="No properties found"
            description={search ? 'Try adjusting your search.' : 'Add your first property to get started.'}
            action={{ label: 'Add Property', onClick: () => setShowAddModal(true), icon: <Plus className="w-4 h-4" /> }} />
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {properties.map((p, i) => (
            <PropertyCard key={p.id} property={p} index={i}
              onClick={() => setSelectedProperty(p)}
              onEdit={() => setEditingProperty(p)} />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Property</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Owner</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Units</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Occupancy</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {properties.map((p, i) => (
                <PropertyRow key={p.id} property={p} index={i}
                  onClick={() => setSelectedProperty(p)}
                  onEdit={() => setEditingProperty(p)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-pulse">
      <div className="h-28 bg-gray-200" />
      <div className="p-4 space-y-3"><div className="h-4 bg-gray-200 rounded w-3/4" /><div className="h-3 bg-gray-100 rounded w-1/2" /><div className="h-2 bg-gray-100 rounded" /></div>
    </div>
  );
}
