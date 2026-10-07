import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDollarSign, TrendingUp, Undo2, Wallet, X } from 'lucide-react';
import { paymentsApi } from '../lib/api';
import type { PaginatedResponse, PaymentScheduleItem, PaymentsSummary } from '../types';
import { extractApiError, formatCurrency, formatDate } from '../lib/utils';
import { Badge } from '../components/ui/Badge';
import { QueryError } from '../components/ui/QueryError';
import { useToast } from '../components/ui/Toast';

const PAGE_SIZE = 25;

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'other'];

const STATUS_VARIANT: Record<PaymentScheduleItem['status'], 'success' | 'warning' | 'error'> = {
  paid: 'success',
  pending: 'warning',
  overdue: 'error',
};

const ic =
  'w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white';

function SummaryCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: 'red' | 'green' | 'blue' | 'slate';
}) {
  const accentClass =
    accent === 'red'
      ? 'bg-red-50 text-red-600'
      : accent === 'green'
        ? 'bg-emerald-50 text-emerald-600'
        : accent === 'blue'
          ? 'bg-blue-50 text-blue-600'
          : 'bg-slate-100 text-slate-600';
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${accentClass}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-lg font-semibold text-slate-900 truncate">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function MarkPaidDialog({
  payment,
  onClose,
}: {
  payment: PaymentScheduleItem;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(payment.amount));
  const [method, setMethod] = useState('bank_transfer');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      paymentsApi.markPaid(payment.id, {
        paid_amount: Number(amount),
        payment_method: method,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['payments-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast('Payment recorded');
      onClose();
    },
    onError: (err) => toast(extractApiError(err, 'Failed to record payment'), 'error'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-900">Record payment</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {payment.lease_tenant_name ?? 'Tenant'} · {payment.unit_label ?? `Lease #${payment.lease}`} · due{' '}
          {formatDate(payment.due_date)}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Amount received ({payment.currency})</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={ic}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={ic} placeholder="Reference #, remarks…" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !amount || Number(amount) < 0}
            className="px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Mark paid'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PaymentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [dueAfter, setDueAfter] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const [page, setPage] = useState(1);
  const [markPaidTarget, setMarkPaidTarget] = useState<PaymentScheduleItem | null>(null);

  const params = useMemo(() => {
    const p: Record<string, unknown> = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    if (statusFilter) p.status = statusFilter;
    if (dueAfter) p.due_after = dueAfter;
    if (dueBefore) p.due_before = dueBefore;
    return p;
  }, [statusFilter, dueAfter, dueBefore, page]);

  const summaryQuery = useQuery({
    queryKey: ['payments-summary'],
    queryFn: async () => (await paymentsApi.summary()).data as PaymentsSummary,
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['payments', params],
    queryFn: async () => (await paymentsApi.getAll(params)).data as PaginatedResponse<PaymentScheduleItem>,
  });

  const markUnpaid = useMutation({
    mutationFn: (id: number) => paymentsApi.markUnpaid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['payments-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast('Payment reverted to pending');
    },
    onError: (err) => toast(extractApiError(err, 'Failed to revert payment'), 'error'),
  });

  const payments = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const summary = summaryQuery.data;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Payments</h1>
        <p className="text-sm text-slate-500 mt-1">Rent schedule, collections and arrears across all approved leases.</p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard
            label="Due this month"
            value={formatCurrency(summary.total_due_this_month)}
            icon={<CircleDollarSign className="w-4 h-4" />}
            accent="blue"
          />
          <SummaryCard
            label="Collected this month"
            value={formatCurrency(summary.collected_this_month)}
            sub={`${summary.collection_rate_pct}% collection rate`}
            icon={<TrendingUp className="w-4 h-4" />}
            accent="green"
          />
          <SummaryCard
            label="Overdue payments"
            value={String(summary.overdue_count)}
            icon={<AlertTriangle className="w-4 h-4" />}
            accent={summary.overdue_count > 0 ? 'red' : 'slate'}
          />
          <SummaryCard
            label="Overdue amount"
            value={formatCurrency(summary.overdue_amount)}
            icon={<Wallet className="w-4 h-4" />}
            accent={summary.overdue_amount > 0 ? 'red' : 'slate'}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className={`${ic} w-40`}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Due after</label>
          <input
            type="date"
            value={dueAfter}
            onChange={(e) => {
              setDueAfter(e.target.value);
              setPage(1);
            }}
            className={`${ic} w-40`}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Due before</label>
          <input
            type="date"
            value={dueBefore}
            onChange={(e) => {
              setDueBefore(e.target.value);
              setPage(1);
            }}
            className={`${ic} w-40`}
          />
        </div>
        {(statusFilter || dueAfter || dueBefore) && (
          <button
            onClick={() => {
              setStatusFilter('');
              setDueAfter('');
              setDueBefore('');
              setPage(1);
            }}
            className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {isError ? (
        <QueryError label="payments" onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : payments.length === 0 ? (
        <div className="border border-dashed border-slate-300 rounded-lg p-10 text-center">
          <Wallet className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">
            No payment items found. Schedules are generated automatically when a lease is approved — or open a lease and
            use “Generate schedule”.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-3 font-medium">Due date</th>
                  <th className="px-4 py-3 font-medium">Tenant / Unit</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Paid</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id} className={p.status === 'overdue' ? 'bg-red-50/40' : undefined}>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-900">{formatDate(p.due_date)}</td>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">{p.lease_tenant_name ?? '—'}</p>
                      <p className="text-xs text-slate-500">{p.unit_label ?? `Lease #${p.lease}`}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-900">
                      {formatCurrency(Number(p.amount), p.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={p.status.charAt(0).toUpperCase() + p.status.slice(1)} variant={STATUS_VARIANT[p.status]} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {p.status === 'paid' && p.paid_at ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {formatDate(p.paid_at)}
                          </span>
                          {p.payment_method && <span className="ml-1">· {p.payment_method.replace('_', ' ')}</span>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {p.status === 'paid' ? (
                        <button
                          onClick={() => markUnpaid.mutate(p.id)}
                          disabled={markUnpaid.isPending}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          title="Revert to pending"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          Mark unpaid
                        </button>
                      ) : (
                        <button
                          onClick={() => setMarkPaidTarget(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pager */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
              <p className="text-slate-500">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {markPaidTarget && <MarkPaidDialog payment={markPaidTarget} onClose={() => setMarkPaidTarget(null)} />}
    </div>
  );
}
