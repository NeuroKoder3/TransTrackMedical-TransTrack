import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { api, getApiMode, getApiBaseUrl } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Shield, Lock, KeyRound, ArrowLeft, Building2 } from 'lucide-react';

export default function Login() {
  const { login, isLoadingAuth, mfaChallenge, submitMfa, cancelMfa, refreshAuth } = useAuth();
  const [email, setEmail] = useState('admin@transtrack.local');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ssoInFlight, setSsoInFlight] = useState(false);
  const [ssoConfigured, setSsoConfigured] = useState(false);
  const [loginHints, setLoginHints] = useState(null);
  const mode = getApiMode();
  const apiBase = getApiBaseUrl();
  const isPackaged = !!loginHints?.isPackaged;
  const showDevRemoteBanner = !isPackaged && mode !== 'remote' && import.meta.env.DEV;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [status, hints] = await Promise.all([
          api.sso?.status?.().catch(() => ({ configured: false })),
          api.auth?.loginHints?.().catch(() => null),
        ]);
        if (cancelled) return;
        setSsoConfigured(!!status?.configured);
        if (hints) setLoginHints(hints);
      } catch {
        if (!cancelled) setSsoConfigured(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Subscribe to the broadcast emitted by the protocol handler after the
  // OIDC token exchange completes. The renderer's job is to refresh its
  // auth state so AuthContext picks up the new session.
  useEffect(() => {
    if (!api.sso || typeof api.sso.onCompleted !== 'function') return;
    const unsubscribe = api.sso.onCompleted((payload) => {
      setSsoInFlight(false);
      if (payload?.ok) {
        if (typeof refreshAuth === 'function') refreshAuth();
        setError('');
      } else {
        setError(payload?.error || 'SSO sign-in failed.');
      }
    });
    return unsubscribe;
  }, [refreshAuth]);

  const handleSso = async () => {
    setError('');
    setSsoInFlight(true);
    try {
      await api.sso.start();
      // The IdP page is now open in the system browser. The callback
      // arrives via auth:ssoCompleted (above).
    } catch (err) {
      setSsoInFlight(false);
      setError(err.message || 'SSO is not configured. Ask your administrator.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email, password);
      // Either authenticated, or AuthContext now holds an MFA challenge.
    } catch (err) {
      setError(err.message || 'Invalid credentials. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfa = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await submitMfa(mfaCode.replace(/[\s-]/g, ''));
      setMfaCode('');
    } catch (err) {
      setError(err.message || 'Invalid verification code.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-slate-50 to-cyan-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-600 rounded-2xl mb-4 shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">TransTrack</h1>
          <p className="text-slate-600 mt-2">Transplant Waitlist Management System</p>
        </div>

        <Card className="border-slate-200 shadow-xl">
          {!mfaChallenge ? (
            <>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-xl text-center">Sign In</CardTitle>
                <CardDescription className="text-center">
                  Enter your credentials to access the system
                </CardDescription>
              </CardHeader>
              <CardContent>
                {mode === 'remote' && (
                  <Alert className="mb-4 bg-green-50 border-green-200">
                    <AlertDescription className="text-green-800 text-sm">
                      <strong>Connected to API:</strong> {apiBase}
                    </AlertDescription>
                  </Alert>
                )}

                {showDevRemoteBanner && (
                  <Alert className="mb-4 bg-amber-50 border-amber-200">
                    <AlertDescription className="text-amber-900 text-sm">
                      <strong>Developer mode</strong> — local SQLite. For live Epic/API testing,
                      restart with <code>scripts\dev-with-api.ps1</code> while the API is on :8080.
                    </AlertDescription>
                  </Alert>
                )}

                {isPackaged && loginHints?.setupTokenPresent && (
                  <Alert className="mb-4 bg-cyan-50 border-cyan-200">
                    <AlertDescription className="text-cyan-900 text-sm">
                      <strong>First launch:</strong> sign in as{' '}
                      <code>{loginHints.defaultAdminEmail || 'admin@transtrack.local'}</code> using
                      the one-time password in{' '}
                      <code className="break-all">%APPDATA%\TransTrack Enterprise\INITIAL_ADMIN_PASSWORD.txt</code>
                      {' '}(you will be asked to change it after signing in).
                    </AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="admin@transtrack.local"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                      className="h-11"
                      autoComplete="username"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={isLoading}
                      className="h-11"
                      autoComplete="current-password"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 bg-cyan-600 hover:bg-cyan-700"
                    disabled={isLoading || isLoadingAuth}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4 mr-2" />
                        Sign In
                      </>
                    )}
                  </Button>
                </form>

                {ssoConfigured && (
                  <>
                    <div className="my-4 flex items-center gap-3">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="text-xs text-slate-400 uppercase tracking-wide">or</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-11"
                      disabled={ssoInFlight || isLoading || isLoadingAuth}
                      onClick={handleSso}
                    >
                      {ssoInFlight ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Waiting for identity provider…
                        </>
                      ) : (
                        <>
                          <Building2 className="w-4 h-4 mr-2" />
                          Sign in with your organization (SSO)
                        </>
                      )}
                    </Button>
                  </>
                )}

                <div className="mt-6 pt-4 border-t border-slate-100">
                  <p className="text-xs text-center text-slate-500">
                    {isPackaged
                      ? 'Enterprise desktop — encrypted local database. Local administrator sign-in is always available.'
                      : 'First-time users: check INITIAL_ADMIN_PASSWORD.txt in the app data folder for the setup token.'}
                  </p>
                </div>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-xl text-center flex items-center justify-center gap-2">
                  <KeyRound className="w-5 h-5 text-cyan-600" />
                  Two-Factor Verification
                </CardTitle>
                <CardDescription className="text-center">
                  Enter the 6-digit code from your authenticator app, or a backup code, for{' '}
                  <span className="font-medium text-slate-700">{mfaChallenge.email}</span>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleMfa} className="space-y-4">
                  {error && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="mfa-code">Verification Code</Label>
                    <Input
                      id="mfa-code"
                      type="text"
                      inputMode="text"
                      placeholder="123 456 or backup-code"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      required
                      disabled={isLoading}
                      className="h-11 tracking-[0.3em] text-center text-lg font-mono"
                      autoComplete="one-time-code"
                      autoFocus
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 bg-cyan-600 hover:bg-cyan-700"
                    disabled={isLoading || isLoadingAuth || mfaCode.length < 6}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4 mr-2" />
                        Verify and Sign In
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full h-10"
                    onClick={() => { cancelMfa(); setMfaCode(''); setError(''); }}
                    disabled={isLoading}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to sign in
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>

        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-3 text-xs text-slate-500">
            <span className="px-2 py-1 bg-white rounded border border-slate-200">HIPAA Aligned</span>
            <span className="px-2 py-1 bg-white rounded border border-slate-200">21 CFR Part 11 Architected</span>
            <span className="px-2 py-1 bg-white rounded border border-slate-200">TOTP MFA</span>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            All data is encrypted and stored locally. No internet connection required.
          </p>
        </div>
      </div>
    </div>
  );
}
