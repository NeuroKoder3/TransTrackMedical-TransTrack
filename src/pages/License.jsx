import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Key, CheckCircle2, AlertTriangle, Copy, ShieldCheck,
  ShieldAlert, Hourglass, Mail, FileText, RotateCcw,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

/**
 * License & Activation page. Always accessible from Settings menu; if the
 * trial has expired or the installed license is invalid, the host App
 * router should also redirect any other navigation here automatically.
 */
export default function License() {
  const queryClient = useQueryClient();
  const [licenseInput, setLicenseInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [activationError, setActivationError] = useState(null);
  const [activationSuccess, setActivationSuccess] = useState(null);

  const { data: info, isLoading } = useQuery({
    queryKey: ['licenseInfo'],
    queryFn: () => api.license.getInfo(),
    refetchInterval: 60_000,
  });

  const { data: machineId = '' } = useQuery({
    queryKey: ['licenseMachineId'],
    queryFn: () => api.license.getMachineId(),
  });

  const activate = useMutation({
    mutationFn: (wire) => api.license.activate(wire),
    onSuccess: (res) => {
      if (res.success) {
        setActivationSuccess(`License activated — ${res.tierName || res.tier}, expires ${res.maintenanceExpiry || 'never'}.`);
        setActivationError(null);
        setLicenseInput('');
        queryClient.invalidateQueries({ queryKey: ['licenseInfo'] });
      } else {
        setActivationError(res.error || 'Activation failed');
        setActivationSuccess(null);
      }
    },
    onError: (err) => {
      setActivationError(err?.message || String(err));
      setActivationSuccess(null);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.license.remove(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['licenseInfo'] });
      setActivationSuccess(null);
      setActivationError(null);
    },
  });

  const copyMachineId = async () => {
    try {
      await navigator.clipboard.writeText(machineId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  if (isLoading || !info) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-4xl mx-auto"><p className="text-slate-500">Loading license status…</p></div>
      </div>
    );
  }

  const statusBadge = renderStatusBadge(info);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center">
              <Key className="w-7 h-7 mr-3 text-cyan-600" />
              License & Activation
            </h1>
            <p className="text-slate-600 mt-1">
              Activate, view, or replace your TransTrack license.
            </p>
          </div>
          {statusBadge}
        </div>

        {info.isDevelopmentBuild && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="w-4 h-4 text-amber-700" />
            <AlertDescription className="text-amber-900">
              <strong>Development build.</strong> The publisher public key in this build is the development
              key, not the production one. Customer licenses will not validate against this build.
            </AlertDescription>
          </Alert>
        )}

        {info.mode === 'trial' && (
          <Alert className="border-blue-200 bg-blue-50">
            <Hourglass className="w-4 h-4 text-blue-700" />
            <AlertDescription className="text-blue-900">
              <strong>Trial mode.</strong> {info.trial?.daysRemaining ?? 0} days remaining.
              All features are enabled. Activate a license below to continue past{' '}
              {info.trial?.expiresAt ? format(new Date(info.trial.expiresAt), 'PPP') : 'expiry'}.
            </AlertDescription>
          </Alert>
        )}

        {info.mode === 'trial_expired' && (
          <Alert className="border-red-300 bg-red-50">
            <ShieldAlert className="w-4 h-4 text-red-700" />
            <AlertDescription className="text-red-900">
              <strong>Trial expired.</strong> TransTrack is read-only until a valid license is installed.
              Contact your account manager or paste your license string below.
            </AlertDescription>
          </Alert>
        )}

        {info.mode === 'in_grace' && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="w-4 h-4 text-amber-700" />
            <AlertDescription className="text-amber-900">
              <strong>License in renewal grace period.</strong> Expired on{' '}
              {info.expiresAt ? format(new Date(info.expiresAt), 'PPP') : 'unknown'}.
              The application continues to function but will lock out after the grace window ends.
            </AlertDescription>
          </Alert>
        )}

        {info.mode === 'invalid' && (
          <Alert className="border-red-300 bg-red-50">
            <ShieldAlert className="w-4 h-4 text-red-700" />
            <AlertDescription className="text-red-900">
              <strong>Installed license is invalid.</strong> {info.verificationError}
              <br />Replace the license below or remove it to fall back to trial mode (if eligible).
            </AlertDescription>
          </Alert>
        )}

        {info.mode === 'active' && (
          <Alert className="border-emerald-200 bg-emerald-50">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <AlertDescription className="text-emerald-900">
              <strong>License active.</strong> {info.orgName} — {info.tierName} tier, expires{' '}
              {info.expiresAt ? format(new Date(info.expiresAt), 'PPP') : 'unknown'}{' '}
              ({info.expiresAt ? formatDistanceToNow(new Date(info.expiresAt), { addSuffix: true }) : ''}).
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <FileText className="w-4 h-4 mr-2 text-slate-600" />
              Installed license
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
              <Row label="Organization" value={info.orgName} />
              <Row label="License ID" value={info.licenseId || '—'} mono />
              <Row label="Tier" value={info.tierName || info.tier} />
              <Row label="Customer email" value={info.customerEmail || '—'} />
              <Row label="Issued" value={info.issuedAt ? format(new Date(info.issuedAt), 'PPP') : '—'} />
              <Row label="Expires" value={info.expiresAt ? format(new Date(info.expiresAt), 'PPP') : '—'} />
              <Row label="Maintenance expires" value={info.maintenanceExpiresAt ? format(new Date(info.maintenanceExpiresAt), 'PPP') : '—'} />
              <Row label="Machine-bound" value={info.machineBound ? 'Yes — bound to this machine' : 'No — site license / unbound'} />
              <Row label="Max patients" value={fmtLimit(info.limits?.maxPatients)} />
              <Row label="Max users" value={fmtLimit(info.limits?.maxUsers)} />
              <Row label="Max installations" value={fmtLimit(info.limits?.maxInstallations)} />
              <Row label="Features" value={info.features?.length ? `${info.features.length} enabled` : '—'} />
            </dl>

            {info.licenseId && (
              <div className="mt-6">
                <Button
                  variant="outline"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className="text-red-700 border-red-200 hover:bg-red-50"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Remove license (revert to trial)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <Key className="w-4 h-4 mr-2 text-slate-600" />
              This machine
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-700 mb-3">
              Provide this machine ID to your TransTrack account manager when requesting a
              machine-bound license. Each install has its own ID; reinstalling the application
              or moving to a new computer changes this value.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-100 border border-slate-200 rounded px-3 py-2 text-xs font-mono break-all">
                {machineId || '…'}
              </code>
              <Button variant="outline" onClick={copyMachineId} disabled={!machineId}>
                <Copy className="w-4 h-4 mr-2" />
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <ShieldCheck className="w-4 h-4 mr-2 text-slate-600" />
              Activate a new license
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-700 mb-3">
              Paste the contents of the <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">.lic</code>{' '}
              file your account manager sent you. The string begins with{' '}
              <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">LIC1.</code>
            </p>
            <Label htmlFor="lic-input" className="sr-only">License string</Label>
            <textarea
              id="lic-input"
              value={licenseInput}
              onChange={(e) => setLicenseInput(e.target.value)}
              rows={6}
              spellCheck={false}
              autoComplete="off"
              placeholder="LIC1.eyJsaWNlbnNlSWQiOiAi..."
              className="w-full font-mono text-xs border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <div className="flex items-center gap-3 mt-3">
              <Button
                onClick={() => activate.mutate(licenseInput.trim())}
                disabled={!licenseInput.trim() || activate.isPending}
              >
                {activate.isPending ? 'Activating…' : 'Activate license'}
              </Button>
              {activationError && (
                <span className="text-sm text-red-700 flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-1" />
                  {activationError}
                </span>
              )}
              {activationSuccess && (
                <span className="text-sm text-emerald-700 flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  {activationSuccess}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <h3 className="font-semibold text-slate-900 mb-1 flex items-center">
              <Mail className="w-4 h-4 mr-2 text-slate-500" />
              Need a license, an upgrade, or a transfer?
            </h3>
            <p className="text-sm text-slate-600">
              Contact <a className="text-cyan-700 underline" href="mailto:sales@transtrack.health">sales@transtrack.health</a>{' '}
              with your organization name, the number of users, and the machine ID above.
            </p>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-slate-900 ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</dd>
    </>
  );
}

function fmtLimit(n) {
  if (typeof n !== 'number') return '—';
  if (n < 0) return 'Unlimited';
  return n.toLocaleString();
}

function renderStatusBadge(info) {
  const map = {
    active:        { label: 'Active', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    in_grace:      { label: 'Renewal grace', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
    trial:         { label: 'Trial', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
    trial_expired: { label: 'Trial expired', cls: 'bg-red-100 text-red-700 border-red-200' },
    invalid:       { label: 'Invalid', cls: 'bg-red-100 text-red-700 border-red-200' },
  };
  const m = map[info.mode] || { label: info.mode, cls: 'bg-slate-100 text-slate-700' };
  return <Badge variant="outline" className={`text-sm px-3 py-1 ${m.cls}`}>{m.label}</Badge>;
}
