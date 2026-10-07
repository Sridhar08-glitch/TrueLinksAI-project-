import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Calendar, FileText, Home, Search as SearchIcon, Wrench, X } from 'lucide-react';
import { unitsApi } from '../lib/api';
import type { Building, Inspection, Lease, Unit, WorkOrder } from '../types';
import { capitalizeFirst, formatCurrency, formatDate } from '../lib/utils';
import { Badge, getStatusVariant } from './ui/Badge';
import { QueryError } from './ui/QueryError';

// Matches GET /api/v1/units/{id}/overview/ (UnitViewSet.overview).
// Note: the detail serializer nests the full building object.
interface UnitOverview {
  unit: Omit<Unit, 'building'> & { building?: Building | null };
  active_lease: Lease | null;
  pending_leases: Lease[];
  recent_inspections: Inspection[];
  work_orders: WorkOrder[];
}

const UNIT_TYPE_LABELS: Record<string, string> = {
  studio: 'Studio', '1br': '1 Bedroom', '2br': '2 Bedrooms',
  '3br': '3 Bedrooms', '4br': '4 Bedrooms', commercial: 'Commercial', penthouse: 'Penthouse',
};

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
      {icon}{label}
    </h3>
  );
}

function DrawerSkeleton() {
  return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="h-5 w-40 bg-gray-200 rounded" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl" />)}
      </div>
      <div className="h-28 bg-gray-100 rounded-xl" />
      <div className="h-20 bg-gray-100 rounded-xl" />
      <div className="h-20 bg-gray-100 rounded-xl" />
    </div>
  );
}

export function UnitOverviewDrawer({ unitId, onClose }: { unitId: number; onClose: () => void }) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, refetch } = useQuery<UnitOverview>({
    queryKey: ['unit-overview', unitId],
    queryFn: async () => (await unitsApi.overview(unitId)).data,
    staleTime: 30 * 1000,
  });

  // Escape to close + basic focus handling
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const unit = data?.unit;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Unit overview">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute right-0 top-0 h-full w-full max-w-[480px] bg-white shadow-2xl flex flex-col focus:outline-none"
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Home className="w-5 h-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 truncate">{unit?.label ?? 'Unit Overview'}</h2>
              <p className="text-xs text-gray-500 truncate">
                {unit ? [unit.building?.name, unit.property_name].filter(Boolean).join(' · ') || 'Unit overview' : 'Loading...'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 flex-shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto">
          {isError ? (
            <QueryError label="unit overview" onRetry={() => refetch()} />
          ) : isLoading || !data || !unit ? (
            <DrawerSkeleton />
          ) : (
            <div className="p-6 space-y-6">
              {/* Unit summary */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionHeading icon={<Home className="w-3.5 h-3.5" />} label="Unit Summary" />
                  <Badge label={unit.occupancy_status} variant={getStatusVariant(unit.occupancy_status)} dot />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Type', value: UNIT_TYPE_LABELS[unit.unit_type] ?? capitalizeFirst(unit.unit_type) },
                    { label: 'Beds / Baths', value: `${unit.bedrooms ?? '—'} / ${unit.bathrooms ?? '—'}` },
                    { label: 'Area', value: unit.area_sqm ? `${unit.area_sqm} m²` : '—' },
                    { label: 'Floor', value: unit.floor_number != null ? `Floor ${unit.floor_number}` : '—' },
                    { label: 'Parking', value: unit.parking_bay || '—' },
                    { label: 'Building', value: unit.building?.name ?? '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-50 rounded-xl p-3">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{value}</p>
                    </div>
                  ))}
                </div>
                {unit.property_name && (
                  <p className="text-xs text-gray-500">
                    <span className="font-medium text-gray-600">Property:</span> {unit.property_name}
                  </p>
                )}
              </section>

              {/* Active lease */}
              <section className="space-y-3">
                <SectionHeading icon={<FileText className="w-3.5 h-3.5" />} label="Active Lease" />
                {data.active_lease ? (
                  <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {data.active_lease.tenant_name || 'Unknown tenant'}
                      </p>
                      <Badge
                        label={data.active_lease.approval_status.replace(/_/g, ' ')}
                        variant={getStatusVariant(data.active_lease.approval_status)}
                        dot
                      />
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Calendar className="w-3.5 h-3.5" />
                      {data.active_lease.start_date ? formatDate(data.active_lease.start_date) : '—'}
                      {' → '}
                      {data.active_lease.end_date ? formatDate(data.active_lease.end_date) : '—'}
                    </div>
                    <p className="text-sm text-slate-800">
                      <span className="font-bold">{formatCurrency(data.active_lease.rent_amount, data.active_lease.currency)}</span>
                      {data.active_lease.rent_frequency && (
                        <span className="text-xs text-gray-500"> / {data.active_lease.rent_frequency}</span>
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-4 text-center">
                    <p className="text-sm text-gray-400">No active lease</p>
                  </div>
                )}
              </section>

              {/* Recent inspections */}
              <section className="space-y-3">
                <SectionHeading icon={<SearchIcon className="w-3.5 h-3.5" />} label="Recent Inspections" />
                {data.recent_inspections.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No inspections yet</p>
                ) : (
                  <div className="space-y-2">
                    {data.recent_inspections.map(insp => (
                      <div key={insp.id} className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">Inspection #{insp.id}</p>
                          <p className="text-xs text-gray-500">
                            {formatDate(insp.created_at)}
                            {insp.findings ? ` · ${insp.findings.length} finding${insp.findings.length === 1 ? '' : 's'}` : ''}
                          </p>
                        </div>
                        <Badge label={insp.status} variant={getStatusVariant(insp.status)} dot />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Work orders */}
              <section className="space-y-3">
                <SectionHeading icon={<Wrench className="w-3.5 h-3.5" />} label="Work Orders" />
                {data.work_orders.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No work orders yet</p>
                ) : (
                  <div className="space-y-2">
                    {data.work_orders.map(wo => (
                      <button
                        key={wo.id}
                        onClick={() => navigate('/work-orders')}
                        className="w-full flex items-center justify-between gap-3 bg-gray-50 hover:bg-blue-50 rounded-xl px-3 py-2.5 text-left transition-colors group"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate group-hover:text-blue-700">{wo.title}</p>
                          <p className="text-xs text-gray-500">{capitalizeFirst(wo.priority)} priority</p>
                        </div>
                        <Badge label={wo.status.replace(/_/g, ' ')} variant={getStatusVariant(wo.status)} dot />
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
