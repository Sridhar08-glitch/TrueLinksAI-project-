import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { authApi } from '../../lib/api';
import { extractApiError } from '../../lib/utils';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const uid = searchParams.get('uid') ?? '';
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const missingParams = !uid || !token;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError('');
    setSubmitting(true);
    try {
      await authApi.confirmPasswordReset(uid, token, password);
      setDone(true);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to reset password. The link may have expired.'));
    } finally {
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
          <p className="text-blue-200/80 text-sm mt-1">Property Management Platform</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {done ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Password reset</h2>
              <p className="text-sm text-gray-500 mb-6">
                Your password has been updated. You can now sign in with your new password.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center justify-center w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 rounded-lg transition-colors"
              >
                Go to Sign In
              </Link>
            </div>
          ) : missingParams ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Invalid reset link</h2>
              <p className="text-sm text-gray-500 mb-6">
                This link is missing its reset token. Request a new one from the forgot-password page.
              </p>
              <Link to="/forgot-password" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
                <ArrowLeft className="w-4 h-4" /> Request a new link
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">Set a new password</h2>
                <p className="text-sm text-gray-500 mt-1">Choose a strong password (min 8 characters).</p>
              </div>
              {error && (
                <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(''); }}
                      placeholder="Min 8 characters"
                      autoComplete="new-password"
                      autoFocus
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
                      placeholder="Repeat your new password"
                      autoComplete="new-password"
                      className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 rounded-lg transition-colors duration-150 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Resetting…' : 'Reset Password'}
                </button>
              </form>
              <div className="mt-6 pt-5 border-t border-gray-100 text-center">
                <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
                  <ArrowLeft className="w-4 h-4" /> Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
