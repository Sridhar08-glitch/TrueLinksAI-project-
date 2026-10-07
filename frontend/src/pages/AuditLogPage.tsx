import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Activity, ChevronDown, ChevronUp, FileText, Home, KeyRound, Mail,
  ScrollText, Search as SearchIcon, User, Users, Wrench,
} from 'lucide-react';
import { auditEventsApi } from '../lib/api';
import type { AuditEvent, PaginatedResponse } from '../types';
import { capitalizeFirst, formatDate, formatRelativeTime } from '../lib/utils';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { useDebounce } from '../lib/useDebounce';

const PAGE_SIZE = 25;

// Entity types used by backend AuditService.log(...) calls
const ENTITY_TYPES = [
  'lease', 'unit', 'work_order', 'inspection', 'inspection_finding',
  'lease_field', 'lease_flag', 'lease_clause', 'tenant', 'user',
  'invitation', 'assignment',
];

// Common actions found across backend audit calls
const ACTIONS = [
  'created', 'created_manually', 'approved', 'rejected', 'deleted',
  'cancelled', 'archived', 'unarchived', 'started', 'completed',
  'assigned', 'unassigned', 'uploaded', 'registered', 'accepted',
  'revoked', 'ended', 'updated', 'deactivated',
];

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  lease: <FileText className="w-4 h-4" />,
  lease_field: <FileText className="w-4 h-4" />,
  lease_flag: <FileText className="w-4 h-4" />,
  lease_clause: <FileText className="w-4 h-4" />,
  unit: <Home className="w-4 h-4" />,
  work_order: <Wrench className="w-4 h-4" />,
  inspection: <SearchIcon className="w-4 h-4" />,
  inspection_finding: <SearchIcon className="w-4 h-4" />,
  tenant: <Users className="w-4 h-4" />,
  user: <User className="w-4 h-4" />,
  invitation: <Mail className="w-4 h-4" />,
  assignment: <KeyRound className="w-4 h-4" />,
};

const ENTITY_ICON_COLORS: Record<string, string> = {
  lease: 'bg-purple-50 text-purple-600',
  lease_field: 'bg-purple-50 text-purple-600',
  lease_flag: 'bg-purple-50 text-purple-600',
  lease_clause: 'bg-purple-50 text-purple-600',
  unit: 'bg-emerald-50 text-emerald-600',
  work_order: 'bg-orange-50 text-orange-600',
  inspection: 'bg-blue-50 text-blue-600',
  inspection_finding: 'bg-blue-50 text-blue-600',
  tenant: 'bg-sky-50 text-sky-600',
  user: 'bg-slate-100 text-slate-600',
  invitation: 'bg-pink-50 text-pink-600',
  assignment: 'bg-indigo-50 text-indigo-600',
};

function dayLabel(timestamp: string): string {
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return formatDate(timestamp, { weekday: 'long' });
}

function groupByDay(events: AuditEvent[]): { label: string; events: AuditEvent[] }[] {
  const groups: { label: string; events: AuditEvent[] }[] = [];
  for (const event of events) {
    const label = dayLabel(event.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.events.push(event);
    } else {
      groups.push({ label, events: [event] });
    }
  }
  return groups;
}

function MetadataBlock({ metadata }: { metadata: Record<string, unknown> }) {
  return (
    <div className="mt-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 space-y-1">
      {Object.entries(metadata).map(([key, value]) => (
        <div key={key} className="flex items-start gap-2 text-xs">
          <span className="font-medium text-gray-500 flex-shrink-0">{key}:</span>
          <span className="text-gray-700 break-all">
            {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function EventRow({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = !!event.metadata && Object.keys(event.metadata).length > 0;
  return (
    <div className="relative pl-12">
      {/* timeline dot + icon */}
      <div className={`absolute left-0 top-0 w-8 h-8 rounded-lg flex items-center justify-center ${ENTITY_ICON_COLORS[event.entity_type] ?? 'bg-gray-100 text-gray-500'}`}>
        {ENTITY_ICONS[event.entity_type] ?? <Activity className="w-4 h-4" />}
      </div>
      <button
        onClick={() => hasMetadata && setExpanded(v => !v)}
        className={`w-full text-left rounded-lg px-3 py-2 -mx-3 transition-colors ${hasMetadata ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-slate-800 leading-snug">
            <span className="font-semibold">{event.actor || 'system'}</span>
            {' '}{event.action.replace(/_/g, ' ')}{' '}
            <span className="text-gray-600">{event.entity_type.replace(/_/g, ' ')}</span>
            {' '}<span className="font-medium text-slate-900">#{event.entity_id}</span>
          </p>
          <span className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-xs text-gray-400 whitespace-nowrap" title={new Date(event.timestamp).toLocaleString()}>
              {formatRelativeTime(event.timestamp)}
            </span>
            {hasMetadata && (expanded
              ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
              : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />)}
          </span>
        </div>
        {expanded && hasMetadata && <MetadataBlock metadata={event.metadata!} />}
      </button>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="h-3 w-16 bg-gray-200 rounded" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-gray-100 rounded w-3/4" />
            <div className="h-2.5 bg-gray-50 rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const debouncedEntityId = useDebounce(entityId, 300);

  const {
    data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['audit-events', { page: 'audit-log', entityType, action, entityId: debouncedEntityId }],
    queryFn: async ({ pageParam }) => (await auditEventsApi.getAll({
      entity_type: entityType || undefined,
      action: action || undefined,
      entity_id: debouncedEntityId || undefined,
      limit: PAGE_SIZE,
      offset: pageParam,
    })).data as PaginatedResponse<AuditEvent>,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.results.length, 0);
      return loaded < lastPage.count ? loaded : undefined;
    },
    staleTime: 30 * 1000,
  });

  const events = data?.pages.flatMap(p => p.results) ?? [];
  const total = data?.pages[0]?.count ?? 0;
  const groups = groupByDay(events);
  const hasFilters = !!(entityType || action || entityId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Audit Log</h1>
        <p className="text-sm text-gray-500 mt-0.5">{total} events recorded</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <select value={entityType} onChange={e => setEntityType(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700">
          <option value="">All Entities</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{capitalizeFirst(t)}</option>)}
        </select>
        <select value={action} onChange={e => setAction(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-700">
          <option value="">All Actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{capitalizeFirst(a)}</option>)}
        </select>
        <input
          type="number" min="1" value={entityId} onChange={e => setEntityId(e.target.value)}
          placeholder="Entity ID"
          className="w-32 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
        />
        {hasFilters && (
          <button onClick={() => { setEntityType(''); setAction(''); setEntityId(''); }}
            className="px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            Clear filters
          </button>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isError ? (
          <QueryError label="audit events" onRetry={() => refetch()} />
        ) : isLoading ? (
          <TimelineSkeleton />
        ) : events.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="w-8 h-8" />}
            title="No audit events found"
            description={hasFilters ? 'Try adjusting your filters.' : 'Activity will appear here as changes are made.'}
          />
        ) : (
          <div className="p-6">
            {groups.map(group => (
              <div key={group.label} className="mb-6 last:mb-0">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{group.label}</h3>
                <div className="relative space-y-4">
                  {/* vertical line */}
                  <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-100" aria-hidden="true" />
                  {group.events.map(event => <EventRow key={event.id} event={event} />)}
                </div>
              </div>
            ))}
            {hasNextPage && (
              <div className="pt-2 text-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-60"
                >
                  {isFetchingNextPage ? 'Loading...' : `Load more (${events.length} of ${total})`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
