import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Home,
  Users,
  FileText,
  Wrench,
  TrendingUp,
  TrendingDown,
  Plus,
  ArrowRight,
  Brain,
  AlertTriangle,
  CheckCircle,
  Activity,
  ChevronRight,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { dashboardApi, propertiesApi, leasesApi, auditEventsApi } from '../lib/api';
import type { DashboardStats, Property, Lease, AuditEvent } from '../types';
import { useAuthStore } from '../store/authStore';
import {
  formatCurrency,
  formatRelativeTime,
  getOccupancyRate,
  getDaysUntil,
} from '../lib/utils';
import { StatCard } from '../components/ui/StatCard';
import { PageLoader, SkeletonCard } from '../components/ui/LoadingSpinner';
import { QueryError } from '../components/ui/QueryError';
import { useNavigate } from 'react-router-dom';

const DONUT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

function getActivityIcon(entityType: string) {
  const icons: Record<string, React.ReactNode> = {
    lease: <FileText className="w-3.5 h-3.5" />,
    unit: <Home className="w-3.5 h-3.5" />,
    property: <Building2 className="w-3.5 h-3.5" />,
    building: <Building2 className="w-3.5 h-3.5" />,
    work_order: <Wrench className="w-3.5 h-3.5" />,
    workorder: <Wrench className="w-3.5 h-3.5" />,
    tenant: <Users className="w-3.5 h-3.5" />,
    user: <Users className="w-3.5 h-3.5" />,
    inspection: <Activity className="w-3.5 h-3.5" />,
  };
  return icons[entityType] ?? <Activity className="w-3.5 h-3.5" />;
}

function getActivityBg(entityType: string) {
  const colors: Record<string, string> = {
    lease: 'bg-blue-50 text-blue-600',
    unit: 'bg-emerald-50 text-emerald-600',
    property: 'bg-purple-50 text-purple-600',
    building: 'bg-purple-50 text-purple-600',
    work_order: 'bg-orange-50 text-orange-600',
    workorder: 'bg-orange-50 text-orange-600',
    tenant: 'bg-pink-50 text-pink-600',
    user: 'bg-pink-50 text-pink-600',
    inspection: 'bg-gray-50 text-gray-600',
  };
  return colors[entityType] ?? 'bg-gray-50 text-gray-600';
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const firstName = user?.first_name || user?.email?.split('@')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const { data: statsData, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await dashboardApi.getStats();
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const { data: monthlyData } = useQuery<{ month: string; occupancy: number }[]>({
    queryKey: ['dashboard-monthly'],
    queryFn: async () => {
      const res = await dashboardApi.monthlyStats();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: propertiesData, isLoading: propertiesLoading, isError: propertiesError, refetch: refetchProperties } = useQuery<{ results: Property[]; count: number }>({
    queryKey: ['properties', { page: 1, limit: 6 }],
    queryFn: async () => {
      const res = await propertiesApi.getAll({ limit: 6 });
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const { data: leasesData, isLoading: leasesLoading, isError: leasesError, refetch: refetchLeases } = useQuery<{ results: Lease[] }>({
    queryKey: ['leases-expiring'],
    queryFn: async () => {
      const res = await leasesApi.getAll({ ordering: 'end_date', limit: 20 });
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const { data: activityData, isLoading: activityLoading, isError: activityError, refetch: refetchActivity } = useQuery<{ results: AuditEvent[] }>({
    queryKey: ['audit-events', { limit: 6 }],
    queryFn: async () => {
      const res = await auditEventsApi.getAll({ limit: 6 });
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const stats = statsData;
  const properties = propertiesData?.results ?? [];
  const leases = leasesData?.results ?? [];
  const activities = (activityData?.results ?? []).slice(0, 6);
  const occupancyTrend = monthlyData ?? [];

  // Build donut chart data from properties
  const donutData = properties.slice(0, 6).map((p) => ({
    name: p.name,
    value: p.total_units || 0,
  }));

  // Only show upcoming expirations (0..60 days) — exclude already-expired leases
  const expiringLeases = leases
    .filter((l) => {
      if (!l.end_date) return false;
      const days = getDaysUntil(l.end_date);
      return days >= 0 && days <= 60;
    })
    .sort((a, b) => getDaysUntil(a.end_date!) - getDaysUntil(b.end_date!));

  const leasesExpiringSoon = leases.filter((l) => l.end_date && getDaysUntil(l.end_date) <= 30 && getDaysUntil(l.end_date) >= 0).length;
  const currentOccupancy = stats ? getOccupancyRate(stats.occupied_units, stats.total_units) : 0;
  const prevMonthOccupancy = occupancyTrend.length >= 2 ? occupancyTrend[occupancyTrend.length - 2]?.occupancy ?? 0 : 0;
  const occupancyDelta = currentOccupancy - prevMonthOccupancy;

  const aiInsights = [
    ...(leasesExpiringSoon > 0 ? [{
      icon: <AlertTriangle className="w-4 h-4" />,
      color: 'text-orange-500 bg-orange-50',
      title: `${leasesExpiringSoon} lease${leasesExpiringSoon > 1 ? 's' : ''} expiring within 30 days`,
      description: 'Review and renew these leases before they expire.',
    }] : [{
      icon: <CheckCircle className="w-4 h-4" />,
      color: 'text-emerald-500 bg-emerald-50',
      title: 'No leases expiring soon',
      description: 'All active leases have more than 30 days remaining.',
    }]),
    ...(stats?.pending_work_orders ? [{
      icon: <Wrench className="w-4 h-4" />,
      color: 'text-purple-500 bg-purple-50',
      title: `${stats.pending_work_orders} work order${stats.pending_work_orders !== 1 ? 's' : ''} pending review`,
      description: 'Awaiting approval before scheduling.',
    }] : []),
    ...(occupancyTrend.length >= 2 ? [{
      icon: occupancyDelta >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />,
      color: occupancyDelta >= 0 ? 'text-emerald-500 bg-emerald-50' : 'text-red-500 bg-red-50',
      title: `Occupancy ${occupancyDelta >= 0 ? 'up' : 'down'} ${Math.abs(occupancyDelta).toFixed(1)}% vs last month`,
      description: `Current rate: ${currentOccupancy}% · ${stats?.occupied_units ?? 0}/${stats?.total_units ?? 0} units occupied.`,
    }] : []),
    ...(stats?.open_issues ? [{
      icon: <AlertTriangle className="w-4 h-4" />,
      color: 'text-red-500 bg-red-50',
      title: `${stats.open_issues} open inspection issue${stats.open_issues !== 1 ? 's' : ''}`,
      description: 'Damage findings from recent inspections need attention.',
    }] : []),
    ...(stats?.active_leases ? [{
      icon: <FileText className="w-4 h-4" />,
      color: 'text-blue-500 bg-blue-50',
      title: `${stats.active_leases} lease${stats.active_leases !== 1 ? 's' : ''} processed by AI`,
      description: 'Documents extracted and ready for review.',
    }] : []),
  ].slice(0, 4);

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="relative rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 40%, #1e40af 70%, #0f172a 100%)',
          minHeight: '160px'
        }}
      >
        {/* City skyline silhouette overlay */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 120'%3E%3Cpath d='M0,80 L0,120 L1200,120 L1200,80 L1180,80 L1180,30 L1160,30 L1160,50 L1140,50 L1140,20 L1120,20 L1120,60 L1100,60 L1100,40 L1080,40 L1080,70 L1060,70 L1060,30 L1040,30 L1040,55 L1020,55 L1020,25 L1000,25 L1000,70 L980,70 L980,45 L960,45 L960,65 L940,65 L940,35 L920,35 L920,50 L900,50 L900,80 L880,80 L880,30 L860,30 L860,60 L840,60 L840,20 L820,20 L820,45 L800,45 L800,70 L780,70 L780,40 L760,40 L760,25 L740,25 L740,60 L720,60 L720,35 L700,35 L700,55 L680,55 L680,80 L660,80 L660,30 L640,30 L640,50 L620,50 L620,20 L600,20 L600,65 L580,65 L580,40 L560,40 L560,25 L540,25 L540,70 L520,70 L520,45 L500,45 L500,60 L480,60 L480,35 L460,35 L460,55 L440,55 L440,80 L420,80 L420,25 L400,25 L400,45 L380,45 L380,30 L360,30 L360,70 L340,70 L340,40 L320,40 L320,20 L300,20 L300,60 L280,60 L280,50 L260,50 L260,35 L240,35 L240,65 L220,65 L220,30 L200,30 L200,55 L180,55 L180,80 L160,80 L160,40 L140,40 L140,25 L120,25 L120,60 L100,60 L100,45 L80,45 L80,70 L60,70 L60,30 L40,30 L40,50 L20,50 L20,80 L0,80 Z' fill='white'/%3E%3C/svg%3E")`,
            backgroundSize: 'cover',
            backgroundPosition: 'bottom',
          }}
        />
        {/* Stars/dots pattern */}
        <div className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />

        <div className="relative z-10 p-7 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">
              {greeting}, {firstName} 👋
            </h1>
            <p className="text-blue-200/80 text-sm">
              Here's what's happening with your properties today.
            </p>
          </div>

          {/* Overlay metric cards */}
          <div className="hidden lg:flex items-center gap-4">
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-xl px-5 py-3.5 text-white">
              <p className="text-xs text-blue-200/70 mb-1">Total Properties</p>
              <p className="text-xl font-bold">
                {stats ? (stats.total_properties ?? properties.length ?? 0) : '—'}
              </p>
              <p className="text-xs text-blue-200/60 mt-1">
                {stats ? `${stats.total_units ?? 0} units across portfolio` : ''}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-xl px-5 py-3.5 text-white">
              <p className="text-xs text-blue-200/70 mb-1">Occupancy Rate</p>
              <p className="text-xl font-bold">
                {stats ? `${getOccupancyRate(stats.occupied_units, stats.total_units)}%` : '—'}
              </p>
              <p className="text-xs text-blue-200/60 mt-1">
                {stats ? `${stats.occupied_units ?? 0} of ${stats.total_units ?? 0} units occupied` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="relative z-10 px-7 pb-6 flex gap-3">
          <button
            onClick={() => navigate('/properties')}
            className="flex items-center gap-2 bg-white text-slate-900 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-50 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Property
          </button>
          <button
            onClick={() => navigate('/properties')}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors border border-white/20"
          >
            View All Properties
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats Row */}
      {statsError ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <QueryError label="dashboard stats" onRetry={() => refetchStats()} />
        </div>
      ) : statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            title="Properties"
            value={statsLoading ? '—' : (stats?.total_properties ?? properties.length ?? 0)}
            icon={<Building2 className="w-5 h-5" />}
            iconBgColor="bg-blue-50"
            iconColor="text-blue-600"
          />
          <StatCard
            title="Total Units"
            value={stats?.total_units ?? '—'}
            icon={<Home className="w-5 h-5" />}
            iconBgColor="bg-purple-50"
            iconColor="text-purple-600"
          />
          <StatCard
            title="Occupied"
            value={stats?.occupied_units ?? '—'}
            icon={<Users className="w-5 h-5" />}
            iconBgColor="bg-emerald-50"
            iconColor="text-emerald-600"
            subtitle={stats ? `${getOccupancyRate(stats.occupied_units, stats.total_units)}% occupancy` : undefined}
          />
          <StatCard
            title="Available"
            value={stats?.available_units ?? '—'}
            icon={<Home className="w-5 h-5" />}
            iconBgColor="bg-orange-50"
            iconColor="text-orange-600"
          />
          <StatCard
            title="AI Leases"
            value={stats?.active_leases ?? '—'}
            icon={<FileText className="w-5 h-5" />}
            iconBgColor="bg-blue-50"
            iconColor="text-blue-600"
            subtitle="processed"
          />
          <StatCard
            title="Work Orders"
            value={stats?.pending_work_orders ?? '—'}
            icon={<Wrench className="w-5 h-5" />}
            iconBgColor="bg-red-50"
            iconColor="text-red-600"
            subtitle="pending"
          />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Occupancy Trend */}
        <div className="lg:col-span-2 bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Occupancy Trend</h3>
              <p className="text-xs text-gray-500 mt-0.5">Last 6 months · live data</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-blue-500 inline-block rounded" /> Occupancy %
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={occupancyTrend.length > 0 ? occupancyTrend : []} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                formatter={(value) => [value != null ? `${value}%` : '', 'Occupancy']}
              />
              <Line
                type="monotone"
                dataKey="occupancy"
                stroke="#3B82F6"
                strokeWidth={2.5}
                dot={{ fill: '#3B82F6', r: 4, strokeWidth: 2, stroke: 'white' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Units by Property Donut */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900">Units by Property</h3>
            <p className="text-xs text-gray-500 mt-0.5">Distribution overview</p>
          </div>
          {donutData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {donutData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span style={{ fontSize: 11, color: '#6b7280' }}>{value}</span>}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(value) => [value ?? 0, 'Units']}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-gray-400 text-sm">
              No property data available
            </div>
          )}
        </div>
      </div>

      {/* AI Insights + Properties Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* AI Insights Panel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Brain className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">AI Insights</h3>
            </div>
            <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">LIVE</span>
          </div>
          <div className="p-4 space-y-3">
            {aiInsights.map((insight, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${insight.color}`}>
                  {insight.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{insight.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{insight.description}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-gray-100">
            <button className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              View all insights <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Properties Overview */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Properties Overview</h3>
            <button
              onClick={() => navigate('/properties')}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              View all <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {propertiesError ? (
              <QueryError label="properties" onRetry={() => refetchProperties()} />
            ) : propertiesLoading ? (
              <div className="p-6"><PageLoader /></div>
            ) : properties.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                No properties found. Add your first property to get started.
              </div>
            ) : (
              properties.slice(0, 5).map((property, index) => {
                const occupancyRate = getOccupancyRate(property.occupied_units, property.total_units);
                const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500'];
                const color = colors[index % colors.length];
                return (
                  <div key={property.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50 cursor-pointer transition-colors">
                    <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center flex-shrink-0`}>
                      <Building2 className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{property.name}</p>
                        <span className="text-xs font-semibold text-slate-700 ml-2 flex-shrink-0">{occupancyRate}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${color}`}
                            style={{ width: `${occupancyRate}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          {property.occupied_units}/{property.total_units} units
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity + Upcoming Lease Expirations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Recent Activity</h3>
            <span className="text-xs text-gray-400">{activities.length} events</span>
          </div>
          <div className="divide-y divide-gray-50">
            {activityError ? (
              <QueryError label="recent activity" onRetry={() => refetchActivity()} />
            ) : activityLoading ? (
              <div className="p-6"><PageLoader /></div>
            ) : activities.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No recent activity</div>
            ) : (
              activities.map((event) => {
                const entityType = event.entity_type?.toLowerCase() ?? '';
                return (
                  <div key={event.id} className="px-5 py-3 flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${getActivityBg(entityType)}`}>
                      {getActivityIcon(entityType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 truncate">
                        <span className="font-medium">{event.actor || 'System'}</span>
                        {' '}{event.action?.replace(/_/g, ' ')}{' '}
                        {event.entity_type?.replace(/_/g, ' ')} #{event.entity_id}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{formatRelativeTime(event.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Upcoming Lease Expirations */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Upcoming Lease Expirations</h3>
            <button
              onClick={() => navigate('/leases')}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              View all <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {leasesError ? (
              <QueryError label="lease expirations" onRetry={() => refetchLeases()} />
            ) : leasesLoading ? (
              <div className="p-6"><PageLoader /></div>
            ) : expiringLeases.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                No leases expiring soon
              </div>
            ) : (
              expiringLeases.map((lease) => {
                const daysLeft = getDaysUntil(lease.end_date!);
                const isUrgent = daysLeft <= 14;
                const isMedium = daysLeft <= 30;
                const dateBg = isUrgent ? 'bg-red-500' : isMedium ? 'bg-orange-400' : 'bg-blue-500';
                const dayStr = new Date(lease.end_date!).getDate().toString().padStart(2, '0');
                const monthStr = new Date(lease.end_date!).toLocaleDateString('en-US', { month: 'short' });
                return (
                  <div key={lease.id} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50 cursor-pointer transition-colors">
                    <div className={`w-10 h-10 ${dateBg} rounded-xl flex flex-col items-center justify-center text-white flex-shrink-0`}>
                      <span className="text-[10px] font-medium leading-none opacity-90">{monthStr}</span>
                      <span className="text-base font-bold leading-tight">{dayStr}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {lease.tenant_name ?? `Lease #${lease.id}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {lease.unit_label ? `Unit ${lease.unit_label}` : lease.unit ? `Unit #${lease.unit}` : '—'}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <span className={`text-xs font-semibold ${isUrgent ? 'text-red-600' : isMedium ? 'text-orange-500' : 'text-gray-600'}`}>
                        {daysLeft === 0 ? 'Today' : `${daysLeft}d left`}
                      </span>
                      {lease.rent_amount && <p className="text-xs text-gray-400 mt-0.5">{formatCurrency(lease.rent_amount, lease.currency)}/mo</p>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
