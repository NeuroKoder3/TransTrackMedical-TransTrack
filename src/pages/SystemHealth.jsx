import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  Activity, CheckCircle, AlertTriangle, XCircle, RefreshCw,
  Download, Database, Shield, FileText, Info,
} from 'lucide-react';
import { format } from 'date-fns';
import ErrorState from '@/components/ui/ErrorState';
import { toast } from 'sonner';
import { api } from '@/api/apiClient';

/**
 * System Health and Diagnostics.
 *
 * docs/PILOT_DEPLOYMENT_RUNBOOK.md directs a site administrator here to confirm
 * an installation is healthy and to collect diagnostics for support. The
 * health-check service and its IPC endpoint already existed; there was no screen
 * reading them, so the runbook pointed at a page that did not exist and the only
 * way to see a health snapshot was to call the IPC method from DevTools.
 *
 * Two jobs:
 *   1. Show per-component health so site IT can answer "is this install OK?"
 *      without vendor involvement.
 *   2. Export a support bundle. The bundle withholds free text by default so it
 *      carries no PHI; including full message bodies is a separate, explicit
 *      choice, and the warning here is deliberately blunt about the consequence.
 */

const STATUS_STYLES = {
  ok: { icon: CheckCircle, badge: 'bg-emerald-100 text-emerald-800', label: 'OK' },
  pass: { icon: CheckCircle, badge: 'bg-emerald-100 text-emerald-800', label: 'OK' },
  warn: { icon: AlertTriangle, badge: 'bg-amber-100 text-amber-800', label: 'Warning' },
  fail: { icon: XCircle, badge: 'bg-red-100 text-red-800', label: 'Failed' },
};

function statusStyle(status) {
  return STATUS_STYLES[status] || { icon: Info, badge: 'bg-slate-100 text-slate-700', label: status || 'Unknown' };
}

/** Turn `waitlistTransitions` / `audit_logs` into "Waitlist transitions". */
function humanizeKey(key) {
  const spaced = String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ComponentRow({ name, detail }) {
  const status = detail?.status;
  const { icon: Icon, badge, label } = statusStyle(status);

  // Show the component's own fields, minus the status we already render as a
  // badge, so a new field added to a health check appears here automatically
  // instead of needing this screen updated.
  const fields = Object.entries(detail || {}).filter(([k]) => k !== 'status');

  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
      <div className="flex items-start gap-3 min-w-0">
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${
          status === 'fail' ? 'text-red-600' : status === 'warn' ? 'text-amber-600' : 'text-emerald-600'
        }`} />
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{humanizeKey(name)}</p>
          {fields.length > 0 && (
            <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-sm text-slate-600 sm:grid-cols-2">
              {fields.map(([k, v]) => (
                <div key={k} className="flex gap-1.5 min-w-0">
                  <dt className="text-slate-500 shrink-0">{humanizeKey(k)}:</dt>
                  <dd className="truncate font-mono text-xs pt-0.5">
                    {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
      <Badge className={`${badge} shrink-0`}>{label}</Badge>
    </div>
  );
}

export default function SystemHealth() {
  const [includeFreeText, setIncludeFreeText] = useState(false);

  const {
    data: health, isLoading, isError, refetch, isRefetching,
  } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: () => api.system.getHealth(),
    refetchInterval: 60000,
  });

  const { data: migrations } = useQuery({
    queryKey: ['migrationStatus'],
    queryFn: () => api.system.getMigrationStatus(),
  });

  const exportMutation = useMutation({
    mutationFn: async () => await api.support.exportBundle({ includeFreeText }),
    onSuccess: (result) => {
      if (result?.canceled) return;
      const sizeKb = Math.max(1, Math.round((result.sizeBytes || 0) / 1024));
      toast.success(
        result.includeFreeText
          ? `Support bundle saved (${sizeKb} KB). It includes log message text — handle it as PHI.`
          : `Support bundle saved (${sizeKb} KB). No PHI included.`,
      );
    },
    onError: (error) => toast.error(`Export failed: ${error.message}`),
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-slate-500">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Checking system health…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState
          title="Could not read system health"
          description="The health service did not respond. If this persists, export a support bundle or check the application log."
          onRetry={refetch}
        />
      </div>
    );
  }

  const overall = statusStyle(health?.status);
  const components = health?.components || {};
  const failing = Object.entries(components).filter(([, d]) => d?.status === 'fail');
  const warning = Object.entries(components).filter(([, d]) => d?.status === 'warn');

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <Activity className="h-6 w-6 text-slate-700" />
            System Health &amp; Diagnostics
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Confirms this installation is operating correctly and produces a diagnostics
            file for support.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Overall status</CardTitle>
              <CardDescription>
                {health?.checkedAt
                  ? `Checked ${format(new Date(health.checkedAt), 'PPpp')}`
                  : 'Re-checked automatically every minute'}
              </CardDescription>
            </div>
            <Badge className={`${overall.badge} text-sm px-3 py-1`}>{overall.label}</Badge>
          </div>
        </CardHeader>
        {(failing.length > 0 || warning.length > 0) && (
          <CardContent className="pt-0">
            {failing.length > 0 && (
              <Alert className="border-red-200 bg-red-50">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertTitle className="text-red-900">Action required</AlertTitle>
                <AlertDescription className="text-red-800">
                  {failing.map(([k]) => humanizeKey(k)).join(', ')} reported a failure.
                  Export a support bundle and contact support.
                </AlertDescription>
              </Alert>
            )}
            {failing.length === 0 && warning.length > 0 && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-900">Attention</AlertTitle>
                <AlertDescription className="text-amber-800">
                  {warning.map(([k]) => humanizeKey(k)).join(', ')} reported a warning.
                  This is often expected on a new installation, for example before the
                  first backup has run.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-slate-600" />
            Components
          </CardTitle>
          <CardDescription>
            Encryption, audit trail integrity, database, backups and file integrity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(components).length === 0 ? (
            <p className="text-sm text-slate-500">No component data reported.</p>
          ) : (
            Object.entries(components).map(([name, detail]) => (
              <ComponentRow key={name} name={name} detail={detail} />
            ))
          )}
        </CardContent>
      </Card>

      {migrations && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-slate-600" />
              Database schema
            </CardTitle>
            <CardDescription>
              Confirms the database finished upgrading after an application update.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>
              <span className="text-slate-500">Current version:</span>{' '}
              <span className="font-mono">{migrations.currentVersion ?? '—'}</span>
            </p>
            {Array.isArray(migrations.pending) && (
              <p>
                <span className="text-slate-500">Pending migrations:</span>{' '}
                <span className="font-mono">{migrations.pending.length}</span>
                {migrations.pending.length > 0 && (
                  <span className="text-amber-700"> — restart the application to apply</span>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-600" />
            Support bundle
          </CardTitle>
          <CardDescription>
            Saves one file containing health status, schema version, record counts,
            backup history and recent log activity — for attaching to a support ticket.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-slate-200 bg-slate-50">
            <Info className="h-4 w-4 text-slate-600" />
            <AlertTitle className="text-slate-900">No patient data by default</AlertTitle>
            <AlertDescription className="text-slate-700">
              Record counts are included; patient records are not. Log message text is
              withheld, because a message written elsewhere in the system could quote a
              patient name and no automatic filter can reliably detect one.
            </AlertDescription>
          </Alert>

          <div className="flex items-start gap-3 rounded-md border border-slate-200 p-3">
            <input
              id="includeFreeText"
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={includeFreeText}
              onChange={(e) => setIncludeFreeText(e.target.checked)}
            />
            <div className="space-y-1">
              <Label htmlFor="includeFreeText" className="font-medium cursor-pointer">
                Include full log message text
              </Label>
              <p className="text-sm text-slate-600">
                Only when support asks for it. The bundle must then be treated as
                protected health information: transfer it the way you would any other
                PHI export, and delete it when the ticket closes.
              </p>
            </div>
          </div>

          {includeFreeText && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-900">This bundle may contain PHI</AlertTitle>
              <AlertDescription className="text-amber-800">
                Log message text is included. Do not email it unencrypted.
              </AlertDescription>
            </Alert>
          )}

          <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            <Download className="h-4 w-4 mr-2" />
            {exportMutation.isPending ? 'Preparing…' : 'Export support bundle'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
