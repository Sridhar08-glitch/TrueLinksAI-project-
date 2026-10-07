import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { AppLayout } from './components/layout/AppLayout';
import { TenantLayout } from './components/layout/TenantLayout';
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import AcceptInvitePage from './pages/auth/AcceptInvitePage';
import Dashboard from './pages/Dashboard';
import PaymentsPage from './pages/PaymentsPage';
import ReportsPage from './pages/ReportsPage';
import PropertiesPage from './pages/PropertiesPage';
import BuildingsPage from './pages/BuildingsPage';
import UnitsPage from './pages/UnitsPage';
import TenantsPage from './pages/TenantsPage';
import LeasesPage from './pages/LeasesPage';
import WorkOrdersPage from './pages/WorkOrdersPage';
import InspectionsPage from './pages/InspectionsPage';
import NotificationsPage from './pages/NotificationsPage';
import SettingsPage from './pages/SettingsPage';
import StaffPage from './pages/StaffPage';
import AuditLogPage from './pages/AuditLogPage';
import RulesPage from './pages/RulesPage';
import MaintenanceDashboard from './pages/MaintenanceDashboard';
import TenantDashboard from './pages/tenant/TenantDashboard';
import TenantMaintenance from './pages/tenant/TenantMaintenance';
import TenantDocuments from './pages/tenant/TenantDocuments';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <svg className="animate-spin w-7 h-7 text-blue-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-gray-500">Loading your workspace…</p>
      </div>
    </div>
  );
}

/** Authenticated but role unknown and not loading — clear auth and send back to login. */
function RoleFallback() {
  const logout = useAuthStore((s) => s.logout);
  useEffect(() => {
    logout();
  }, [logout]);
  return <FullPageLoader />;
}

/** Public routes available in every role tree (password reset, invitations). */
function publicRoutes() {
  return (
    <>
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite/accept" element={<AcceptInvitePage />} />
    </>
  );
}

function OwnerRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {publicRoutes()}
      <Route path="/" element={<ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>} />
      <Route path="/properties" element={<ProtectedRoute><AppLayout><PropertiesPage /></AppLayout></ProtectedRoute>} />
      <Route path="/buildings" element={<ProtectedRoute><AppLayout><BuildingsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/units" element={<ProtectedRoute><AppLayout><UnitsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/tenants" element={<ProtectedRoute><AppLayout><TenantsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/staff" element={<ProtectedRoute><AppLayout><StaffPage /></AppLayout></ProtectedRoute>} />
      <Route path="/leases" element={<ProtectedRoute><AppLayout><LeasesPage /></AppLayout></ProtectedRoute>} />
      <Route path="/ai-lease-review" element={<ProtectedRoute><AppLayout><LeasesPage /></AppLayout></ProtectedRoute>} />
      <Route path="/lease-rules" element={<ProtectedRoute><AppLayout><RulesPage /></AppLayout></ProtectedRoute>} />
      <Route path="/maintenance" element={<ProtectedRoute><AppLayout><WorkOrdersPage /></AppLayout></ProtectedRoute>} />
      <Route path="/work-orders" element={<ProtectedRoute><AppLayout><WorkOrdersPage /></AppLayout></ProtectedRoute>} />
      <Route path="/inspections" element={<ProtectedRoute><AppLayout><InspectionsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/payments" element={<ProtectedRoute><AppLayout><PaymentsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/audit" element={<ProtectedRoute><AppLayout><AuditLogPage /></AppLayout></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><AppLayout><ReportsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><AppLayout><NotificationsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PropertyManagerRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {publicRoutes()}
      <Route path="/" element={<ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>} />
      <Route path="/properties" element={<ProtectedRoute><AppLayout><PropertiesPage /></AppLayout></ProtectedRoute>} />
      <Route path="/buildings" element={<ProtectedRoute><AppLayout><BuildingsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/units" element={<ProtectedRoute><AppLayout><UnitsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/tenants" element={<ProtectedRoute><AppLayout><TenantsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/leases" element={<ProtectedRoute><AppLayout><LeasesPage /></AppLayout></ProtectedRoute>} />
      <Route path="/ai-lease-review" element={<ProtectedRoute><AppLayout><LeasesPage /></AppLayout></ProtectedRoute>} />
      <Route path="/maintenance" element={<ProtectedRoute><AppLayout><WorkOrdersPage /></AppLayout></ProtectedRoute>} />
      <Route path="/work-orders" element={<ProtectedRoute><AppLayout><WorkOrdersPage /></AppLayout></ProtectedRoute>} />
      <Route path="/inspections" element={<ProtectedRoute><AppLayout><InspectionsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/payments" element={<ProtectedRoute><AppLayout><PaymentsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><AppLayout><ReportsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/audit" element={<ProtectedRoute><AppLayout><AuditLogPage /></AppLayout></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><AppLayout><NotificationsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function MaintenanceStaffRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {publicRoutes()}
      <Route path="/" element={<ProtectedRoute><AppLayout><MaintenanceDashboard /></AppLayout></ProtectedRoute>} />
      <Route path="/work-orders" element={<ProtectedRoute><AppLayout><WorkOrdersPage /></AppLayout></ProtectedRoute>} />
      <Route path="/maintenance" element={<ProtectedRoute><AppLayout><WorkOrdersPage /></AppLayout></ProtectedRoute>} />
      <Route path="/inspections" element={<ProtectedRoute><AppLayout><InspectionsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><AppLayout><NotificationsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function TenantRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {publicRoutes()}
      <Route path="/tenant" element={<ProtectedRoute><TenantLayout><TenantDashboard /></TenantLayout></ProtectedRoute>} />
      <Route path="/tenant/maintenance" element={<ProtectedRoute><TenantLayout><TenantMaintenance /></TenantLayout></ProtectedRoute>} />
      <Route path="/tenant/documents" element={<ProtectedRoute><TenantLayout><TenantDocuments /></TenantLayout></ProtectedRoute>} />
      <Route path="/tenant/notifications" element={<ProtectedRoute><TenantLayout><NotificationsPage /></TenantLayout></ProtectedRoute>} />
      <Route path="/tenant/profile" element={<ProtectedRoute><TenantLayout><TenantDashboard /></TenantLayout></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/tenant" replace />} />
    </Routes>
  );
}

export default function App() {
  const { initializeAuth, user, isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  if (!isAuthenticated) return <OwnerRoutes />;

  const role = user?.role;
  if (role === 'tenant') return <TenantRoutes />;
  if (role === 'maintenance_staff') return <MaintenanceStaffRoutes />;
  if (role === 'property_manager') return <PropertyManagerRoutes />;
  if (role === 'owner') return <OwnerRoutes />;

  // Authenticated but role missing/unknown: hold rendering while me() resolves,
  // otherwise clear the session and go back to login.
  if (isLoading) return <FullPageLoader />;
  return <RoleFallback />;
}
