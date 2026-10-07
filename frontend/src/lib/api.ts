import axios, { type AxiosInstance, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios';

const BASE_URL = '/api/v1';

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor: attach JWT token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('access_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: auto-refresh on 401
let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refresh_token');

      if (!refreshToken) {
        isRefreshing = false;
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const response = await axios.post(`${BASE_URL}/users/token/refresh/`, {
          refresh: refreshToken,
        });

        const { access, refresh: rotatedRefresh } = response.data;
        localStorage.setItem('access_token', access);
        // Token rotation: persist the new refresh token when the backend returns one
        if (rotatedRefresh) {
          localStorage.setItem('refresh_token', rotatedRefresh);
        }

        api.defaults.headers.common.Authorization = `Bearer ${access}`;
        originalRequest.headers.Authorization = `Bearer ${access}`;

        processQueue(null, access);
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/users/login/', { email, password }),
  register: (data: Record<string, unknown>) =>
    api.post('/users/register/', data),
  me: () => api.get('/users/me/'),
  logout: (refresh?: string | null) =>
    api.post('/users/logout/', refresh ? { refresh } : {}),
  refreshToken: (refresh: string) =>
    api.post('/users/token/refresh/', { refresh }),
  updateProfile: (data: Record<string, unknown>) =>
    api.patch('/users/me/', data),
  changePassword: (data: Record<string, unknown>) =>
    api.post('/users/change-password/', data),
  requestPasswordReset: (email: string) =>
    api.post('/users/password-reset/', { email }),
  confirmPasswordReset: (uid: string, token: string, new_password: string) =>
    api.post('/users/password-reset/confirm/', { uid, token, new_password }),
  acceptInvitation: (token: string, username: string, password: string) =>
    api.post('/users/invite/accept/', { token, username, password }),
};

// ── Staff / User management (owner-only) ─────────────────────────────────────
export const staffApi = {
  list: (params?: Record<string, unknown>) => api.get('/users/staff/', { params }),
  create: (data: {
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    role: 'property_manager' | 'maintenance_staff';
  }) => api.post('/users/staff/create/', data),
  update: (userId: number, data: Record<string, unknown>) =>
    api.patch(`/users/staff/${userId}/`, data),
  deactivate: (userId: number) => api.delete(`/users/staff/${userId}/`),
  listAll: () => api.get('/users/list/'),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats/'),
  monthlyStats: () => api.get('/dashboard/monthly-stats/'),
};

// ── Ownership Entities ────────────────────────────────────────────────────────
export const ownershipEntitiesApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/ownership-entities/', { params }),
  getById: (id: number) => api.get(`/ownership-entities/${id}/`),
  create: (data: Record<string, unknown>) => api.post('/ownership-entities/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/ownership-entities/${id}/`, data),
  delete: (id: number) => api.delete(`/ownership-entities/${id}/`),
};

// ── Properties ────────────────────────────────────────────────────────────────
export const propertiesApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/properties/', { params }),
  getById: (id: number) => api.get(`/properties/${id}/`),
  create: (data: Record<string, unknown>) => api.post('/properties/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/properties/${id}/`, data),
  delete: (id: number) => api.delete(`/properties/${id}/`),
};

// ── Buildings ─────────────────────────────────────────────────────────────────
export const buildingsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/buildings/', { params }),
  getById: (id: number) => api.get(`/buildings/${id}/`),
  create: (data: Record<string, unknown>) => api.post('/buildings/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/buildings/${id}/`, data),
  delete: (id: number) => api.delete(`/buildings/${id}/`),
};

// ── Units ─────────────────────────────────────────────────────────────────────
export const unitsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/units/', { params }),
  getById: (id: number) => api.get(`/units/${id}/`),
  create: (data: Record<string, unknown>) => api.post('/units/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/units/${id}/`, data),
  delete: (id: number) => api.delete(`/units/${id}/`),
  archive: (id: number, actor?: string) => api.post(`/units/${id}/archive/`, { actor }),
  unarchive: (id: number, actor?: string) => api.post(`/units/${id}/unarchive/`, { actor }),
  overview: (id: number) => api.get(`/units/${id}/overview/`),
};

// ── Leases ────────────────────────────────────────────────────────────────────
export const leasesApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/leases/', { params }),
  getById: (id: number) => api.get(`/leases/${id}/`),
  getCancelled: () => api.get('/leases/cancelled/'),
  createManual: (data: Record<string, unknown>) => api.post('/leases/', data),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('document', file);
    return api.post('/leases/upload/', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  process: (id: number) => api.post(`/leases/${id}/process/`),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/leases/${id}/`, data),
  approve: (id: number, approved_by?: string) => api.post(`/leases/${id}/approve/`, { approved_by }),
  reject: (id: number, rejected_by?: string, reason?: string) =>
    api.post(`/leases/${id}/reject/`, { rejected_by, reason }),
  cancel: (id: number, cancel_reason: string, cancelled_by: string) =>
    api.post(`/leases/${id}/cancel/`, { cancel_reason, cancelled_by }),
  resolveUnit: (id: number, unit_id: number, resolved_by: string) =>
    api.post(`/leases/${id}/resolve-unit/`, { unit_id, resolved_by }),
  getFields: (id: number) => api.get(`/leases/${id}/fields/`),
  getValidations: (id: number) => api.get(`/leases/${id}/validations/`),
  revalidate: (id: number) => api.post(`/leases/${id}/revalidate/`),
  getFlags: (id: number) => api.get(`/leases/${id}/flags/`),
  getClauses: (id: number) => api.get(`/leases/${id}/clauses/`),
  generateSchedule: (id: number) => api.post(`/leases/${id}/generate-schedule/`),
  ask: (id: number, question: string) => api.post(`/leases/${id}/ask/`, { question }),
};

// ── Payments ──────────────────────────────────────────────────────────────────
export const paymentsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/payments/', { params }),
  summary: () => api.get('/payments/summary/'),
  markPaid: (id: number, data?: { paid_amount?: number; payment_method?: string; notes?: string }) =>
    api.post(`/payments/${id}/mark-paid/`, data ?? {}),
  markUnpaid: (id: number) => api.post(`/payments/${id}/mark-unpaid/`),
};

// ── Reports (CSV blobs — require the Authorization header) ───────────────────
export const reportsApi = {
  rentRoll: () => api.get('/reports/rent-roll/', { responseType: 'blob' }),
  occupancy: () => api.get('/reports/occupancy/', { responseType: 'blob' }),
  workOrders: () => api.get('/reports/work-orders/', { responseType: 'blob' }),
};

// ── Lease Fields ──────────────────────────────────────────────────────────────
export const leaseFieldsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/lease-fields/', { params }),
  approve: (id: number, reviewed_by: string, reviewed_value?: unknown) =>
    api.post(`/lease-fields/${id}/approve/`, { reviewed_by, reviewed_value }),
  reject: (id: number, reviewed_by: string, reason?: string) =>
    api.post(`/lease-fields/${id}/reject/`, { reviewed_by, reason }),
  bulkApprove: (ids: number[], reviewed_by: string) =>
    api.post('/lease-fields/bulk-approve/', { ids, reviewed_by }),
};

// ── Lease Flags ───────────────────────────────────────────────────────────────
export const leaseFlagsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/lease-flags/', { params }),
  getById: (id: number) => api.get(`/lease-flags/${id}/`),
  review: (id: number, action: 'acknowledge' | 'resolve' | 'dismiss', reviewed_by: string, reviewer_comment?: string) =>
    api.post(`/lease-flags/${id}/review/`, { action, reviewed_by, reviewer_comment }),
};

// ── Lease Clauses ─────────────────────────────────────────────────────────────
export const leaseClausesApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/lease-clauses/', { params }),
  getById: (id: number) => api.get(`/lease-clauses/${id}/`),
  create: (data: Record<string, unknown>) => api.post('/lease-clauses/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/lease-clauses/${id}/`, data),
  delete: (id: number) => api.delete(`/lease-clauses/${id}/`),
  review: (id: number, review_status: string, reviewed_by: string) =>
    api.post(`/lease-clauses/${id}/review/`, { review_status, reviewed_by }),
};

// ── Work Orders ───────────────────────────────────────────────────────────────
export const workOrdersApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/work-orders/', { params }),
  getById: (id: number) => api.get(`/work-orders/${id}/`),
  create: (data: Record<string, unknown>) => api.post('/work-orders/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/work-orders/${id}/`, data),
  delete: (id: number) => api.delete(`/work-orders/${id}/`),
  approve: (id: number) => api.post(`/work-orders/${id}/approve/`),
  reject: (id: number, rejection_reason: string) => api.post(`/work-orders/${id}/reject/`, { rejection_reason }),
  start: (id: number) => api.post(`/work-orders/${id}/start/`),
  complete: (id: number) => api.post(`/work-orders/${id}/complete/`),
  bulkApprove: (ids: number[]) => api.post('/work-orders/bulk-approve/', { ids }),
  bulkReject: (ids: number[], rejection_reason?: string) =>
    api.post('/work-orders/bulk-reject/', { ids, rejection_reason }),
  bulkDelete: (ids: number[]) => api.post('/work-orders/bulk-delete/', { ids }),
  assign: (id: number, user_id: number) => api.post(`/work-orders/${id}/assign/`, { user_id }),
  unassign: (id: number) => api.post(`/work-orders/${id}/unassign/`),
  verification: (id: number) => api.get(`/work-orders/${id}/verification/`),
};

// ── Inspections ───────────────────────────────────────────────────────────────
export const inspectionsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/inspections/', { params }),
  getById: (id: number) => api.get(`/inspections/${id}/`),
  getDeleted: () => api.get('/inspections/deleted/'),
  create: (data: Record<string, unknown>) => api.post('/inspections/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/inspections/${id}/`, data),
  delete: (id: number) => api.post(`/inspections/${id}/delete/`),
  uploadImages: (id: number, files: File[]) => {
    const fd = new FormData();
    files.forEach(f => fd.append('images', f));
    return api.post(`/inspections/${id}/images/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  analyze: (id: number) => api.post(`/inspections/${id}/analyze/`),
};

// ── Inspection Schedules ──────────────────────────────────────────────────────
export const inspectionSchedulesApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/inspection-schedules/', { params }),
  getById: (id: number) => api.get(`/inspection-schedules/${id}/`),
  create: (data: Record<string, unknown>) => api.post('/inspection-schedules/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/inspection-schedules/${id}/`, data),
  delete: (id: number) => api.delete(`/inspection-schedules/${id}/`),
  runNow: (id: number) => api.post(`/inspection-schedules/${id}/run-now/`),
};

// ── Inspection Findings ───────────────────────────────────────────────────────
export const inspectionFindingsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/inspection-findings/', { params }),
  getById: (id: number) => api.get(`/inspection-findings/${id}/`),
  create: (data: Record<string, unknown>) => api.post('/inspection-findings/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/inspection-findings/${id}/`, data),
  delete: (id: number) => api.delete(`/inspection-findings/${id}/`),
  review: (id: number, review_status: 'confirmed' | 'dismissed', reviewer?: string) =>
    api.post(`/inspection-findings/${id}/review/`, { review_status, reviewer }),
};

// ── Audit Events ──────────────────────────────────────────────────────────────
export const auditEventsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/audit-events/', { params }),
};

// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/notifications/', { params }),
  markRead: (id: number) => api.post(`/notifications/${id}/mark_read/`),
  markAllRead: () => api.post('/notifications/mark_all_read/'),
};

// ── Tenants ───────────────────────────────────────────────────────────────────
export const tenantsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/users/tenants/', { params }),
  create: (data: Record<string, unknown>) => api.post('/users/tenants/create/', data),
  update: (userId: number, data: Record<string, unknown>) => api.patch(`/users/tenants/${userId}/`, data),
  deactivate: (userId: number) => api.delete(`/users/tenants/${userId}/`),
  getAssignments: (params?: Record<string, unknown>) => api.get('/users/assignments/', { params }),
  createAssignment: (tenant_id: number, unit_id: number, move_in_date?: string) =>
    api.post('/users/assignments/', { tenant_id, unit_id, move_in_date }),
  endAssignment: (id: number, move_out_date?: string) =>
    api.post(`/users/assignments/${id}/end/`, { move_out_date }),
  getInvitations: (params?: Record<string, unknown>) => api.get('/users/invitations/', { params }),
  sendInvitation: (data: Record<string, unknown>) => api.post('/users/invitations/', data),
  revokeInvitation: (id: number) => api.post(`/users/invitations/${id}/revoke/`),
  resendInvitation: (id: number) => api.post(`/users/invitations/${id}/resend/`),
};

// ── Tenant self-service ───────────────────────────────────────────────────────
export const tenantApi = {
  myInfo: () => api.get('/users/my-info/'),
  submitMaintenance: (data: FormData | Record<string, unknown>) => {
    const isFormData = data instanceof FormData;
    return api.post('/users/my-info/', data, isFormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {});
  },
};

// ── Validation Results ────────────────────────────────────────────────────────
export const validationsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/validations/', { params }),
  override: (id: number, reason: string) => api.post(`/validations/${id}/override/`, { reason }),
  clearOverride: (id: number) => api.post(`/validations/${id}/clear-override/`),
};

// ── Owner lease rules (owner_ruleset.json) ───────────────────────────────────
export const leaseRulesApi = {
  getAll: () => api.get('/lease-rules/'),
  update: (ruleId: string, data: Record<string, unknown>) =>
    api.patch(`/lease-rules/${ruleId}/`, data),
  importJson: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/lease-rules/import/', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ── Rule proposals (policy-document import, Rules Agent) ────────────────────
export const ruleProposalsApi = {
  getAll: (params?: Record<string, string>) => api.get('/rule-proposals/', { params }),
  upload: (file: File) => {
    const form = new FormData();
    form.append('document', file);
    // Local AI analysis of a policy document can take minutes — don't use the default 30s timeout.
    return api.post('/rule-proposals/upload/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 360000,
    });
  },
  approve: (id: number) => api.post(`/rule-proposals/${id}/approve/`),
  reject: (id: number, reason: string) => api.post(`/rule-proposals/${id}/reject/`, { reason }),
};

// ── Owner custom rules (template-based, R8+) ─────────────────────────────────
export const customRulesApi = {
  getAll: () => api.get('/custom-rules/'),
  getOptions: () => api.get('/custom-rules/options/'),
  create: (data: Record<string, unknown>) => api.post('/custom-rules/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/custom-rules/${id}/`, data),
  remove: (id: number) => api.delete(`/custom-rules/${id}/`),
};
