import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { authApi } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await authApi.requestPasswordReset(email.trim());
    } catch {
      // Intentionally generic — do not leak whether the account exists
    } finally {
      setSubmitting(false);
      setSent(true);
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
          {sent ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Check your inbox</h2>
              <p className="text-sm text-gray-500 mb-6">
                If an account exists, a reset link has been sent.
              </p>
              <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">Forgot your password?</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Enter your email and we'll send you a link to reset it.
                </p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(''); }}
                      placeholder="you@example.com"
                      autoComplete="email"
                      autoFocus
                      className={`w-full pl-10 pr-4 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                        error ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                    />
                  </div>
                  {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 rounded-lg transition-colors duration-150 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Sending…' : 'Send Reset Link'}
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
