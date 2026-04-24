import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/api/apiClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import {
  Inbox, FileCode, Loader2, CheckCircle2, XCircle, Database, Eraser, AlertTriangle, ArrowDownToLine
} from 'lucide-react';

const SAMPLE_ADT = [
  'MSH|^~\\&|EPIC|MAIN|TT|MAIN|20260423120000||ADT^A04|MSG00001|P|2.5',
  'EVN|A04|20260423120000',
  'PID|1||MRN-200001^^^MAIN^MR||DOE^JANE^M||19700515|F|||123 MAIN ST^^METROPOLIS^NY^10001||(555)555-1212',
  'PV1|1|O|CLINIC^A01^1|||||||||||||||||V001',
].join('\r');

const SAMPLE_ORU = [
  'MSH|^~\\&|LAB|MAIN|TT|MAIN|20260423130000||ORU^R01|MSG00002|P|2.5',
  'PID|1||MRN-200001^^^MAIN^MR||DOE^JANE^M||19700515|F',
  'OBR|1|ORD-001|FILL-001|CMP^Comprehensive Metabolic Panel|||20260423125500',
  'OBX|1|NM|2160-0^Creatinine||1.1|mg/dL|0.6-1.2|N|||F',
  'OBX|2|NM|1751-7^Albumin||4.0|g/dL|3.5-5.0|N|||F',
  'OBX|3|NM|1975-2^Bilirubin Total||0.8|mg/dL|0.1-1.2|N|||F',
].join('\r');

function ParsedSegment({ title, children }) {
  return (
    <div className="border border-slate-200 rounded-md">
      <div className="px-3 py-1.5 text-xs font-medium bg-slate-50 border-b border-slate-200 text-slate-700">{title}</div>
      <div className="px-3 py-2 text-xs text-slate-700 space-y-1">{children}</div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-slate-500">{k}</div>
      <div className="col-span-2 font-mono break-all">{v ?? '—'}</div>
    </div>
  );
}

export default function Hl7Inbox() {
  const { toast } = useToast();
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [ingestSummary, setIngestSummary] = useState(null);
  const [createPatient, setCreatePatient] = useState(true);
  const [updateDemographics, setUpdateDemographics] = useState(true);
  const [ingestObservations, setIngestObservations] = useState(true);

  const { data: supportedEvents } = useQuery({
    queryKey: ['hl7-supported-events'],
    queryFn: () => api.hl7.supportedEvents(),
    staleTime: Infinity,
  });

  const parseMutation = useMutation({
    mutationFn: () => api.hl7.parse(raw),
    onSuccess: (p) => { setParsed(p); setParseError(null); setIngestSummary(null); },
    onError: (e) => { setParseError(e.message); setParsed(null); setIngestSummary(null); },
  });

  const ingestMutation = useMutation({
    mutationFn: () => api.hl7.ingest({
      parsed,
      options: {
        createPatient,
        updateDemographics,
        ingestObservations,
      },
    }),
    onSuccess: (s) => {
      setIngestSummary(s);
      if (s.ok) {
        const action = s.patient?.action || 'no patient action';
        toast({ title: 'HL7 ingest complete', description: `Patient: ${action} · Labs: +${s.labs.inserted}` });
      } else {
        toast({ title: 'Ingest finished with warnings', description: (s.warnings || []).slice(0, 3).join('; ') || 'See details.', variant: 'destructive' });
      }
    },
    onError: (e) => toast({ title: 'Ingest failed', description: e.message, variant: 'destructive' }),
  });

  const ackPreview = useMemo(() => {
    if (!parsed) return null;
    return null; // built on demand below
  }, [parsed]);

  const buildAckMutation = useMutation({
    mutationFn: () => api.hl7.buildAck({ parsed_or_raw: parsed, code: 'AA', message: 'Accepted' }),
    onError: (e) => toast({ title: 'ACK build failed', description: e.message, variant: 'destructive' }),
  });

  const messageTypeBadge = parsed
    ? `${parsed.message_type || '?'}${parsed.trigger_event ? '^' + parsed.trigger_event : ''}`
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Inbox className="w-7 h-7 text-cyan-700" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">HL7 v2 Inbox</h1>
            <p className="text-slate-600 text-sm">
              Paste a raw HL7 v2.x message, preview the parsed structure, and (optionally) lift it into Patient + LabResult records.
            </p>
          </div>
        </div>
        {supportedEvents && (
          <div className="flex items-center gap-1 flex-wrap">
            {supportedEvents.map((e) => (
              <Badge key={e} variant="outline" className="font-mono text-[11px]">{e}</Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileCode className="w-4 h-4" /> Raw message</CardTitle>
            <CardDescription>Use CR (\r) or LF segment terminators. ADT and ORU are recognised.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              rows={14}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="MSH|^~\&|..."
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => parseMutation.mutate()} disabled={!raw.trim() || parseMutation.isPending}>
                {parseMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileCode className="w-4 h-4 mr-2" />}
                Parse
              </Button>
              <Button variant="outline" onClick={() => setRaw(SAMPLE_ADT)}>Load ADT^A04 sample</Button>
              <Button variant="outline" onClick={() => setRaw(SAMPLE_ORU)}>Load ORU^R01 sample</Button>
              <Button variant="ghost" onClick={() => { setRaw(''); setParsed(null); setParseError(null); setIngestSummary(null); }}>
                <Eraser className="w-4 h-4 mr-2" />Clear
              </Button>
            </div>
            {parseError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{parseError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Parsed</CardTitle>
              <CardDescription>Preview before performing any database writes.</CardDescription>
            </div>
            {parsed && (
              <Badge variant="secondary" className="font-mono">{messageTypeBadge}</Badge>
            )}
          </CardHeader>
          <CardContent>
            {!parsed ? (
              <div className="text-center text-slate-400 py-8">
                <FileCode className="w-10 h-10 mx-auto mb-2" />
                Parse a message to see its structure.
              </div>
            ) : (
              <Tabs defaultValue="summary">
                <TabsList>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="raw">Raw JSON</TabsTrigger>
                  <TabsTrigger value="ack">Build ACK</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="space-y-3 mt-3">
                  {parsed.warnings?.length > 0 && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{parsed.warnings.join('; ')}</AlertDescription>
                    </Alert>
                  )}
                  <ParsedSegment title="MSH">
                    <KV k="Sending app" v={parsed.sending_app} />
                    <KV k="Sending facility" v={parsed.sending_facility} />
                    <KV k="Receiving app" v={parsed.receiving_app} />
                    <KV k="Message type" v={`${parsed.message_type || '?'}^${parsed.trigger_event || '?'}`} />
                    <KV k="Control ID" v={parsed.message_control_id} />
                    <KV k="Timestamp" v={parsed.message_datetime} />
                  </ParsedSegment>

                  {parsed.patient && (
                    <ParsedSegment title="PID — Patient">
                      <KV k="MRN" v={parsed.patient.mrn} />
                      <KV k="Name" v={`${parsed.patient.last_name || '?'}, ${parsed.patient.first_name || '?'}`} />
                      <KV k="DOB" v={parsed.patient.date_of_birth} />
                      <KV k="Sex" v={parsed.patient.sex} />
                      <KV k="Phone" v={parsed.patient.phone} />
                    </ParsedSegment>
                  )}

                  {parsed.visit && (
                    <ParsedSegment title="PV1 — Visit">
                      <KV k="Patient class" v={parsed.visit.patient_class} />
                      <KV k="Location" v={parsed.visit.assigned_location} />
                      <KV k="Visit number" v={parsed.visit.visit_number} />
                    </ParsedSegment>
                  )}

                  {parsed.order && (
                    <ParsedSegment title="OBR — Order">
                      <KV k="Placer order #" v={parsed.order.placer_order_number} />
                      <KV k="Filler order #" v={parsed.order.filler_order_number} />
                      <KV k="Universal service" v={parsed.order.universal_service_id} />
                      <KV k="Observation date" v={parsed.order.observation_datetime} />
                    </ParsedSegment>
                  )}

                  {parsed.observations?.length > 0 && (
                    <ParsedSegment title={`OBX — Observations (${parsed.observations.length})`}>
                      <div className="space-y-1">
                        {parsed.observations.map((o, i) => (
                          <div key={i} className="grid grid-cols-6 gap-2 font-mono text-[11px]">
                            <div className="col-span-2 truncate">{o.test_code} {o.test_name ? `· ${o.test_name}` : ''}</div>
                            <div>{o.value}</div>
                            <div>{o.unit || ''}</div>
                            <div>{o.reference_range || ''}</div>
                            <div>{o.observation_datetime || ''}</div>
                          </div>
                        ))}
                      </div>
                    </ParsedSegment>
                  )}
                </TabsContent>

                <TabsContent value="raw" className="mt-3">
                  <pre className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[11px] font-mono overflow-auto max-h-96">
                    {JSON.stringify(parsed, null, 2)}
                  </pre>
                </TabsContent>

                <TabsContent value="ack" className="mt-3 space-y-3">
                  <Button variant="outline" onClick={() => buildAckMutation.mutate()} disabled={buildAckMutation.isPending}>
                    {buildAckMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Build ACK (AA)
                  </Button>
                  {buildAckMutation.data?.ack && (
                    <pre className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[11px] font-mono overflow-auto max-h-60 whitespace-pre-wrap">
                      {buildAckMutation.data.ack}
                    </pre>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4" /> Lift into internal entities</CardTitle>
          <CardDescription>
            PID becomes Patient (lookup by MRN); OBX rows become LabResult entries on ORU^R01 messages.
            All work happens inside one SQLite transaction — nothing is written if anything fails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex items-start gap-2 p-3 rounded-md border border-slate-200">
              <input type="checkbox" checked={createPatient} onChange={(e) => setCreatePatient(e.target.checked)} className="mt-1" />
              <div>
                <div className="text-sm font-medium">Create patient if MRN not found</div>
                <div className="text-xs text-slate-500">Off = skip messages with unknown MRNs.</div>
              </div>
            </label>
            <label className="flex items-start gap-2 p-3 rounded-md border border-slate-200">
              <input type="checkbox" checked={updateDemographics} onChange={(e) => setUpdateDemographics(e.target.checked)} className="mt-1" />
              <div>
                <div className="text-sm font-medium">Update demographics on existing patient</div>
                <div className="text-xs text-slate-500">Name / DOB / phone, when present.</div>
              </div>
            </label>
            <label className="flex items-start gap-2 p-3 rounded-md border border-slate-200">
              <input type="checkbox" checked={ingestObservations} onChange={(e) => setIngestObservations(e.target.checked)} className="mt-1" />
              <div>
                <div className="text-sm font-medium">Ingest OBX observations</div>
                <div className="text-xs text-slate-500">Writes one lab_result row per OBX.</div>
              </div>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => ingestMutation.mutate()} disabled={!parsed || ingestMutation.isPending}>
              {ingestMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowDownToLine className="w-4 h-4 mr-2" />}
              Ingest into database
            </Button>
            {!parsed && <span className="text-xs text-slate-500">Parse a message first.</span>}
          </div>

          {ingestSummary && (
            <Card className="border-slate-200">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  {ingestSummary.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                  Ingest result
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                {ingestSummary.patient ? (
                  <KV k="Patient" v={`${ingestSummary.patient.action.toUpperCase()} · ${ingestSummary.patient.last_name || ''}, ${ingestSummary.patient.first_name || ''} · MRN ${ingestSummary.patient.mrn || '—'}`} />
                ) : (
                  <KV k="Patient" v="No patient action" />
                )}
                <KV k="Labs inserted" v={ingestSummary.labs.inserted} />
                <KV k="Labs skipped" v={ingestSummary.labs.skipped} />
                {ingestSummary.warnings?.length > 0 && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{ingestSummary.warnings.join('; ')}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
