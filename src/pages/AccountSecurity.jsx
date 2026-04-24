import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/apiClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import {
  ShieldCheck, KeyRound, Lock, RefreshCw, AlertTriangle, CheckCircle2,
  Copy, Unlock, Loader2, Smartphone, Download
} from 'lucide-react';

function copyToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
  }
}

function MfaPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [enrollment, setEnrollment] = useState(null); // { secret_base32, otpauth_url, backup_codes }
  const [confirmCode, setConfirmCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [savedBackupCodes, setSavedBackupCodes] = useState(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['mfa-status'],
    queryFn: () => api.mfa.status(),
  });

  const beginMutation = useMutation({
    mutationFn: () => api.mfa.beginEnrollment(),
    onSuccess: (data) => {
      setEnrollment(data);
      setSavedBackupCodes(null);
    },
    onError: (e) => toast({ title: 'Could not start MFA enrollment', description: e.message, variant: 'destructive' }),
  });

  const confirmMutation = useMutation({
    mutationFn: (code) => api.mfa.confirmEnrollment({ code }),
    onSuccess: (data) => {
      setSavedBackupCodes(data.backup_codes || enrollment?.backup_codes || []);
      setEnrollment(null);
      setConfirmCode('');
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
      toast({ title: 'MFA enrolled', description: 'Save your backup codes now — they will not be shown again.' });
    },
    onError: (e) => toast({ title: 'Verification failed', description: e.message, variant: 'destructive' }),
  });

  const regenMutation = useMutation({
    mutationFn: () => api.mfa.regenerateBackupCodes(),
    onSuccess: (data) => {
      setSavedBackupCodes(data.backup_codes || []);
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
      toast({ title: 'New backup codes generated', description: 'Old codes are now invalid.' });
    },
    onError: (e) => toast({ title: 'Could not regenerate', description: e.message, variant: 'destructive' }),
  });

  const disableMutation = useMutation({
    mutationFn: () => api.mfa.disable({ password: disablePassword, code: disableCode || undefined }),
    onSuccess: () => {
      setDisablePassword('');
      setDisableCode('');
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
      toast({ title: 'MFA disabled', description: 'TOTP and backup codes have been removed for your account.' });
    },
    onError: (e) => toast({ title: 'Could not disable MFA', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading MFA status…</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Smartphone className="w-5 h-5" /> Authenticator (TOTP, RFC 6238)</CardTitle>
          <CardDescription>
            Adds a one-time code from your authenticator app (Authy, Google Authenticator, 1Password, etc.) to every sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">Status:</span>
            {status?.enrolled ? (
              <Badge className="bg-green-100 text-green-700 border-green-200">Enrolled</Badge>
            ) : (
              <Badge variant="secondary">Not enrolled</Badge>
            )}
            {status?.enrolled && (
              <span className="text-sm text-slate-500">
                Backup codes remaining: <span className="font-mono">{status.backup_codes_remaining ?? 0}</span>
              </span>
            )}
          </div>

          {!status?.enrolled && !enrollment && (
            <Button onClick={() => beginMutation.mutate()} disabled={beginMutation.isPending}>
              {beginMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
              Begin MFA enrollment
            </Button>
          )}

          {enrollment && (
            <Alert>
              <AlertDescription>
                <div className="space-y-3">
                  <p className="text-sm font-medium">1. Add this account to your authenticator app:</p>
                  <div className="bg-slate-50 border rounded p-3 text-sm font-mono break-all">
                    {enrollment.otpauth_url}
                  </div>
                  <p className="text-xs text-slate-600">
                    Or enter the secret manually:&nbsp;
                    <span className="font-mono">{enrollment.secret_base32}</span>
                    <Button size="sm" variant="ghost" className="ml-2 h-7" onClick={() => copyToClipboard(enrollment.secret_base32)}>
                      <Copy className="w-3 h-3" />
                    </Button>
                  </p>
                  <p className="text-sm font-medium pt-2">2. Enter the 6-digit code from your app:</p>
                  <div className="flex items-center gap-2">
                    <Input
                      value={confirmCode}
                      onChange={(e) => setConfirmCode(e.target.value)}
                      placeholder="123456"
                      className="font-mono tracking-[0.3em] w-40 text-center"
                      autoFocus
                    />
                    <Button onClick={() => confirmMutation.mutate(confirmCode.replace(/\s/g, ''))} disabled={confirmMutation.isPending || confirmCode.length < 6}>
                      {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                      Confirm
                    </Button>
                    <Button variant="ghost" onClick={() => { setEnrollment(null); setConfirmCode(''); }}>Cancel</Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {savedBackupCodes && savedBackupCodes.length > 0 && (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertDescription>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-amber-900">Save these backup codes</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(savedBackupCodes.join('\n'))}>
                      <Copy className="w-3 h-3 mr-1" /> Copy
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      const blob = new Blob([savedBackupCodes.join('\n')], { type: 'text/plain' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = 'transtrack-backup-codes.txt';
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}>
                      <Download className="w-3 h-3 mr-1" /> Download
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-amber-800 mb-2">
                  Each code is single-use. Store them somewhere safe — they will not be shown again.
                </p>
                <pre className="text-sm font-mono bg-white border border-amber-200 rounded p-2 grid grid-cols-2 gap-1">
                  {savedBackupCodes.map((c) => <span key={c}>{c}</span>)}
                </pre>
              </AlertDescription>
            </Alert>
          )}

          {status?.enrolled && (
            <div className="space-y-3 pt-4 border-t">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => regenMutation.mutate()} disabled={regenMutation.isPending}>
                  {regenMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Regenerate backup codes
                </Button>
              </div>

              <div className="bg-red-50 border border-red-200 rounded p-3 space-y-2">
                <p className="text-sm font-medium text-red-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Disable MFA
                </p>
                <p className="text-xs text-red-700">Re-authentication required. Provide your password and a current 6-digit code (or backup code).</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <Input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder="Account password"
                    className="w-56"
                  />
                  <Input
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                    placeholder="6-digit or backup"
                    className="w-44 font-mono"
                  />
                  <Button
                    variant="destructive"
                    onClick={() => disableMutation.mutate()}
                    disabled={!disablePassword || disableMutation.isPending}
                  >
                    {disableMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Disable MFA
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PasswordPanel() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword(''); setNewPassword(''); setConfirm('');
      toast({ title: 'Password updated' });
    },
    onError: (e) => toast({ title: 'Password change failed', description: e.message, variant: 'destructive' }),
  });

  const matches = newPassword.length > 0 && newPassword === confirm;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Lock className="w-5 h-5" /> Change password</CardTitle>
        <CardDescription>
          Passwords are validated against your organization's policy (length, complexity, history).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => { e.preventDefault(); if (matches) mutation.mutate(); }}
          className="space-y-3 max-w-md"
        >
          <div>
            <Label htmlFor="cur">Current password</Label>
            <Input id="cur" type="password" autoComplete="current-password"
                   value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new">New password</Label>
            <Input id="new" type="password" autoComplete="new-password"
                   value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="conf">Confirm new password</Label>
            <Input id="conf" type="password" autoComplete="new-password"
                   value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {confirm && !matches && (
              <p className="text-xs text-red-600 mt-1">Passwords do not match.</p>
            )}
          </div>
          <Button type="submit" disabled={!matches || !currentPassword || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LockoutPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['lockout-report'],
    queryFn: () => api.adminSecurity.lockoutReport(),
    refetchInterval: 30000,
  });

  const unlockMutation = useMutation({
    mutationFn: (email) => api.adminSecurity.unlockAccount(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lockout-report'] });
      toast({ title: 'Account unlocked' });
    },
    onError: (e) => toast({ title: 'Unlock failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading lockout report…</div>;
  if (isError) return <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>;

  const locked = data?.locked || [];
  const elevated = data?.elevated || [];

  const Section = ({ title, rows, emptyMessage }) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{emptyMessage}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Failed attempts</TableHead>
                <TableHead>Locked until</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.email}>
                  <TableCell className="font-mono text-sm">{r.email}</TableCell>
                  <TableCell>{r.attempt_count ?? r.failed_attempts ?? 0}</TableCell>
                  <TableCell>{r.locked_until || '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => unlockMutation.mutate(r.email)}
                      disabled={unlockMutation.isPending}
                    >
                      <Unlock className="w-3 h-3 mr-1" /> Unlock
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Section title="Currently locked accounts" rows={locked} emptyMessage="No accounts currently locked." />
      <Section title="Elevated failure counts (not yet locked)" rows={elevated} emptyMessage="No accounts with elevated failed-login activity." />
    </div>
  );
}

export default function AccountSecurity() {
  const { data: user } = useQuery({ queryKey: ['me'], queryFn: () => api.auth.me() });
  const isAdmin = user?.role === 'admin';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center gap-3">
        <ShieldCheck className="w-7 h-7 text-cyan-700" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Account Security</h1>
          <p className="text-slate-600 text-sm">
            Multi-factor authentication, password management, and account lockout administration.
          </p>
        </div>
      </div>

      <Tabs defaultValue="mfa">
        <TabsList>
          <TabsTrigger value="mfa">MFA</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
          {isAdmin && <TabsTrigger value="lockouts">Lockouts (Admin)</TabsTrigger>}
        </TabsList>
        <TabsContent value="mfa" className="mt-4"><MfaPanel /></TabsContent>
        <TabsContent value="password" className="mt-4"><PasswordPanel /></TabsContent>
        {isAdmin && <TabsContent value="lockouts" className="mt-4"><LockoutPanel /></TabsContent>}
      </Tabs>
    </div>
  );
}
