import { useState } from 'react';
import { Download, FileSpreadsheet, Home, Wrench } from 'lucide-react';
import { reportsApi } from '../lib/api';
import { extractApiError } from '../lib/utils';
import { useToast } from '../components/ui/Toast';

interface ReportDef {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  iconClass: string;
  fetcher: () => Promise<{ data: Blob }>;
  filename: string;
}

const REPORTS: ReportDef[] = [
  {
    key: 'rent-roll',
    title: 'Rent Roll',
    description: 'One row per approved active lease: property, building, unit, tenant, dates, rent and currency.',
    icon: <FileSpreadsheet className="w-5 h-5" />,
    iconClass: 'bg-purple-50 text-purple-600',
    fetcher: reportsApi.rentRoll,
    filename: 'rent-roll.csv',
  },
  {
    key: 'occupancy',
    title: 'Occupancy',
    description: 'One row per unit: property, building, unit, type, occupancy status, current tenant and move-in date.',
    icon: <Home className="w-5 h-5" />,
    iconClass: 'bg-emerald-50 text-emerald-600',
    fetcher: reportsApi.occupancy,
    filename: 'occupancy.csv',
  },
  {
    key: 'work-orders',
    title: 'Work Orders',
    description: 'One row per work order: unit, title, status, priority, assignee, created and completed dates.',
    icon: <Wrench className="w-5 h-5" />,
    iconClass: 'bg-orange-50 text-orange-600',
    fetcher: reportsApi.workOrders,
    filename: 'work-orders.csv',
  },
];

export default function ReportsPage() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = async (report: ReportDef) => {
    setDownloading(report.key);
    try {
      const res = await report.fetcher();
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = report.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(`${report.title} downloaded`);
    } catch (err) {
      toast(extractApiError(err, `Failed to download ${report.title}`), 'error');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">Export portfolio data as CSV for spreadsheets and accounting.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((report) => (
          <div key={report.key} className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${report.iconClass}`}>
              {report.icon}
            </div>
            <h2 className="text-sm font-semibold text-slate-900 mt-3">{report.title}</h2>
            <p className="text-sm text-slate-500 mt-1 flex-1">{report.description}</p>
            <button
              onClick={() => download(report)}
              disabled={downloading !== null}
              className="mt-4 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {downloading === report.key ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <Download className="w-4 h-4" />
              )}
              Download CSV
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
