/**
 * TransTrack — Inactivation Prevention Action Queue.
 *
 * Turns the deterministic inactivation risk engine into a coordinator-ready,
 * ranked worklist:
 *
 *   • Queue tab      — highest-priority patients with the single recommended
 *                      action and its expected score/probability reduction.
 *   • Outcomes tab   — center-level measured effectiveness per intervention
 *                      type (recorded vs measured, average score delta).
 *   • Digest tab     — manager headline: projected inactivations avoided and
 *                      estimated dollars preserved if the queue is worked.
 *
 * Every number is stamped with the engine model version. All data comes from
 * the audited, org-scoped IPC surface (actionQueue:*).
 */
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  ListChecks, RefreshCw, Info, TrendingDown, Target,
  ClipboardCheck, Activity, History, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import ErrorState from '@/components/ui/ErrorState';
import { api } from '@/api/apiClient';

const INTERVENTION_LABELS = {
  resolveAllBarriers: 'Resolve readiness barriers',
  resolveBarrier: 'Resolve specific barrier',
  refreshEvaluation: 'Renew evaluation',
  refreshDocument: 'Update documentation',
  refreshLabs: 'Refresh lab documentation',
  refreshAHHQ: 'Renew aHHQ',
  recordContact: 'Contact patient',
  other: 'Other action',
};

const FACTOR_LABELS = {
  BARRIERS: 'Readiness barriers',
  EVAL_EXPIRY: 'Evaluation expiry',
  DOCUMENTATION: 'Stale documentation',
  LAB_CURRENCY: 'Lab currency',
  AHHQ_CURRENCY: 'aHHQ currency',
  CONTACT_RECENCY: 'Contact recency',
};

const RISK_BADGE = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  moderate: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-green-100 text-green-700 border-green-200',
  none: 'bg-slate-100 text-slate-600 border-slate-200',
};

function pct(v) {
  if (v === null || v === undefined) return '—';
  return `${Math.round(v * 1000) / 10}%`;
}

/** Per-patient intervention history with "measure outcome" for open items. */
function InterventionHistory({ patientId, onChanged }) {
  const [measuringId, setMeasuringId] = useState(null);
  const { data: history, isLoading, refetch } = useQuery({
    queryKey: ['interventionHistory', patientId],
    queryFn: () => api.actionQueue.getInterventionsForPatient({ patientId }),
  });

  const measureOutcome = async (interventionId) => {
    setMeasuringId(interventionId);
    try {
      const r = await api.actionQueue.recordOutcome({ interventionId, patientId });
      if (r?.updated === false) {
        toast.error('Intervention not found — it may belong to another organization.');
      } else {
        const delta = r?.measured_score_delta;
        toast.success(
          delta !== null && delta !== undefined
            ? `Outcome measured: score reduced by ${delta} points.`
            : 'Outcome measured.'
        );
      }
      await refetch();
      onChanged?.();
    } catch (err) {
      toast.error(err?.message || 'Failed to record outcome.');
    } finally {
      setMeasuringId(null);
    }
  };

  if (isLoading) {
    return <div className="text-sm text-slate-500 py-2">Loading intervention history…</div>;
  }
  if (!history || history.length === 0) {
    return <div className="text-sm text-slate-500 py-2">No interventions recorded for this patient yet.</div>;
  }

  return (
    <div className="space-y-2 py-2">
      {history.map((iv) => (
        <div key={iv.id} className="flex items-center justify-between p-3 bg-white rounded-lg border text-sm">
          <div>
            <div className="font-medium text-slate-800">
              {INTERVENTION_LABELS[iv.intervention_type] || iv.intervention_type}
              {iv.target_factor && (
                <span className="text-slate-500 font-normal ml-2">
                  ({FACTOR_LABELS[iv.target_factor] || iv.target_factor})
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {iv.performed_by} • {iv.created_at}
              {iv.notes && <span className="ml-2 italic">“{iv.notes}”</span>}
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              Score before: <strong>{iv.score_before ?? '—'}</strong>
              {iv.measured_at ? (
                <>
                  {' '}→ after: <strong>{iv.score_after ?? '—'}</strong>
                  {iv.measured_score_delta !== null && (
                    <Badge className="ml-2 bg-green-100 text-green-700 border-green-200">
                      −{iv.measured_score_delta} pts
                    </Badge>
                  )}
                </>
              ) : null}
            </div>
          </div>
          <div>
            {iv.measured_at ? (
              <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Measured
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={measuringId === iv.id}
                onClick={() => measureOutcome(iv.id)}
              >
                {measuringId === iv.id ? 'Measuring…' : 'Measure outcome'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PreventionQueue() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [logTarget, setLogTarget] = useState(null); // queue entry being acted on
  const [logType, setLogType] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [expandedPatientId, setExpandedPatientId] = useState(null);

  const { data: queueReport, isLoading, isError, refetch } = useQuery({
    queryKey: ['actionQueue'],
    queryFn: () => api.actionQueue.build({ size: 25 }),
    refetchInterval: 120000,
  });

  const { data: effectiveness } = useQuery({
    queryKey: ['preventionEffectiveness'],
    queryFn: () => api.actionQueue.getInterventionEffectiveness({ windowDays: 90 }),
    retry: false,
  });

  const { data: digest, error: digestError } = useQuery({
    queryKey: ['preventionDigest'],
    queryFn: () => api.actionQueue.buildDigest({}),
    retry: false,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.allSettled([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['preventionEffectiveness'] }),
      queryClient.invalidateQueries({ queryKey: ['preventionDigest'] }),
    ]);
    setIsRefreshing(false);
  };

  const openLogDialog = (entry) => {
    setLogTarget(entry);
    setLogType(entry.recommendedAction?.actionType || 'other');
    setLogNotes('');
  };

  const submitIntervention = async () => {
    if (!logTarget) return;
    setIsSaving(true);
    try {
      const r = await api.actionQueue.recordIntervention({
        patientId: logTarget.patientId,
        interventionType: logType,
        targetFactor: logTarget.recommendedAction?.factor || null,
        notes: logNotes || null,
      });
      toast.success(
        `Action logged. Score at time of action: ${r?.assessmentBefore?.score ?? '—'} ` +
        `(${r?.assessmentBefore?.riskLevel ?? ''}, model ${r?.assessmentBefore?.modelVersion ?? ''}).`
      );
      setLogTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['interventionHistory', logTarget.patientId] });
      await queryClient.invalidateQueries({ queryKey: ['preventionEffectiveness'] });
    } catch (err) {
      toast.error(err?.message || 'Failed to record intervention.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  if (isError) {
    return <ErrorState title="Action queue unavailable" />;
  }

  const impact = queueReport?.aggregateExpectedImpact;
  const distribution = queueReport?.distribution || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <ListChecks className="w-8 h-8 text-cyan-600" />
              Prevention Action Queue
            </h1>
            <p className="text-slate-600 mt-1">
              Ranked coordinator worklist to prevent waitlist inactivations
              {queueReport?.modelVersion && (
                <span className="text-slate-400"> • engine model {queueReport.modelVersion}</span>
              )}
            </p>
          </div>
          <Button onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Non-clinical disclaimer */}
        <Alert className="bg-blue-50 border-blue-200">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-700 text-sm">
            <strong>Non-Clinical Notice:</strong> This queue is an operational coordination signal.
            It is not a clinical recommendation, and allocation decisions remain with OPTN/UNet.
          </AlertDescription>
        </Alert>

        {/* Summary tiles */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-cyan-200 bg-cyan-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-cyan-700 flex items-center gap-2">
                <Activity className="w-4 h-4" /> Patients Screened
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-900">{queueReport?.candidatesScreened ?? 0}</div>
              <p className="text-xs text-cyan-600 mt-1">Active waitlist candidates</p>
            </CardContent>
          </Card>
          <Card className="border-orange-200 bg-orange-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-700 flex items-center gap-2">
                <Target className="w-4 h-4" /> In Queue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-900">{queueReport?.queueSize ?? 0}</div>
              <p className="text-xs text-orange-600 mt-1">
                {distribution.critical || 0} critical, {distribution.high || 0} high
              </p>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-700 flex items-center gap-2">
                <TrendingDown className="w-4 h-4" /> Projected Avoided
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-900">
                {impact?.projectedInactivationsAvoidedWithin90Days ?? 0}
              </div>
              <p className="text-xs text-green-600 mt-1">Inactivations within 90 days if queue is worked</p>
            </CardContent>
          </Card>
          <Card className="border-purple-200 bg-purple-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-purple-700 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4" /> Actions Measured
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-900">
                {effectiveness?.totals?.measured ?? 0}
                <span className="text-lg font-normal text-purple-600 ml-2">
                  / {effectiveness?.totals?.recorded ?? 0}
                </span>
              </div>
              <p className="text-xs text-purple-600 mt-1">Measured vs recorded (last {effectiveness?.windowDays ?? 90} days)</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="queue" className="space-y-4">
          <TabsList>
            <TabsTrigger value="queue">Action Queue</TabsTrigger>
            <TabsTrigger value="outcomes">Measured Outcomes</TabsTrigger>
            <TabsTrigger value="digest">Manager Digest</TabsTrigger>
          </TabsList>

          {/* Queue tab */}
          <TabsContent value="queue">
            <Card>
              <CardHeader>
                <CardTitle>Prioritized Patients</CardTitle>
                <CardDescription>
                  Ordered by risk score × evaluation-expiry urgency. Log the recommended action,
                  then measure the outcome once the underlying issue is resolved.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {queueReport?.queue?.length > 0 ? (
                  <div className="space-y-3">
                    {queueReport.queue.map((entry, idx) => (
                      <div key={entry.patientId} className="p-4 bg-slate-50 rounded-lg border">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm shrink-0">
                              {idx + 1}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Link
                                  to={`${createPageUrl('PatientDetails')}?id=${entry.patientId}`}
                                  className="font-medium text-slate-900 hover:text-cyan-600"
                                >
                                  {entry.patientName || entry.patientId}
                                </Link>
                                {entry.mrn && <span className="text-xs text-slate-500">{entry.mrn}</span>}
                                <Badge className={RISK_BADGE[entry.riskLevel] || RISK_BADGE.none}>
                                  {entry.riskLevel} • {entry.score}
                                </Badge>
                                {entry.daysUntilEvaluationExpiry !== null &&
                                  entry.daysUntilEvaluationExpiry !== undefined &&
                                  entry.daysUntilEvaluationExpiry <= 30 && (
                                  <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
                                    Eval expires in {entry.daysUntilEvaluationExpiry}d
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                90-day inactivation probability: <strong>{pct(entry.probabilityWithin90Days)}</strong>
                                {entry.organNeeded && <span className="ml-2">• {entry.organNeeded}</span>}
                              </div>
                              {entry.recommendedAction && (
                                <div className="mt-2 text-sm text-slate-700">
                                  <span className="font-medium">Recommended:</span>{' '}
                                  {entry.recommendedAction.actionDescription}
                                  <span className="text-green-700 ml-2">
                                    (−{entry.recommendedAction.expectedScoreReduction} pts →{' '}
                                    {entry.recommendedAction.expectedNewRiskLevel})
                                  </span>
                                </div>
                              )}
                              {entry.topThreeFactors?.length > 0 && (
                                <div className="flex gap-1 mt-2 flex-wrap">
                                  {entry.topThreeFactors.map((f) => (
                                    <Badge key={f.factor} variant="outline" className="text-xs">
                                      {FACTOR_LABELS[f.factor] || f.factor}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            <Button size="sm" onClick={() => openLogDialog(entry)}>
                              Log Action
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setExpandedPatientId(
                                  expandedPatientId === entry.patientId ? null : entry.patientId
                                )
                              }
                            >
                              <History className="w-3.5 h-3.5 mr-1" />
                              History
                            </Button>
                          </div>
                        </div>
                        {expandedPatientId === entry.patientId && (
                          <div className="mt-3 border-t pt-2">
                            <InterventionHistory
                              patientId={entry.patientId}
                              onChanged={handleRefresh}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-300" />
                    <p className="font-medium">Queue is clear</p>
                    <p className="text-sm">No patients currently require prevention actions</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Outcomes tab */}
          <TabsContent value="outcomes">
            <Card>
              <CardHeader>
                <CardTitle>Measured Intervention Effectiveness</CardTitle>
                <CardDescription>
                  Recorded coordinator actions and their measured before/after score deltas
                  (last {effectiveness?.windowDays ?? 90} days)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {effectiveness?.perInterventionType?.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Intervention</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Recorded</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Measured</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Avg Score Δ</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Avg 90-day Prob Δ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {effectiveness.perInterventionType.map((row) => (
                          <tr key={row.interventionType} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium">
                              {INTERVENTION_LABELS[row.interventionType] || row.interventionType}
                            </td>
                            <td className="px-4 py-3 text-center">{row.recorded}</td>
                            <td className="px-4 py-3 text-center">{row.measured}</td>
                            <td className="px-4 py-3 text-center">
                              {row.averageScoreDelta ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {pct(row.averageProbability90Delta)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <ClipboardCheck className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No interventions recorded in this window yet</p>
                    <p className="text-sm mt-1">
                      Log actions from the queue tab; measured outcomes appear here.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Digest tab */}
          <TabsContent value="digest">
            <Card>
              <CardHeader>
                <CardTitle>Manager Prevention Digest</CardTitle>
                <CardDescription>
                  Center-level projection of prevented inactivations and preserved revenue
                  {digest?.modelVersion && ` • engine model ${digest.modelVersion}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {digest?.headline ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-4 bg-slate-50 rounded-lg border">
                        <div className="text-sm text-slate-600">Baseline expected inactivations</div>
                        <div className="text-2xl font-bold text-slate-900">
                          {digest.headline.expectedInactivationsBaseline}
                        </div>
                        <div className="text-xs text-slate-400">next 90 days, no action</div>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-lg border">
                        <div className="text-sm text-slate-600">After recommended actions</div>
                        <div className="text-2xl font-bold text-slate-900">
                          {digest.headline.expectedInactivationsAfterRecommendedActions}
                        </div>
                        <div className="text-xs text-slate-400">next 90 days, queue worked</div>
                      </div>
                      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                        <div className="text-sm text-green-700">Inactivations avoided</div>
                        <div className="text-2xl font-bold text-green-900">
                          {digest.headline.inactivationsAvoided}
                        </div>
                      </div>
                      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                        <div className="text-sm text-green-700">Estimated dollars preserved</div>
                        <div className="text-2xl font-bold text-green-900">
                          ${Number(digest.headline.estimatedDollarsAvoided || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {digest.headline.coordinatorOverloads?.length > 0 && (
                      <Alert className="bg-amber-50 border-amber-200">
                        <Info className="h-4 w-4 text-amber-600" />
                        <AlertDescription className="text-amber-700 text-sm">
                          <strong>Coordinator load imbalance:</strong>{' '}
                          {digest.headline.coordinatorOverloads.length} coordinator(s) own a
                          disproportionate share of at-risk patients. Consider rebalancing assignments.
                        </AlertDescription>
                      </Alert>
                    )}

                    {digest.disclaimer && (
                      <p className="text-xs text-slate-400">{digest.disclaimer}</p>
                    )}
                  </div>
                ) : digestError ? (
                  <div className="text-center py-8 text-slate-500">
                    <Info className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>{digestError.message?.includes('role')
                      ? 'The manager digest requires an admin, coordinator, or regulator role.'
                      : 'Digest unavailable.'}</p>
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <RefreshCw className="w-6 h-6 mx-auto animate-spin text-slate-300" />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Log-action dialog */}
        <Dialog open={!!logTarget} onOpenChange={(open) => { if (!open) setLogTarget(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log Prevention Action</DialogTitle>
              <DialogDescription>
                {logTarget && (
                  <>Recording an action for <strong>{logTarget.patientName || logTarget.patientId}</strong>.
                  The engine score at this moment is captured as the “before” snapshot.</>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="intervention-type">Action taken</Label>
                <select
                  id="intervention-type"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={logType}
                  onChange={(e) => setLogType(e.target.value)}
                >
                  {Object.entries(INTERVENTION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intervention-notes">Notes (optional)</Label>
                <Textarea
                  id="intervention-notes"
                  value={logNotes}
                  onChange={(e) => setLogNotes(e.target.value)}
                  placeholder="e.g. Called patient, transportation barrier resolved with social work"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLogTarget(null)} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={submitIntervention} disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Record Action'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {queueReport?.disclaimer && (
          <p className="text-xs text-slate-400">{queueReport.disclaimer}</p>
        )}
      </div>
    </div>
  );
}
