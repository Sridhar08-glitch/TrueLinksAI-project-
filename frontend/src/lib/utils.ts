import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null || isNaN(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'QAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(amount));
  } catch {
    // Unknown/invalid currency code from extracted data — fall back gracefully
    return `${currency || 'QAR'} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(amount))}`;
  }
}

/** Extract a human-readable message from an axios error response. */
export function extractApiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return fallback;
  const d = data as Record<string, unknown>;
  if (typeof d.detail === 'string') return d.detail;
  const parts = Object.entries(d)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  return parts.length ? parts.join(' · ') : fallback;
}

export function formatDate(dateString: string, options?: Intl.DateTimeFormatOptions): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(date);
}

export function formatRelativeTime(dateString: string): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return formatDate(dateString);
}

export function getDaysUntil(dateString: string): number {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function getOccupancyRate(occupied: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((occupied / total) * 100);
}

export function getStatusColor(status: string): string {
  const statusColors: Record<string, string> = {
    active: 'text-emerald-700 bg-emerald-50',
    available: 'text-emerald-700 bg-emerald-50',
    occupied: 'text-blue-700 bg-blue-50',
    maintenance: 'text-orange-700 bg-orange-50',
    expired: 'text-red-700 bg-red-50',
    pending: 'text-yellow-700 bg-yellow-50',
    terminated: 'text-red-700 bg-red-50',
    open: 'text-blue-700 bg-blue-50',
    in_progress: 'text-orange-700 bg-orange-50',
    completed: 'text-emerald-700 bg-emerald-50',
    cancelled: 'text-gray-700 bg-gray-50',
    draft: 'text-gray-700 bg-gray-50',
    reserved: 'text-purple-700 bg-purple-50',
    scheduled: 'text-blue-700 bg-blue-50',
    pending_approval: 'text-yellow-700 bg-yellow-50',
    low: 'text-gray-700 bg-gray-50',
    medium: 'text-yellow-700 bg-yellow-50',
    high: 'text-orange-700 bg-orange-50',
    urgent: 'text-red-700 bg-red-50',
    flagged: 'text-red-700 bg-red-50',
    approved: 'text-emerald-700 bg-emerald-50',
    reviewed: 'text-blue-700 bg-blue-50',
  };
  return statusColors[status] ?? 'text-gray-700 bg-gray-50';
}

export function truncate(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

export function capitalizeFirst(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export function fileNameFromUrl(url: string | null | undefined, fallback = 'Document'): string {
  if (!url) return fallback;
  // Strip the signed-token query string BEFORE taking the basename — the token
  // itself contains slashes, so splitting on '/' first grabs the token tail.
  const path = url.split('?')[0];
  const base = decodeURIComponent(path.split('/').pop() ?? '');
  if (!base) return fallback;
  // Hide Django's duplicate-name suffix (e.g. "lease_kz0hyfL.pdf" → "lease.pdf").
  return base.replace(/_[A-Za-z0-9]{7}(\.[A-Za-z0-9]+)$/, '$1');
}
