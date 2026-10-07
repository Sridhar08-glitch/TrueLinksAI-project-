import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  FileText,
  Wrench,
  DollarSign,
  AlertTriangle,
  Info,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { notificationsApi } from '../lib/api';
import type { Notification } from '../types';
import { formatRelativeTime, capitalizeFirst } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';

const TYPE_ICONS: Record<string, { icon: React.ReactNode; bg: string }> = {
  info: { icon: <Info className="w-4 h-4" />, bg: 'bg-blue-50 text-blue-600' },
  warning: { icon: <AlertTriangle className="w-4 h-4" />, bg: 'bg-orange-50 text-orange-600' },
  success: { icon: <CheckCircle className="w-4 h-4" />, bg: 'bg-emerald-50 text-emerald-600' },
  error: { icon: <XCircle className="w-4 h-4" />, bg: 'bg-red-50 text-red-600' },
  lease: { icon: <FileText className="w-4 h-4" />, bg: 'bg-purple-50 text-purple-600' },
  maintenance: { icon: <Wrench className="w-4 h-4" />, bg: 'bg-orange-50 text-orange-600' },
  payment: { icon: <DollarSign className="w-4 h-4" />, bg: 'bg-emerald-50 text-emerald-600' },
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch } = useQuery<{ results: Notification[]; count: number }>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await notificationsApi.getAll({ limit: 100, ordering: '-created_at' });
      return res.data;
    },
    staleTime: 15 * 1000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-count'] });
  };

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  });

  const notifications = data?.results ?? [];
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {notifications.length} total
            {unreadCount > 0 && <span className="ml-2 text-blue-600 font-medium">· {unreadCount} unread</span>}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            icon={<CheckCheck className="w-4 h-4" />}
            loading={markAllReadMutation.isPending}
            onClick={() => markAllReadMutation.mutate()}
          >
            Mark all read
          </Button>
        )}
      </div>

      {/* Notifications list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isError ? (
          <QueryError label="notifications" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="divide-y divide-gray-50">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-start gap-4 animate-pulse">
                <div className="w-9 h-9 bg-gray-200 rounded-xl flex-shrink-0" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={<Bell className="w-8 h-8" />}
            title="No notifications"
            description="You're all caught up! New notifications will appear here."
          />
        ) : (
          <div className="divide-y divide-gray-50">
            {notifications.map((notif) => {
              const typeInfo = TYPE_ICONS[notif.notification_type] ?? TYPE_ICONS.info;
              return (
                <div
                  key={notif.id}
                  onClick={() => {
                    if (!notif.is_read) markReadMutation.mutate(notif.id);
                    if (notif.link) navigate(notif.link);
                  }}
                  className={`px-5 py-4 flex items-start gap-4 cursor-pointer transition-colors hover:bg-gray-50 ${!notif.is_read ? 'bg-blue-50/30' : ''}`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${typeInfo.bg}`}>
                    {typeInfo.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${notif.is_read ? 'text-gray-700' : 'text-slate-900'}`}>
                        {notif.title}
                      </p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-gray-400">{formatRelativeTime(notif.created_at)}</span>
                        {!notif.is_read && (
                          <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{notif.message}</p>
                    <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mt-1.5 ${typeInfo.bg}`}>
                      {capitalizeFirst(notif.notification_type)}
                    </span>
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
