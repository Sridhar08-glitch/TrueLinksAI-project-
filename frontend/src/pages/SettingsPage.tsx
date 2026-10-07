import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Lock, Bell, Shield, Save, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../lib/api';
import { Button } from '../components/ui/Button';

const NOTIFICATION_ITEMS = [
  { key: 'lease_expirations', label: 'Lease Expirations', description: 'Get notified when leases are about to expire', defaultOn: true },
  { key: 'work_order_updates', label: 'Work Order Updates', description: 'Receive updates on work order status changes', defaultOn: true },
  { key: 'payment_reminders', label: 'Payment Reminders', description: 'Get alerted about upcoming and overdue payments', defaultOn: true },
  { key: 'new_applications', label: 'New Tenant Applications', description: 'Be notified when new applications are submitted', defaultOn: false },
  { key: 'inspection_reports', label: 'Inspection Reports', description: 'Receive completed inspection report notifications', defaultOn: true },
  { key: 'ai_lease_alerts', label: 'AI Lease Review Alerts', description: 'Get notified when AI detects issues in leases', defaultOn: true },
] as const;

const profileSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
});

const passwordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password: z.string().min(1, 'Please confirm your new password'),
}).refine((d) => d.new_password === d.confirm_password, {
  message: "Passwords don't match",
  path: ['confirm_password'],
});

type ProfileFormData = z.infer<typeof profileSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;

const TABS = [
  { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
  { id: 'security', label: 'Security', icon: <Lock className="w-4 h-4" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
];

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('profile');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(
    () => Object.fromEntries(NOTIFICATION_ITEMS.map(i => [i.key, i.defaultOn]))
  );
  const [notifSaved, setNotifSaved] = useState(false);
  const { setUser } = useAuthStore();

  const {
    register: registerProfile,
    handleSubmit: handleProfileSubmit,
    formState: { errors: profileErrors, isSubmitting: profileSubmitting },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
    },
  });

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    reset: resetPassword,
    formState: { errors: passwordErrors, isSubmitting: passwordSubmitting },
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  });

  const onProfileSave = async (data: ProfileFormData) => {
    setProfileError('');
    try {
      const res = await authApi.updateProfile(data as Record<string, unknown>);
      setUser(res.data);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch {
      setProfileError('Failed to save. Please try again.');
    }
  };

  const onPasswordSave = async (data: PasswordFormData) => {
    setPasswordError('');
    try {
      // Backend contract: expects old_password + new_password
      await authApi.changePassword({
        old_password: data.current_password,
        new_password: data.new_password,
      });
      setPasswordSaved(true);
      resetPassword();
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
      const pick = (v: unknown): string | undefined =>
        Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : undefined) : typeof v === 'string' ? v : undefined;
      const msg =
        pick(resp?.old_password) ||
        pick(resp?.new_password) ||
        pick(resp?.detail) ||
        'Failed to change password. Please try again.';
      setPasswordError(msg);
    }
  };

  const fullName = user ? `${user.first_name} ${user.last_name}`.trim() || user.email : 'User';

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your account and preferences</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <div className="w-44 flex-shrink-0">
          <nav className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors border-b border-gray-50 last:border-b-0 ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className={activeTab === tab.id ? 'text-white' : 'text-gray-400'}>
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-w-0">
          {activeTab === 'profile' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-slate-900">Profile Information</h2>
                <p className="text-xs text-gray-500 mt-0.5">Update your personal details</p>
              </div>
              <div className="p-6">
                {/* Avatar */}
                <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-xl font-bold text-white">{fullName.charAt(0).toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{fullName}</p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                    <button className="text-xs text-blue-600 hover:text-blue-700 font-medium mt-1">
                      Change avatar
                    </button>
                  </div>
                </div>

                <form onSubmit={handleProfileSubmit(onProfileSave)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">First Name</label>
                      <input
                        {...registerProfile('first_name')}
                        className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${profileErrors.first_name ? 'border-red-300' : 'border-gray-300'}`}
                      />
                      {profileErrors.first_name && (
                        <p className="text-xs text-red-600 mt-1">{profileErrors.first_name.message}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Last Name</label>
                      <input
                        {...registerProfile('last_name')}
                        className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${profileErrors.last_name ? 'border-red-300' : 'border-gray-300'}`}
                      />
                      {profileErrors.last_name && (
                        <p className="text-xs text-red-600 mt-1">{profileErrors.last_name.message}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
                    <input
                      {...registerProfile('email')}
                      type="email"
                      className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${profileErrors.email ? 'border-red-300' : 'border-gray-300'}`}
                    />
                    {profileErrors.email && (
                      <p className="text-xs text-red-600 mt-1">{profileErrors.email.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number</label>
                    <input
                      {...registerProfile('phone')}
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {profileError && (
                    <div className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <XCircle className="w-4 h-4 flex-shrink-0" />
                      {profileError}
                    </div>
                  )}
                  <div className="pt-2 flex items-center gap-3">
                    <Button type="submit" loading={profileSubmitting} icon={<Save className="w-4 h-4" />}>
                      Save Changes
                    </Button>
                    {profileSaved && (
                      <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                        <CheckCircle className="w-4 h-4" />
                        Saved successfully
                      </span>
                    )}
                  </div>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-slate-900">Security</h2>
                <p className="text-xs text-gray-500 mt-0.5">Manage your password and security settings</p>
              </div>
              <div className="p-6">
                <h3 className="text-sm font-semibold text-slate-800 mb-4">Change Password</h3>
                <form onSubmit={handlePasswordSubmit(onPasswordSave)} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Current Password</label>
                    <div className="relative">
                      <input
                        {...registerPassword('current_password')}
                        type={showCurrentPw ? 'text' : 'password'}
                        className={`w-full px-3 pr-10 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${passwordErrors.current_password ? 'border-red-300' : 'border-gray-300'}`}
                      />
                      <button type="button" onClick={() => setShowCurrentPw(!showCurrentPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {passwordErrors.current_password && (
                      <p className="text-xs text-red-600 mt-1">{passwordErrors.current_password.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                    <div className="relative">
                      <input
                        {...registerPassword('new_password')}
                        type={showNewPw ? 'text' : 'password'}
                        className={`w-full px-3 pr-10 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${passwordErrors.new_password ? 'border-red-300' : 'border-gray-300'}`}
                      />
                      <button type="button" onClick={() => setShowNewPw(!showNewPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {passwordErrors.new_password && (
                      <p className="text-xs text-red-600 mt-1">{passwordErrors.new_password.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm New Password</label>
                    <input
                      {...registerPassword('confirm_password')}
                      type="password"
                      className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${passwordErrors.confirm_password ? 'border-red-300' : 'border-gray-300'}`}
                    />
                    {passwordErrors.confirm_password && (
                      <p className="text-xs text-red-600 mt-1">{passwordErrors.confirm_password.message}</p>
                    )}
                  </div>
                  {passwordError && (
                    <div className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <XCircle className="w-4 h-4 flex-shrink-0" />
                      {passwordError}
                    </div>
                  )}
                  <div className="pt-2 flex items-center gap-3">
                    <Button type="submit" loading={passwordSubmitting} icon={<Lock className="w-4 h-4" />}>
                      Update Password
                    </Button>
                    {passwordSaved && (
                      <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                        <CheckCircle className="w-4 h-4" />
                        Password updated
                      </span>
                    )}
                  </div>
                </form>

                <div className="mt-8 pt-6 border-t border-gray-100">
                  <div className="flex items-center gap-3 mb-4">
                    <Shield className="w-5 h-5 text-blue-500" />
                    <h3 className="text-sm font-semibold text-slate-800">Two-Factor Authentication</h3>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">Add an extra layer of security to your account.</p>
                  <Button variant="outline" size="sm">Enable 2FA</Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-slate-900">Notification Preferences</h2>
                <p className="text-xs text-gray-500 mt-0.5">Choose what notifications you receive</p>
              </div>
              <div className="p-6 space-y-5">
                {NOTIFICATION_ITEMS.map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-b-0">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{item.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={notifPrefs[item.key]}
                        onChange={(e) => setNotifPrefs(p => ({ ...p, [item.key]: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
                    </label>
                  </div>
                ))}
                <div className="pt-2 flex items-center gap-3">
                  <Button
                    icon={<Save className="w-4 h-4" />}
                    onClick={() => {
                      setNotifSaved(true);
                      setTimeout(() => setNotifSaved(false), 3000);
                    }}
                  >
                    Save Preferences
                  </Button>
                  {notifSaved && (
                    <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                      <CheckCircle className="w-4 h-4" />
                      Saved
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
