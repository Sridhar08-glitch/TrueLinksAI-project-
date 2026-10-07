import { useQuery } from '@tanstack/react-query';
import { FileText, Download, Eye, AlertTriangle, Clock, CheckCircle } from 'lucide-react';
import { tenantApi } from '../../lib/api';
import { formatDate, fileNameFromUrl } from '../../lib/utils';

interface LeaseRecord {
  id: number;
  tenant_name: string;
  start_date: string;
  end_date: string;
  rent_amount: string | number;
  currency: string;
  document: string | null;
  processing_status: string;
  approval_status: string;
  created_at: string;
}

function statusIcon(status: string) {
  if (status === 'approved' || status === 'completed') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (status === 'pending_review' || status === 'processing') return <Clock className="w-4 h-4 text-yellow-500" />;
  if (status === 'failed' || status === 'rejected') return <AlertTriangle className="w-4 h-4 text-red-500" />;
  return <Clock className="w-4 h-4 text-gray-400" />;
}

function statusLabel(processing: string, approval: string): string {
  if (approval === 'approved') return 'Active';
  if (processing === 'failed') return 'Failed';
  if (processing === 'processing') return 'Processing';
  if (approval === 'pending_review') return 'Under Review';
  if (approval === 'rejected') return 'Rejected';
  return processing || approval || 'Pending';
}

function statusColor(processing: string, approval: string): string {
  if (approval === 'approved') return 'text-emerald-700 bg-emerald-50 border-emerald-100';
  if (processing === 'failed' || approval === 'rejected') return 'text-red-700 bg-red-50 border-red-100';
  return 'text-yellow-700 bg-yellow-50 border-yellow-100';
}

export default function TenantDocuments() {
  const { data, isLoading, isError } = useQuery<{ leases: LeaseRecord[] }>({
    queryKey: ['tenant-my-info'],
    queryFn: async () => { const r = await tenantApi.myInfo(); return r.data; },
    staleTime: 60 * 1000,
  });

  const leases = data?.leases ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">My Documents</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your lease agreements and related documents</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle className="w-8 h-8 text-red-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Unable to load documents. Please try again later.</p>
          </div>
        ) : leases.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-8 h-8 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">No lease documents yet</p>
            <p className="text-xs text-gray-400 mt-1">Your lease agreement will appear here once uploaded by your property manager.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {leases.map(lease => {
              const label = statusLabel(lease.processing_status, lease.approval_status);
              const colorClass = statusColor(lease.processing_status, lease.approval_status);
              const rentDisplay = lease.rent_amount
                ? `${lease.currency} ${Number(lease.rent_amount).toLocaleString()}/mo`
                : null;
              const fileName = fileNameFromUrl(lease.document, 'Lease Agreement');

              return (
                <div key={lease.id} className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                  {/* Icon */}
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-800 truncate">{fileName}</p>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${colorClass}`}>
                        {statusIcon(lease.approval_status)}
                        {label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {lease.start_date && lease.end_date && (
                        <span className="text-xs text-gray-500">
                          {formatDate(lease.start_date)} — {formatDate(lease.end_date)}
                        </span>
                      )}
                      {rentDisplay && (
                        <span className="text-xs font-medium text-gray-700">{rentDisplay}</span>
                      )}
                      <span className="text-xs text-gray-400">Uploaded {formatDate(lease.created_at)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  {lease.document && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a
                        href={lease.document}
                        target="_blank"
                        rel="noreferrer"
                        title="View document"
                        className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </a>
                      <a
                        href={lease.document}
                        download
                        title="Download document"
                        className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Contact your property manager to upload additional documents.
      </p>
    </div>
  );
}
