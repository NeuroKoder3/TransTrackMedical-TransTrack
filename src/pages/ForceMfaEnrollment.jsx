import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/apiClient';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Smartphone, Copy, CheckCircle2 } from 'lucide-react';

function copyToClipboard(text) {
  if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(text);
}

/** Normalize desktop/server MFA begin payloads to one shape. */
function normalizeEnrollment(data) {
  if (!data) return null;
  const secret = data.secret_base32 || data.secret || '';
  const otpauthUrl = data.otpauth_url || data.otpauth || '';
  return {
    ...data,
    secret,
    secret_base32: secret,
    otpauth_url: otpauthUrl,
  };
}

export default function ForceMfaEnrollment() {
  const { logout, clearMfaEnrollmentRequired } = useAuth();
  const [enrollment, setEnrollment] = useState(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [error, setError] = useState(null);

  const beginMutation = useMutation({
    mutationFn: () => api.mfa.beginEnrollment(),
    onSuccess: (data) => {
      setError(null);
      setEnrollment(normalizeEnrollment(data));
    },
    onError: (e) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (code) =>
      api.mfa.confirmEnrollment({
        code,
        secret: enrollment?.secret_base32 || enrollment?.secret,
      }),
    onSuccess: (data) => {
      const codes = data?.backup_codes || data?.backupCodes || [];
      setBackupCodes(Array.isArray(codes) ? codes : []);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const handleComplete = () => {
    clearMfaEnrollmentRequired();
  };

  if (backupCodes) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <Card className="w-full max-w-md border-green-300 shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <CardTitle className="text-xl">MFA Enabled</CardTitle>
            <p className="text-sm text-slate-600 mt-1">
              Save these backup codes in a secure location. They will not be shown again.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-slate-50 p-3 rounded-md font-mono text-sm space-y-1 border">
              {backupCodes.length === 0 ? (
                <p className="text-slate-500">No backup codes returned — MFA is still enabled.</p>
              ) : (
                backupCodes.map((code, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span>{code}</span>
                    <button type="button" onClick={() => copyToClipboard(code)} className="text-slate-400 hover:text-slate-600">
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <Button className="w-full bg-cyan-600 hover:bg-cyan-700" onClick={handleComplete}>
              I have saved my backup codes — Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md border-amber-300 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-3">
            <Smartphone className="w-6 h-6 text-amber-600" />
          </div>
          <CardTitle className="text-xl">Multi-Factor Authentication Required</CardTitle>
          <p className="text-sm text-slate-600 mt-1">
            Your account requires MFA enrollment before you can continue.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm p-3 rounded-md border border-red-200">
              {error}
            </div>
          )}

          {!enrollment ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Use an authenticator app (Microsoft Authenticator, Google Authenticator, Authy, etc.)
                to set up your second factor.
              </p>
              <Button
                className="w-full bg-cyan-600 hover:bg-cyan-700"
                onClick={() => beginMutation.mutate()}
                disabled={beginMutation.isPending}
              >
                {beginMutation.isPending ? 'Starting...' : 'Begin MFA Setup'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-800">
                  1. Add TransTrack in your authenticator app
                </p>
                <p className="text-sm text-slate-600">
                  Choose “Enter a setup key” (or similar) and paste this secret:
                </p>
                <div className="flex items-center gap-2 bg-slate-50 border rounded-md px-3 py-2">
                  <code className="flex-1 text-sm font-mono break-all select-all">
                    {enrollment.secret_base32}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(enrollment.secret_base32)}
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Account: TransTrack · Type: Time-based · Digits: 6
                </p>
                {enrollment.otpauth_url ? (
                  <details className="text-xs text-slate-500">
                    <summary className="cursor-pointer hover:text-slate-700">Advanced: otpauth URI</summary>
                    <code className="mt-1 block break-all bg-slate-50 border rounded p-2">
                      {enrollment.otpauth_url}
                    </code>
                  </details>
                ) : null}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  2. Enter the 6-digit code from your app
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm text-center font-mono text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <Button
                className="w-full bg-cyan-600 hover:bg-cyan-700"
                onClick={() => confirmMutation.mutate(confirmCode)}
                disabled={confirmCode.length < 6 || confirmMutation.isPending || !enrollment.secret_base32}
              >
                {confirmMutation.isPending ? 'Verifying...' : 'Verify & Enable'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setEnrollment(null);
                  setConfirmCode('');
                  setError(null);
                }}
              >
                Start over
              </Button>
            </div>
          )}

          <Button variant="outline" className="w-full" onClick={() => logout(true)}>
            Log Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
