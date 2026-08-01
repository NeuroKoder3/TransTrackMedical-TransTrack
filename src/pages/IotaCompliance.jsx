import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ShieldAlert, CheckCircle, AlertTriangle, Clock, Mail, Send,
  FileText, RefreshCw, Settings, Users, FileCheck,
} from 'lucide-react';
import { format } from 'date-fns';
import ErrorState from '@/components/ui/ErrorState';
import { toast } from 'sonner';
import { api } from '@/api/apiClient';

/**
 * CMS IOTA Model § 512.442(d) — waitlist status change notifications.
 *
 * A participating kidney transplant hospital must tell a patient within 10 days
 * when a waitlist status change stops organ offers reaching them, repeat that
 * notice annually while they stay inactive, send a copy to the dialysis
 * facility or referring provider, and file the notice in the chart.
 *
 * This screen exists to make an unmet obligation impossible to overlook. It
 * deliberately leads with what is wrong — overdue notices, obligations with no
 * notice at all, recipients with no name on file — rather than with a
 * reassuring total, because the failure mode that matters here is a deadline
 * quietly passing.
 */

function DueBadge({ notice }) {
  if (notice.delivered) {
    return notice.deliveredLate
      ? <Badge className="bg-amber-100 text-amber-800">Delivered late</Badge>
      : <Badge className="bg-emerald-100 text-emerald-800">Delivered</Badge>;
  }
  if (notice.overdue) return <Badge className="bg-red-100 text-red-800">Overdue</Badge>;
  if (notice.daysUntilDue !== null && notice.daysUntilDue <= 3) {
    return <Badge className="bg-amber-100 text-amber-800">Due in {notice.daysUntilDue}d</Badge>;
  }
  return <Badge className="bg-slate-100 text-slate-700">Due in {notice.daysUntilDue}d</Badge>;
}

function SummaryTile({ label, value, tone = 'slate', hint }) {
  const tones = {
    red: 'border-red-200 bg-red-50 text-red-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    slate: 'border-slate-200 bg-white text-slate-900',
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="text-xs opacity-80 mt-1">{hint}</p>}
    </div>
  );
}

function ChartBadge({ status }) {
  if (status === 'filed') return <Badge className="bg-emerald-100 text-emerald-800">Filed to chart</Badge>;
  if (status === 'failed') return <Badge className="bg-red-100 text-red-800">Chart filing failed</Badge>;
  if (status === 'dry_run') return <Badge className="bg-blue-100 text-blue-800">Dry run only</Badge>;
  return <Badge className="bg-slate-100 text-slate-700">Not filed</Badge>;
}

function NoticeRow({ notice, onView, onDeliver, onNotifySecondary, onFile }) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-slate-900">{notice.patientName}</p>
            <span className="text-xs text-slate-500">MRN {notice.mrn || '—'}</span>
            <DueBadge notice={notice} />
            <ChartBadge status={notice.chart_write_status} />
            {notice.contentIntegrityOk === false && (
              <Badge className="bg-red-100 text-red-800">Content altered</Badge>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1">
            {notice.from_status || 'unknown'} → {notice.to_status}
            {notice.reason_code ? ` · ${notice.reason_code}` : ''}
            {' · due '}
            {notice.due_at ? format(new Date(notice.due_at), 'PP') : '—'}
          </p>
          {notice.secondaryRecipientUnknown && (
            <p className="text-sm text-amber-700 mt-1 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              A copy is owed to the {notice.secondary_recipient_type === 'dialysis_facility'
                ? 'dialysis facility' : 'referring provider'}, but none is recorded for this patient.
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => onView(notice)}>
            <FileText className="h-4 w-4 mr-1" /> View
          </Button>
          {!notice.delivered && (
            <>
              <Button size="sm" variant="outline" onClick={() => onDeliver(notice, 'mail')}>
                <Mail className="h-4 w-4 mr-1" /> Mailed
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDeliver(notice, 'electronic')}>
                <Send className="h-4 w-4 mr-1" /> Sent
              </Button>
            </>
          )}
          {!notice.secondary_notified_at
            && notice.secondary_recipient_type
            && notice.secondary_recipient_type !== 'none' && (
            <Button size="sm" variant="outline" onClick={() => onNotifySecondary(notice)}>
              <Users className="h-4 w-4 mr-1" /> Copy sent
            </Button>
          )}
          {notice.chart_write_status !== 'filed' && (
            <Button size="sm" variant="outline" onClick={() => onFile(notice)}>
              <FileCheck className="h-4 w-4 mr-1" /> File to chart
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IotaCompliance() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('pending');
  const [viewing, setViewing] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [draft, setDraft] = useState(null);
  const [filing, setFiling] = useState(null);
  const [epicPatientId, setEpicPatientId] = useState('');
  const [preview, setPreview] = useState(null);

  const summaryQ = useQuery({ queryKey: ['iota', 'summary'], queryFn: () => api.iota.getSummary() });
  const listQ = useQuery({
    queryKey: ['iota', 'notifications', filter],
    queryFn: () => api.iota.listNotifications({ filter }),
  });
  const configQ = useQuery({ queryKey: ['iota', 'config'], queryFn: () => api.iota.getConfig() });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['iota'] });
  };

  const deliverM = useMutation({
    mutationFn: ({ id, channel }) => api.iota.markDelivered({ id, channel }),
    onSuccess: (n) => {
      invalidate();
      toast.success(
        n.deliveredLate
          ? 'Delivery recorded — after the 10-day deadline, and reported as late.'
          : 'Delivery recorded within the deadline.',
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const secondaryM = useMutation({
    mutationFn: ({ id }) => api.iota.markSecondaryNotified({ id }),
    onSuccess: () => { invalidate(); toast.success('Copy to the secondary recipient recorded.'); },
    onError: (e) => toast.error(e.message),
  });

  const fileM = useMutation({
    mutationFn: ({ id, mode, epicPatientId }) =>
      api.iota.fileToChart({ id, mode, epicPatientId }),
    onSuccess: (r) => {
      invalidate();
      setFiling(null);
      if (r.outcome.status === 'dry_run') {
        setPreview(r.preview);
        toast.success('Dry run complete — nothing was sent. Review the document below.');
      } else if (r.outcome.status === 'filed') {
        toast.success('Recorded as filed to the chart.');
      } else {
        toast.error(`Filing failed: ${r.outcome.error}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const saveConfigM = useMutation({
    mutationFn: (config) => api.iota.saveConfig(config),
    onSuccess: () => {
      invalidate();
      setShowConfig(false);
      setDraft(null);
      toast.success('Notice configuration saved.');
    },
    onError: (e) => toast.error(e.message),
  });

  if (summaryQ.isError) {
    return <ErrorState title="Unable to load IOTA compliance status" message={summaryQ.error?.message} />;
  }

  const s = summaryQ.data;
  const config = configQ.data;
  const notices = listQ.data || [];

  const startEditing = () => {
    setDraft({
      template: config?.template || config?.exampleTemplate || '',
      reactivationSteps: config?.reactivationSteps || '',
      coordinatorName: config?.coordinatorName || '',
      coordinatorPhone: config?.coordinatorPhone || '',
      centerContact: config?.centerContact || '',
    });
    setShowConfig(true);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-blue-600" />
            IOTA Waitlist Notifications
          </h1>
          <p className="text-slate-600 mt-1">
            CMS IOTA Model § 512.442(d) — patients must be notified within{' '}
            {s?.noticeDueDays ?? 10} days of a status change that stops organ offers.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => invalidate()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" onClick={startEditing}>
            <Settings className="h-4 w-4 mr-1" /> Configure
          </Button>
        </div>
      </div>

      {config && !config.ready && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Notices cannot be issued yet</AlertTitle>
          <AlertDescription>
            This centre still needs {config.missing.join(' and ')}. Status changes are
            still recorded — the obligation and its deadline are not lost — but no notice
            can be produced until the configuration is complete.
          </AlertDescription>
        </Alert>
      )}

      {s?.withoutNotice > 0 && (
        <Alert className="border-red-300 bg-red-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{s.withoutNotice} obligation(s) have no notice</AlertTitle>
          <AlertDescription>
            A status change blocked organ offers but no notice was ever generated.
            The 10-day deadline is running against these.
          </AlertDescription>
        </Alert>
      )}

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <SummaryTile label="Overdue" value={s.overdue} tone={s.overdue > 0 ? 'red' : 'slate'} />
          <SummaryTile label="Due within 3 days" value={s.dueWithin3Days}
            tone={s.dueWithin3Days > 0 ? 'amber' : 'slate'} />
          <SummaryTile label="Not filed to chart" value={s.notFiledToChart}
            tone={s.notFiledToChart > 0 ? 'amber' : 'slate'}
            hint="§ 512.442(d) also requires a copy in the record" />
          <SummaryTile label="Delivered late" value={s.deliveredLate}
            tone={s.deliveredLate > 0 ? 'amber' : 'slate'} />
          <SummaryTile
            label="On-time rate"
            value={s.onTimeRate === null ? '—' : `${s.onTimeRate}%`}
            tone={s.onTimeRate !== null && s.onTimeRate < 100 ? 'amber' : 'emerald'}
            hint={`${s.deliveredOnTime}/${s.delivered} delivered on time`}
          />
        </div>
      )}

      {showConfig && draft && (
        <Card>
          <CardHeader>
            <CardTitle>Notice configuration</CardTitle>
            <CardDescription>
              The template must contain every placeholder the rule requires. It is
              validated before it is saved, so a template missing a required element is
              rejected here rather than at the moment a patient's notice is due.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="tpl">Notice template</Label>
              <Textarea
                id="tpl" rows={14} className="font-mono text-xs mt-1"
                value={draft.template}
                onChange={(e) => setDraft({ ...draft, template: e.target.value })}
              />
              {config?.requiredTokens?.length > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  Required placeholders: {config.requiredTokens.map((t) => `{{${t}}}`).join(', ')}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="steps">How a patient becomes active again</Label>
              <Textarea
                id="steps" rows={3} className="mt-1"
                value={draft.reactivationSteps}
                onChange={(e) => setDraft({ ...draft, reactivationSteps: e.target.value })}
              />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cn">Coordinator name</Label>
                <Input id="cn" className="mt-1" value={draft.coordinatorName}
                  onChange={(e) => setDraft({ ...draft, coordinatorName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cp">Coordinator phone</Label>
                <Input id="cp" className="mt-1" value={draft.coordinatorPhone}
                  onChange={(e) => setDraft({ ...draft, coordinatorPhone: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="cc">Contact block shown to the patient (optional)</Label>
              <Textarea
                id="cc" rows={3} className="mt-1" value={draft.centerContact}
                placeholder="Defaults to the organization's phone, email and address."
                onChange={(e) => setDraft({ ...draft, centerContact: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => saveConfigM.mutate(draft)} disabled={saveConfigM.isPending}>
                {saveConfigM.isPending ? 'Saving…' : 'Save configuration'}
              </Button>
              <Button variant="outline" onClick={() => { setShowConfig(false); setDraft(null); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>Notification queue</CardTitle>
            <div className="flex gap-1">
              {['pending', 'overdue', 'delivered', 'all'].map((f) => (
                <Button
                  key={f} size="sm"
                  variant={filter === f ? 'default' : 'outline'}
                  onClick={() => setFilter(f)}
                >
                  {f[0].toUpperCase() + f.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {listQ.isLoading && <p className="text-slate-500 py-6 text-center">Loading…</p>}
          {!listQ.isLoading && notices.length === 0 && (
            <p className="text-slate-500 py-6 text-center flex items-center justify-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              {filter === 'all'
                ? 'No notification obligations have been recorded.'
                : `No ${filter} notices.`}
            </p>
          )}
          {notices.map((n) => (
            <NoticeRow
              key={n.id}
              notice={n}
              onView={setViewing}
              onDeliver={(notice, channel) => deliverM.mutate({ id: notice.id, channel })}
              onNotifySecondary={(notice) => secondaryM.mutate({ id: notice.id })}
              onFile={(n) => { setFiling(n); setEpicPatientId(''); setPreview(null); }}
            />
          ))}
        </CardContent>
      </Card>

      {filing && (
        <Card>
          <CardHeader>
            <CardTitle>File the notice for {filing.patientName} to the chart</CardTitle>
            <CardDescription>
              § 512.442(d) requires a copy of the notice in the medical record.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Automatic filing needs Epic enablement</AlertTitle>
              <AlertDescription>
                Writing to Epic requires <code>DocumentReference.Create</code> to be turned
                on for this organisation and a document type agreed with your Epic team.
                Until then, use a dry run to confirm exactly what would be sent, and record
                a manual filing once the notice is in the chart by your usual route.
              </AlertDescription>
            </Alert>

            <div>
              <Label htmlFor="epicid">Epic patient FHIR id (for the dry run)</Label>
              <Input
                id="epicid" className="mt-1" value={epicPatientId}
                placeholder="e.g. erXuFYUfucBZaryVksYEcMg3"
                onChange={(e) => setEpicPatientId(e.target.value)}
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => fileM.mutate({ id: filing.id, mode: 'dry_run', epicPatientId })}
                disabled={!epicPatientId || fileM.isPending}
              >
                Dry run — build and validate, send nothing
              </Button>
              <Button
                variant="outline"
                onClick={() => fileM.mutate({ id: filing.id, mode: 'manual' })}
                disabled={fileM.isPending}
              >
                Record as filed manually
              </Button>
              <Button variant="ghost" onClick={() => setFiling(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Dry run — the document that would be sent</CardTitle>
                <CardDescription>
                  {preview.validation.ok
                    ? 'This resource passed structural validation. Nothing was transmitted.'
                    : `This resource would be rejected: ${preview.validation.problems.join('; ')}`}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>Close</Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-mono text-xs bg-slate-50 border rounded p-4 max-h-96 overflow-auto">
              {JSON.stringify(preview.resource, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {viewing && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Notice for {viewing.patientName}</CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  <Clock className="h-3.5 w-3.5" />
                  Generated {viewing.generated_at ? format(new Date(viewing.generated_at), 'PPp') : '—'}
                  {' · '}generator {viewing.generator_version}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setViewing(null)}>Close</Button>
            </div>
          </CardHeader>
          <CardContent>
            {viewing.contentIntegrityOk === false && (
              <Alert className="border-red-300 bg-red-50 mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>This notice no longer matches its recorded hash</AlertTitle>
                <AlertDescription>
                  The stored body does not hash to the frozen content identity, which
                  means it was altered after it was filed. Treat it as unreliable
                  evidence and report it.
                </AlertDescription>
              </Alert>
            )}
            <pre className="whitespace-pre-wrap font-mono text-xs bg-slate-50 border rounded p-4 max-h-96 overflow-auto">
              {viewing.content || 'The body of this notice was not stored.'}
            </pre>
            <p className="text-xs text-slate-500 mt-2 break-all">
              SHA-256 {viewing.content_sha256}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
