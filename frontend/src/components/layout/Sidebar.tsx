import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Building2,
  Building,
  Home,
  Users,
  FileText,
  Brain,
  ClipboardList,
  Search,
  ScrollText,
  Bell,
  Settings,
  LogOut,
  HelpCircle,
  User,
  UserCog,
  Wallet,
  FileBarChart,
  Shield,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../store/authStore';
import { dashboardApi, notificationsApi } from '../../lib/api';
import { useState } from 'react';
import type { DashboardStats } from '../../types';

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  badgeKey?: 'pending_lease_reviews' | 'pending_work_orders' | 'unread_notifications';
  badgeColor?: string;
}

const ownerNavItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
  { label: 'Properties', to: '/properties', icon: <Building2 className="w-4.5 h-4.5" /> },
  { label: 'Buildings', to: '/buildings', icon: <Building className="w-4.5 h-4.5" /> },
  { label: 'Units', to: '/units', icon: <Home className="w-4.5 h-4.5" /> },
  { label: 'Tenants', to: '/tenants', icon: <Users className="w-4.5 h-4.5" /> },
  { label: 'Staff', to: '/staff', icon: <UserCog className="w-4.5 h-4.5" /> },
  { label: 'Leases', to: '/leases', icon: <FileText className="w-4.5 h-4.5" /> },
  { label: 'Payments', to: '/payments', icon: <Wallet className="w-4.5 h-4.5" /> },
  { label: 'AI Lease Review', to: '/ai-lease-review', icon: <Brain className="w-4.5 h-4.5" />, badgeKey: 'pending_lease_reviews', badgeColor: 'bg-orange-500' },
  { label: 'Lease Rules', to: '/lease-rules', icon: <Shield className="w-4.5 h-4.5" /> },
  { label: 'Work Orders', to: '/work-orders', icon: <ClipboardList className="w-4.5 h-4.5" />, badgeKey: 'pending_work_orders', badgeColor: 'bg-blue-500' },
  { label: 'Inspections', to: '/inspections', icon: <Search className="w-4.5 h-4.5" /> },
  { label: 'Reports', to: '/reports', icon: <FileBarChart className="w-4.5 h-4.5" /> },
  { label: 'Audit Log', to: '/audit', icon: <ScrollText className="w-4.5 h-4.5" /> },
  { label: 'Notifications', to: '/notifications', icon: <Bell className="w-4.5 h-4.5" />, badgeKey: 'unread_notifications', badgeColor: 'bg-red-500' },
  { label: 'Settings', to: '/settings', icon: <Settings className="w-4.5 h-4.5" /> },
];

const propertyManagerNavItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
  { label: 'Properties', to: '/properties', icon: <Building2 className="w-4.5 h-4.5" /> },
  { label: 'Buildings', to: '/buildings', icon: <Building className="w-4.5 h-4.5" /> },
  { label: 'Units', to: '/units', icon: <Home className="w-4.5 h-4.5" /> },
  { label: 'Tenants', to: '/tenants', icon: <Users className="w-4.5 h-4.5" /> },
  { label: 'Leases', to: '/leases', icon: <FileText className="w-4.5 h-4.5" /> },
  { label: 'Payments', to: '/payments', icon: <Wallet className="w-4.5 h-4.5" /> },
  { label: 'AI Lease Review', to: '/ai-lease-review', icon: <Brain className="w-4.5 h-4.5" />, badgeKey: 'pending_lease_reviews', badgeColor: 'bg-orange-500' },
  { label: 'Work Orders', to: '/work-orders', icon: <ClipboardList className="w-4.5 h-4.5" />, badgeKey: 'pending_work_orders', badgeColor: 'bg-blue-500' },
  { label: 'Inspections', to: '/inspections', icon: <Search className="w-4.5 h-4.5" /> },
  { label: 'Reports', to: '/reports', icon: <FileBarChart className="w-4.5 h-4.5" /> },
  { label: 'Audit Log', to: '/audit', icon: <ScrollText className="w-4.5 h-4.5" /> },
  { label: 'Notifications', to: '/notifications', icon: <Bell className="w-4.5 h-4.5" />, badgeKey: 'unread_notifications', badgeColor: 'bg-red-500' },
  { label: 'Settings', to: '/settings', icon: <Settings className="w-4.5 h-4.5" /> },
];

const maintenanceNavItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
  { label: 'Work Orders', to: '/work-orders', icon: <ClipboardList className="w-4.5 h-4.5" />, badgeKey: 'pending_work_orders', badgeColor: 'bg-blue-500' },
  { label: 'Inspections', to: '/inspections', icon: <Search className="w-4.5 h-4.5" /> },
  { label: 'Notifications', to: '/notifications', icon: <Bell className="w-4.5 h-4.5" />, badgeKey: 'unread_notifications', badgeColor: 'bg-red-500' },
  { label: 'Settings', to: '/settings', icon: <Settings className="w-4.5 h-4.5" /> },
];

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const role = user?.role ?? 'owner';
  const navItems = role === 'maintenance_staff'
    ? maintenanceNavItems
    : role === 'property_manager'
      ? propertyManagerNavItems
      : ownerNavItems;

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => { const r = await dashboardApi.getStats(); return r.data; },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const { data: notifData } = useQuery<{ unread_count?: number; results?: { is_read: boolean }[] }>({
    queryKey: ['notifications-count'],
    queryFn: async () => { const r = await notificationsApi.getAll({ limit: 50 }); return r.data; },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const unreadNotifications = notifData?.unread_count
    ?? notifData?.results?.filter(n => !n.is_read).length
    ?? 0;

  function getBadge(key?: NavItem['badgeKey']): number {
    if (!key) return 0;
    if (key === 'pending_lease_reviews') return stats?.pending_lease_reviews ?? 0;
    if (key === 'pending_work_orders') return stats?.pending_work_orders ?? 0;
    if (key === 'unread_notifications') return unreadNotifications;
    return 0;
  }

  const handleLogout = async () => {
    setLoggingOut(true);
    try { await logout(); navigate('/login'); } finally { setLoggingOut(false); }
  };

  const fullName = user
    ? `${user.first_name} ${user.last_name}`.trim() || user.email
    : 'Property Manager';

  const roleLabel = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1).replace(/_/g, ' ')
    : 'Property Owner';

  return (
    <aside className="w-[220px] h-full min-h-0 bg-white border-r border-gray-100 flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Logo" className="w-8 h-8 rounded-lg" />
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-900 leading-tight">Sridhar</p>
            <p className="text-[10px] text-gray-400 leading-tight">Property Management</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 lg:hidden">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const badge = getBadge(item.badgeKey);
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative',
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={cn('flex-shrink-0', isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-600')}>
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {badge > 0 && (
                        <span className={cn('text-[10px] font-bold text-white rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center flex-shrink-0', item.badgeColor ?? 'bg-gray-500')}>
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User card */}
      <div className="px-3 py-4 border-t border-gray-100">
        <div className="bg-gray-50 rounded-xl p-3 mb-3">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">
                {fullName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gray-900 truncate">{fullName}</p>
              <p className="text-[10px] text-gray-500 truncate">{roleLabel}</p>
            </div>
          </div>
          <div className="space-y-1">
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-white rounded-lg transition-colors"
            >
              <User className="w-3.5 h-3.5" />
              Profile
            </button>
            <button
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-white rounded-lg transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Help &amp; Support
            </button>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              {loggingOut ? 'Logging out...' : 'Log out'}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
