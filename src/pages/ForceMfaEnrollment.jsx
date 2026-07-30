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

export default function ForceMfaEnrollment() {
  const { logout, clearMfaEnrollmentRequired } = useAuth();
  const [enrollment, setEnrollment] = useState(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [error, setError] = useState(null);

  const beginMutation = useMutation({
    mutationFn: () => api.mfa.beginEnrollment(),
    onSuccess: (data) => setEnrollment(data),
    onError: (e) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (code) => api.mfa.confirmEnrollment({ code }),
    onSuccess: (data) => {
      setBackupCodes(data.backup_codes || enrollment?.backup_codes || []);
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
              {backupCodes.map((code, i) => (
                <div key={i} className="flex justify-between items-center">
                  <span>{code}</span>
                  <button onClick={() => copyToClipboard(code)} className="text-slate-400 hover:text-slate-600">
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              ))}
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
                Use an authenticator app (Google Authenticator, Authy, etc.) to set up your second factor.
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
              {enrollment.otpauth_url && (
                <div className="text-center">
                  <p className="text-sm text-slate-600 mb-2">
                    Scan this QR code with your authenticator app, or enter the secret manually:
                  </p>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(enrollment.otpauth_url)}`}
                    alt="MFA QR Code"
                    className="mx-auto mb-2"
                    width={200}
                    height={200}
                  />
                  <div className="flex items-center justify-center gap-2">
                    <code className="text-xs bg-slate-100 px-2 py-1 rounded border">{enrollment.secret_base32}</code>
                    <button onClick={() => copyToClipboard(enrollment.secret_base32)} className="text-slate-400 hover:text-slate-600">
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm text-center font-mono text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <Button
                className="w-full bg-cyan-600 hover:bg-cyan-700"
                onClick={() => confirmMutation.mutate(confirmCode)}
                disabled={confirmCode.length < 6 || confirmMutation.isPending}
              >
                {confirmMutation.isPending ? 'Verifying...' : 'Verify & Enable'}
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
