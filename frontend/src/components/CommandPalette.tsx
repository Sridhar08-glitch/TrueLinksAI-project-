import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Building2, Home, Users, FileText, ClipboardList, ClipboardCheck, CornerDownLeft,
} from 'lucide-react';
import {
  propertiesApi, unitsApi, tenantsApi, leasesApi, workOrdersApi, inspectionsApi,
} from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useDebounce } from '../lib/useDebounce';
import { cn } from '../lib/utils';
import type {
  Property, Unit, Tenant, Lease, WorkOrder, Inspection, PaginatedResponse,
} from '../types';

interface PaletteItem {
  key: string;
  group: string;
  label: string;
  sub?: string;
  route: string;
}

const GROUP_ICONS: Record<string, React.ReactNode> = {
  Properties: <Building2 className="w-3.5 h-3.5" />,
  Units: <Home className="w-3.5 h-3.5" />,
  Tenants: <Users className="w-3.5 h-3.5" />,
  Leases: <FileText className="w-3.5 h-3.5" />,
  'Work Orders': <ClipboardList className="w-3.5 h-3.5" />,
  Inspections: <ClipboardCheck className="w-3.5 h-3.5" />,
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isMaintenance = role === 'maintenance_staff';

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const debounced = useDebounce(query.trim(), 250);
  const enabled = open && debounced.length >= 2;

  // Reset state each time the palette opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // focus after mount
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const params = { search: debounced, limit: 5 };

  const propertiesQ = useQuery<PaginatedResponse<Property>>({
    queryKey: ['palette-properties', debounced],
    queryFn: async () => (await propertiesApi.getAll(params)).data,
    enabled: enabled && !isMaintenance,
    staleTime: 30 * 1000,
  });
  const unitsQ = useQuery<PaginatedResponse<Unit>>({
    queryKey: ['palette-units', debounced],
    queryFn: async () => (await unitsApi.getAll(params)).data,
    enabled,
    staleTime: 30 * 1000,
  });
  const tenantsQ = useQuery<PaginatedResponse<Tenant>>({
    queryKey: ['palette-tenants', debounced],
    queryFn: async () => (await tenantsApi.getAll(params)).data,
    enabled: enabled && !isMaintenance,
    staleTime: 30 * 1000,
  });
  const leasesQ = useQuery<PaginatedResponse<Lease>>({
    queryKey: ['palette-leases', debounced],
    queryFn: async () => (await leasesApi.getAll(params)).data,
    enabled: enabled && !isMaintenance,
    staleTime: 30 * 1000,
  });
  const workOrdersQ = useQuery<PaginatedResponse<WorkOrder>>({
    queryKey: ['palette-work-orders', debounced],
    queryFn: async () => (await workOrdersApi.getAll(params)).data,
    enabled,
    staleTime: 30 * 1000,
  });
  const inspectionsQ = useQuery<PaginatedResponse<Inspection>>({
    queryKey: ['palette-inspections', debounced],
    queryFn: async () => (await inspectionsApi.getAll(params)).data,
    enabled: enabled && isMaintenance,
    staleTime: 30 * 1000,
  });

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    if (!enabled) return out;
    (propertiesQ.data?.results ?? []).forEach(p => out.push({
      key: `property-${p.id}`, group: 'Properties',
      label: p.name, sub: p.location, route: '/properties',
    }));
    (unitsQ.data?.results ?? []).forEach(u => out.push({
      key: `unit-${u.id}`, group: 'Units',
      label: u.label, sub: [u.building_name, u.property_name].filter(Boolean).join(' · ') || undefined, route: '/units',
    }));
    (tenantsQ.data?.results ?? []).forEach(t => out.push({
      key: `tenant-${t.id}`, group: 'Tenants',
      label: `${t.first_name} ${t.last_name}`.trim() || t.email, sub: t.email, route: '/tenants',
    }));
    (leasesQ.data?.results ?? []).forEach(l => out.push({
      key: `lease-${l.id}`, group: 'Leases',
      label: l.tenant_name || `Lease #${l.id}`, sub: l.unit_label || undefined, route: '/leases',
    }));
    (workOrdersQ.data?.results ?? []).forEach(w => out.push({
      key: `wo-${w.id}`, group: 'Work Orders',
      label: w.title, sub: w.unit_label || `Unit ${w.unit}`, route: '/work-orders',
    }));
    (inspectionsQ.data?.results ?? []).forEach(i => out.push({
      key: `insp-${i.id}`, group: 'Inspections',
      label: `Inspection #${i.id}`, sub: i.unit_label || `Unit ${i.unit}`, route: '/inspections',
    }));
    return out;
  }, [enabled, propertiesQ.data, unitsQ.data, tenantsQ.data, leasesQ.data, workOrdersQ.data, inspectionsQ.data]);

  const isSearching = enabled && [propertiesQ, unitsQ, tenantsQ, leasesQ, workOrdersQ, inspectionsQ]
    .some(q => q.isFetching);

  // Keep the active index valid as results change
  useEffect(() => {
    setActiveIndex(i => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  const select = useCallback((item: PaletteItem) => {
    onClose();
    navigate(item.route);
  }, [navigate, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) select(item);
    }
  };

  // Keep the active row visible
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  // Build grouped render structure preserving item order
  const groups: { name: string; items: { item: PaletteItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push({ item, index });
    else groups.push({ name: item.group, items: [{ item, index }] });
  });

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-[12vh]" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
            placeholder={isMaintenance ? 'Search units, work orders, inspections…' : 'Search properties, units, tenants, leases, work orders…'}
            className="flex-1 text-sm text-slate-900 placeholder-gray-400 focus:outline-none bg-transparent"
          />
          {isSearching && (
            <svg className="animate-spin w-4 h-4 text-blue-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          <kbd className="text-[10px] font-semibold text-gray-400 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 flex-shrink-0">Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {!enabled ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              Type at least 2 characters to search.
            </p>
          ) : items.length === 0 && !isSearching ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              No results for "{debounced}".
            </p>
          ) : (
            <div className="py-2">
              {groups.map(group => (
                <div key={group.name}>
                  <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                    {GROUP_ICONS[group.name]}
                    {group.name}
                  </p>
                  {group.items.map(({ item, index }) => (
                    <button
                      key={item.key}
                      data-active={index === activeIndex}
                      onClick={() => select(item)}
                      onMouseMove={() => setActiveIndex(index)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                        index === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                      )}
                    >
                      <span className="flex-1 min-w-0">
                        <span className={cn('block text-sm truncate', index === activeIndex ? 'text-blue-800 font-medium' : 'text-slate-800')}>
                          {item.label}
                        </span>
                        {item.sub && <span className="block text-xs text-gray-400 truncate">{item.sub}</span>}
                      </span>
                      {index === activeIndex && (
                        <CornerDownLeft className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-3 text-[10px] text-gray-400">
          <span><kbd className="font-semibold">↑↓</kbd> navigate</span>
          <span><kbd className="font-semibold">Enter</kbd> open</span>
          <span><kbd className="font-semibold">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
