import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Wrench, FileText, User, LogOut,
  Bell, ChevronDown, Menu, X,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const NAV = [
  { to: '/tenant', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tenant/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/tenant/documents', label: 'Documents', icon: FileText },
  { to: '/tenant/notifications', label: 'Notifications', icon: Bell },
  { to: '/tenant/profile', label: 'My Profile', icon: User },
];

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const initials = `${user?.first_name?.charAt(0) ?? ''}${user?.last_name?.charAt(0) ?? ''}`.toUpperCase()
    || user?.email?.charAt(0).toUpperCase() || 'T';

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-slate-900 to-slate-800 text-white w-64">
      {/* Logo */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Logo" className="w-8 h-8 rounded-xl flex-shrink-0" />
          <div>
            <p className="text-sm font-bold leading-none">Sridhar</p>
            <p className="text-[10px] text-blue-300/70 mt-0.5">Resident Portal</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg lg:hidden">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/tenant'}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-3 pb-4 border-t border-white/10 pt-4">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5 mb-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={async () => { await logout(); navigate('/login'); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </div>
  );
}

export function TenantLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuthStore();

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-5 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 lg:hidden"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-700">Resident Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
              <Bell className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded-xl px-2 py-1.5 transition-colors">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                <span className="text-xs font-bold text-white">
                  {user?.first_name?.charAt(0)}{user?.last_name?.charAt(0)}
                </span>
              </div>
              <span className="text-sm font-medium text-slate-700 hidden sm:block">
                {user?.first_name}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-5 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
