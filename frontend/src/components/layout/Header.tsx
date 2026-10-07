import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Search, Calendar, ChevronDown, Menu, CheckCheck } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { notificationsApi } from '../../lib/api';
import type { Notification } from '../../types';
import { formatRelativeTime } from '../../lib/utils';

interface HeaderProps {
  onMenuClick?: () => void;
  onSearchClick?: () => void;
}

export function Header({ onMenuClick, onSearchClick }: HeaderProps) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Shares the query key (and cache entry) with NotificationsPage.
  const { data: notifData } = useQuery<{ unread_count?: number; count: number; results: Notification[] }>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const r = await notificationsApi.getAll({ limit: 100, ordering: '-created_at' });
      return r.data;
    },
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });

  const notifications = notifData?.results ?? [];
  const unreadCount = notifData?.unread_count
    ?? notifications.filter(n => !n.is_read).length;
  const recent = notifications.slice(0, 8);

  const invalidateNotifications = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-count'] });
  };

  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: invalidateNotifications,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidateNotifications,
  });

  // Close dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  const handleNotificationClick = (n: Notification) => {
    if (!n.is_read) markReadMutation.mutate(n.id);
    setNotifOpen(false);
    navigate(n.link || '/notifications');
  };

  const fullName = user
    ? `${user.first_name} ${user.last_name}`.trim() || user.email
    : 'User';

  return (
    <header className="h-14 bg-white border-b border-gray-100 flex items-center px-4 md:px-6 gap-3 flex-shrink-0">
      {/* Mobile menu */}
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Search trigger (command palette) */}
      <div className="flex-1 max-w-sm">
        <button
          onClick={onSearchClick}
          className="w-full flex items-center gap-2 pl-3 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-100 transition-colors text-gray-400"
        >
          <Search className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 text-left truncate">Search…</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-semibold text-gray-400 bg-white border border-gray-200 rounded px-1.5 py-0.5">
            Ctrl K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-3 ml-auto">
        {/* Date */}
        <div className="hidden md:flex items-center gap-2 text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-xs font-medium">{dateStr}</span>
        </div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(o => !o)}
            className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-slate-900">
                  Notifications
                  {unreadCount > 0 && <span className="ml-1.5 text-xs text-blue-600 font-medium">{unreadCount} unread</span>}
                </p>
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllReadMutation.mutate()}
                    disabled={markAllReadMutation.isPending}
                    className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {recent.length === 0 ? (
                  <div className="py-8 text-center">
                    <Bell className="w-6 h-6 text-gray-200 mx-auto mb-1.5" />
                    <p className="text-xs text-gray-400">You're all caught up</p>
                  </div>
                ) : (
                  recent.map(n => (
                    <button
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-2.5 ${!n.is_read ? 'bg-blue-50/40' : ''}`}
                    >
                      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!n.is_read ? 'bg-blue-500' : 'bg-transparent'}`} />
                      <span className="flex-1 min-w-0">
                        <span className={`block text-xs font-semibold truncate ${n.is_read ? 'text-gray-600' : 'text-slate-900'}`}>
                          {n.title}
                        </span>
                        <span className="block text-xs text-gray-500 truncate mt-0.5">{n.message}</span>
                      </span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <button
                onClick={() => { setNotifOpen(false); navigate('/notifications'); }}
                className="w-full px-4 py-2.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 border-t border-gray-100 transition-colors"
              >
                View all
              </button>
            </div>
          )}
        </div>

        {/* User */}
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-2 hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors"
        >
          <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center">
            <span className="text-xs font-bold text-white">{fullName.charAt(0).toUpperCase()}</span>
          </div>
          <span className="hidden md:block text-sm font-medium text-gray-700 max-w-[120px] truncate">
            {fullName}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 hidden md:block" />
        </button>
      </div>
    </header>
  );
}
