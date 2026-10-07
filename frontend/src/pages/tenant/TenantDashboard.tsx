import { useQuery } from '@tanstack/react-query';
import {
  Home, Wrench, CalendarDays, Layers, Car, MapPin,
  Clock, CheckCircle, AlertTriangle, Plus, ArrowRight, Building2, Wallet,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tenantApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { formatDate, formatCurrency, capitalizeFirst } from '../../lib/utils';
import { Badge, getStatusVariant } from '../../components/ui/Badge';
import type { TenantPayment } from '../../types';

interface Assignment {
  id: number;
  unit_id: number;
  unit_label: string;
  unit_type: string;
  area_sqm: number | null;
  floor_number: number | null;
  parking_bay: string;
  building_name: string;
  move_in_date: string | null;
}

interface WorkOrderItem {
  id: number;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  description: string;
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/15 backdrop-blur rounded-xl px-4 py-3 text-white">
      <div className="flex items-center gap-2 mb-1 opacity-80">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-base font-bold">{value}</p>
    </div>
  );
}

function statusIcon(s: string) {
  if (s === 'completed') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (s === 'in_progress') return <Clock className="w-4 h-4 text-blue-500" />;
  return <AlertTriangle className="w-4 h-4 text-orange-400" />;
}

export default function TenantDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const firstName = user?.first_name || user?.email?.split('@')[0] || 'Resident';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const { data, isLoading } = useQuery<{ assignment: Assignment | null; work_orders: WorkOrderItem[]; payments?: TenantPayment[] }>({
    queryKey: ['tenant-my-info'],
    queryFn: async () => { const r = await tenantApi.myInfo(); return r.data; },
    staleTime: 60 * 1000,
  });

  const assignment = data?.assignment ?? null;
  const workOrders = data?.work_orders ?? [];
  const openOrders = workOrders.filter(w => !['completed', 'rejected'].includes(w.status));
  const recentOrders = workOrders.slice(0, 5);

  const payments = data?.payments ?? [];
  const nextDue = payments
    .filter(p => p.status !== 'paid')
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;
  const recentPaid = payments
    .filter(p => p.status === 'paid')
    .sort((a, b) => (b.paid_at ?? b.due_date).localeCompare(a.paid_at ?? a.due_date))
    .slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Hero banner */}
      <div
        className="relative rounded-2xl overflow-hidden p-7"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #1e40af 100%)', minHeight: 180 }}
      >
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '50px 50px',
        }} />
        <div className="relative z-10">
          <p className="text-blue-200/70 text-sm mb-1">{greeting} 👋</p>
          <h1 className="text-2xl font-bold text-white mb-4">{firstName}</h1>

          {assignment ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile icon={<Home className="w-3.5 h-3.5" />} label="Your Unit" value={assignment.unit_label} />
              <StatTile icon={<Building2 className="w-3.5 h-3.5" />} label="Building" value={assignment.building_name || '—'} />
              <StatTile icon={<Layers className="w-3.5 h-3.5" />} label="Floor" value={assignment.floor_number ? `Floor ${assignment.floor_number}` : '—'} />
              <StatTile icon={<Wrench className="w-3.5 h-3.5" />} label="Open Requests" value={String(openOrders.length)} />
            </div>
          ) : (
            <p className="text-blue-200/60 text-sm">No unit assigned yet. Contact your property manager.</p>
          )}
        </div>
      </div>

      {/* Unit details + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Unit card */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Home className="w-4 h-4 text-blue-600" /> My Unit
          </h3>
          {isLoading ? (
            <div className="space-y-3 animate-pulse">
              {[1,2,3,4].map(i => <div key={i} className="h-10 bg-gray-100 rounded-lg" />)}
            </div>
          ) : assignment ? (
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: <Home className="w-4 h-4 text-blue-500" />, label: 'Unit', value: assignment.unit_label },
                { icon: <Building2 className="w-4 h-4 text-purple-500" />, label: 'Building', value: assignment.building_name || '—' },
                { icon: <Layers className="w-4 h-4 text-emerald-500" />, label: 'Type', value: capitalizeFirst(assignment.unit_type) },
                { icon: <MapPin className="w-4 h-4 text-orange-500" />, label: 'Floor', value: assignment.floor_number ? `Floor ${assignment.floor_number}` : '—' },
                { icon: <Car className="w-4 h-4 text-indigo-500" />, label: 'Parking', value: assignment.parking_bay || '—' },
                { icon: <CalendarDays className="w-4 h-4 text-pink-500" />, label: 'Move-in', value: assignment.move_in_date ? formatDate(assignment.move_in_date) : '—' },
              ].map(({ icon, label, value }) => (
                <div key={label} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="w-8 h-8 bg-white rounded-lg shadow-sm flex items-center justify-center flex-shrink-0">
                    {icon}
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
                    <p className="text-sm font-semibold text-slate-800">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">
              <Home className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No unit assigned yet
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-slate-900 mb-4">Quick Actions</h3>
          <div className="space-y-2">
            {[
              {
                icon: <Wrench className="w-4 h-4 text-orange-500" />,
                bg: 'bg-orange-50',
                label: 'Submit Maintenance Request',
                onClick: () => navigate('/tenant/maintenance'),
              },
              {
                icon: <CalendarDays className="w-4 h-4 text-blue-500" />,
                bg: 'bg-blue-50',
                label: 'View My Lease',
                onClick: () => navigate('/tenant/documents'),
              },
              {
                icon: <CheckCircle className="w-4 h-4 text-emerald-500" />,
                bg: 'bg-emerald-50',
                label: 'Track Requests',
                onClick: () => navigate('/tenant/maintenance'),
              },
            ].map(({ icon, bg, label, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group"
              >
                <div className={`w-8 h-8 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                  {icon}
                </div>
                <span className="text-sm font-medium text-slate-700 flex-1 text-left">{label}</span>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rent payments */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-emerald-600" /> Rent Payments
        </h3>
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg" />)}
          </div>
        ) : payments.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">
            <Wallet className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No payment schedule yet.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Next due */}
            {nextDue ? (
              <div className={`rounded-xl p-4 border ${
                nextDue.status === 'overdue' ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className={`text-[10px] font-semibold uppercase tracking-wide ${
                      nextDue.status === 'overdue' ? 'text-red-600' : 'text-blue-600'}`}
                    >
                      {nextDue.status === 'overdue' ? 'Overdue' : 'Next payment due'}
                    </p>
                    <p className={`text-2xl font-bold mt-1 ${
                      nextDue.status === 'overdue' ? 'text-red-700' : 'text-slate-900'}`}
                    >
                      {formatCurrency(nextDue.amount, nextDue.currency)}
                    </p>
                    <p className={`text-xs mt-0.5 ${nextDue.status === 'overdue' ? 'text-red-600' : 'text-gray-500'}`}>
                      Due {formatDate(nextDue.due_date)}
                    </p>
                  </div>
                  {nextDue.status === 'overdue' && (
                    <AlertTriangle className="w-8 h-8 text-red-400 flex-shrink-0" />
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl p-4 bg-emerald-50 border border-emerald-100 flex items-center gap-2.5">
                <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                <p className="text-sm text-emerald-700 font-medium">All payments up to date</p>
              </div>
            )}
            {/* Recent paid */}
            {recentPaid.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">Recent payments</p>
                <div className="space-y-1.5">
                  {recentPaid.map(p => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="text-xs text-gray-500 flex-1">{formatDate(p.paid_at ?? p.due_date)}</span>
                      <span className="text-sm font-semibold text-slate-800">{formatCurrency(p.amount, p.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recent maintenance requests */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Recent Maintenance Requests</h3>
          <button
            onClick={() => navigate('/tenant/maintenance')}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
          >
            View all <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="divide-y divide-gray-50">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="p-8 text-center">
              <Wrench className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No maintenance requests yet</p>
              <button
                onClick={() => navigate('/tenant/maintenance')}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="w-3.5 h-3.5" /> Submit a request
              </button>
            </div>
          ) : (
            recentOrders.map(wo => (
              <div key={wo.id} className="px-5 py-3.5 flex items-center gap-4">
                <div className="flex-shrink-0">{statusIcon(wo.status)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{wo.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatDate(wo.created_at)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge label={wo.priority} variant={getStatusVariant(wo.priority)} size="sm" />
                  <Badge label={wo.status} variant={getStatusVariant(wo.status)} size="sm" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
