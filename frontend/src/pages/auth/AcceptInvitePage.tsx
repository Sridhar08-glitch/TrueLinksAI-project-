import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, User, Eye, EyeOff, AlertCircle, ArrowLeft } from 'lucide-react';
import { authApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { extractApiError } from '../../lib/utils';

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) { setError('Please choose a username.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await authApi.acceptInvitation(token, username.trim(), password);
      const { access, refresh, user } = res.data;
      // Store tokens + user exactly like login does
      setTokens(access, refresh);
      setUser(user);
      navigate('/tenant', { replace: true });
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to accept invitation. The link may have expired.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-800 flex items-center justify-center p-4">
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: `radial-gradient(circle at 25px 25px, white 2px, transparent 0)`,
        backgroundSize: '50px 50px'
      }} />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur rounded-2xl mb-4 border border-white/20 overflow-hidden">
            <img src="/logo.png" alt="Logo" className="w-16 h-16 rounded-2xl" />
          </div>
          <h1 className="text-3xl font-bold text-white">Sridhar</h1>
          <p className="text-blue-200/80 text-sm mt-1">Resident Portal Invitation</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {!token ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Invalid invitation link</h2>
              <p className="text-sm text-gray-500 mb-6">
                This link is missing its invitation token. Ask your property manager to resend the invitation.
              </p>
              <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
                <ArrowLeft className="w-4 h-4" /> Go to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">Welcome aboard</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Create your resident account to access your unit, maintenance requests and documents.
                </p>
              </div>
              {error && (
                <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value); setError(''); }}
                      placeholder="Choose a username"
                      autoComplete="username"
                      autoFocus
                      className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(''); }}
                      placeholder="Min 8 characters"
                      autoComplete="new-password"
                      className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => { setConfirm(e.target.value); setError(''); }}
                      placeholder="Repeat your password"
                      autoComplete="new-password"
                      className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors duration-150 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Creating account…' : 'Accept Invitation'}
                </button>
              </form>
              <div className="mt-6 pt-5 border-t border-gray-100 text-center">
                <p className="text-xs text-gray-400">
                  Already have an account?{' '}
                  <Link to="/login" className="text-blue-600 hover:underline font-medium">Sign in</Link>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
