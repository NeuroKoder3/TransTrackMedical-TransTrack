import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ClipboardCheck, RefreshCw, Save, CheckCircle, XCircle, AlertTriangle,
  Info, Calendar, Shield
} from 'lucide-react';
import { formatDate } from '@/utils';

function CheckStatusIcon({ status }) {
  if (status === 'pass') return <CheckCircle className="w-5 h-5 text-green-600" />;
  if (status === 'warning') return <AlertTriangle className="w-5 h-5 text-amber-600" />;
  return <XCircle className="w-5 h-5 text-red-600" />;
}

function OverallScoreRing({ score, status }) {
  const radius = 70;
  const stroke = 12;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const dim = (radius + stroke) * 2;

  let color = '#22c55e';
  if (status === 'at_risk') color = '#ef4444';
  else if (status === 'needs_attention') color = '#f59e0b';

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={dim} height={dim} className="transform -rotate-90">
        <circle cx={radius + stroke} cy={radius + stroke} r={radius}
          fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={radius + stroke} cy={radius + stroke} r={radius}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-1000" />
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-bold" style={{ color }}>{score}%</div>
        <div className="text-xs text-slate-500 capitalize">{status?.replace('_', ' ')}</div>
      </div>
    </div>
  );
}

export default function CMSReadiness() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: dashboard, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['srtrDashboard'],
    queryFn: async () => {
      if (window.electronAPI?.srtr) {
        return await window.electronAPI.srtr.getDashboard();
      }
      return null;
    },
    refetchInterval: 120000,
  });

  const saveSnapshotMutation = useMutation({
    mutationFn: async () => {
      if (window.electronAPI?.srtr) {
        return await window.electronAPI.srtr.saveSnapshot();
      }
      throw new Error('SRTR API not available');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['srtrDashboard'] }),
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  const metrics = dashboard?.currentMetrics || {};
  const checklist = dashboard?.cmsChecklist || {};
  const history = dashboard?.historicalMetrics || [];
  const checks = checklist.checks || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <ClipboardCheck className="w-8 h-8 text-cyan-600" />
              CMS/SRTR Readiness
            </h1>
            <p className="text-slate-600 mt-1">
              Monitor operational metrics and CMS survey readiness
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => saveSnapshotMutation.mutate()} disabled={saveSnapshotMutation.isPending}>
              <Save className={`w-4 h-4 mr-2 ${saveSnapshotMutation.isPending ? 'animate-spin' : ''}`} />
              Save Snapshot
            </Button>
            <Button onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {isError && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-700 text-sm">
              Failed to load CMS readiness data: {error?.message || 'Unknown error'}. Please try refreshing.
            </AlertDescription>
          </Alert>
        )}

        {saveSnapshotMutation.isError && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-700 text-sm">
              Failed to save snapshot: {saveSnapshotMutation.error?.message || 'Unknown error'}
            </AlertDescription>
          </Alert>
        )}

        <Alert className="bg-blue-50 border-blue-200">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-700 text-sm">
            <strong>Non-Clinical Notice:</strong> These metrics are operational approximations computed from local data.
            They do NOT replace official SRTR Program-Specific Reports or CMS survey data.
          </AlertDescription>
        </Alert>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <Card className="w-full lg:w-auto">
            <CardHeader>
              <CardTitle className="text-center">CMS Survey Readiness</CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center pb-6">
              <OverallScoreRing score={checklist.overallScore || 0} status={checklist.overallStatus || 'at_risk'} />
            </CardContent>
          </Card>

          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-xs text-slate-500">Total Waitlisted</div>
                <div className="text-2xl font-bold text-slate-900">{metrics.total_waitlisted || 0}</div>
              </CardContent>
            </Card>
            <Card className={metrics.inactive_percentage > 15 ? 'border-red-200 bg-red-50' : ''}>
              <CardContent className="p-4 text-center">
                <div className="text-xs text-slate-500">Inactive Rate</div>
                <div className={`text-2xl font-bold ${metrics.inactive_percentage > 15 ? 'text-red-900' : 'text-slate-900'}`}>
                  {metrics.inactive_percentage || 0}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-xs text-slate-500">Median Wait</div>
                <div className="text-2xl font-bold text-slate-900">{metrics.median_wait_days || 0} <span className="text-sm font-normal">days</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-xs text-slate-500">Eval Completion</div>
                <div className={`text-2xl font-bold ${metrics.evaluation_completion_rate < 80 ? 'text-red-900' : 'text-green-900'}`}>
                  {metrics.evaluation_completion_rate || 0}%
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Tabs defaultValue="checklist" className="space-y-4">
          <TabsList>
            <TabsTrigger value="checklist">CMS Checklist</TabsTrigger>
            <TabsTrigger value="metrics">Program Metrics</TabsTrigger>
            <TabsTrigger value="history">Metric History</TabsTrigger>
          </TabsList>

          <TabsContent value="checklist">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  CMS Conditions of Participation Checklist
                </CardTitle>
                <CardDescription>
                  Operational readiness checks aligned with CMS survey requirements.
                  {checklist.summary && (
                    <span className="ml-2">
                      <Badge className="bg-green-100 text-green-700 mr-1">{checklist.summary.pass} Pass</Badge>
                      {checklist.summary.warning > 0 && <Badge className="bg-amber-100 text-amber-700 mr-1">{checklist.summary.warning} Warning</Badge>}
                      {checklist.summary.fail > 0 && <Badge className="bg-red-100 text-red-700">{checklist.summary.fail} Fail</Badge>}
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {checks.map((check) => (
                    <div key={check.id}
                      className={`p-4 rounded-lg border ${
                        check.status === 'pass' ? 'bg-green-50 border-green-200' :
                        check.status === 'warning' ? 'bg-amber-50 border-amber-200' :
                        'bg-red-50 border-red-200'
                      }`}>
                      <div className="flex items-start gap-3">
                        <CheckStatusIcon status={check.status} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs">{check.category}</Badge>
                            <span className="font-medium text-slate-900">{check.requirement}</span>
                          </div>
                          <p className="text-sm text-slate-600">{check.metric}</p>
                          {check.remediation && (
                            <p className="text-sm text-red-700 mt-1 font-medium">
                              Action: {check.remediation}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="metrics">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Waitlist Composition</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Active Waitlisted</span>
                    <span className="font-bold text-green-700">{metrics.active_waitlisted || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Inactive Waitlisted</span>
                    <span className="font-bold text-amber-700">{metrics.inactive_waitlisted || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Inactivation Rate</span>
                    <Badge className={metrics.inactive_percentage > 15 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                      {metrics.inactive_percentage || 0}%
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">New Listings (30d)</span>
                    <span className="font-bold">{metrics.new_listings || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Transplanted</span>
                    <span className="font-bold text-green-700">{metrics.removals_transplanted || 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Operational Quality</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Median Wait Time</span>
                    <span className="font-bold">{metrics.median_wait_days || 0} days</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Transplant Rate</span>
                    <span className="font-bold">{metrics.transplant_rate || 0}%</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Evaluation Completion</span>
                    <Badge className={metrics.evaluation_completion_rate < 80 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                      {metrics.evaluation_completion_rate || 0}%
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Documentation Completeness</span>
                    <Badge className={metrics.documentation_completeness_rate < 70 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                      {metrics.documentation_completeness_rate || 0}%
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">CMS Risk Level</span>
                    <Badge className={
                      metrics.cms_survey_risk_level === 'critical' ? 'bg-red-100 text-red-700' :
                      metrics.cms_survey_risk_level === 'high' ? 'bg-orange-100 text-orange-700' :
                      metrics.cms_survey_risk_level === 'moderate' ? 'bg-amber-100 text-amber-700' :
                      'bg-green-100 text-green-700'
                    }>
                      {metrics.cms_survey_risk_level || 'N/A'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {metrics.cms_risk_factors && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                      Risk Factors
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      let factors = [];
                      try { factors = JSON.parse(metrics.cms_risk_factors || '[]'); } catch { factors = []; }
                      if (factors.length === 0) {
                        return <p className="text-green-600 font-medium">No risk factors identified. Operational metrics are within CMS benchmarks.</p>;
                      }
                      return (
                        <div className="space-y-2">
                          {factors.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                              <span className="text-sm text-amber-800">{f}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Metric History</CardTitle>
                <CardDescription>Previously saved SRTR metric snapshots for trend analysis</CardDescription>
              </CardHeader>
              <CardContent>
                {history.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Date</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Period</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Active</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Inactive %</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Eval Rate</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Doc Rate</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">CMS Risk</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {history.map((snap) => (
                          <tr key={snap.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-sm">{formatDate(snap.metric_date)}</td>
                            <td className="px-4 py-3 text-center text-sm">{snap.period_label || '—'}</td>
                            <td className="px-4 py-3 text-center font-medium">{snap.active_waitlisted}</td>
                            <td className="px-4 py-3 text-center">
                              <Badge className={snap.inactive_percentage > 15 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                                {snap.inactive_percentage}%
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge className={snap.evaluation_completion_rate < 80 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                                {snap.evaluation_completion_rate}%
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-center">{snap.documentation_completeness_rate}%</td>
                            <td className="px-4 py-3 text-center">
                              <Badge className={
                                snap.cms_survey_risk_level === 'critical' ? 'bg-red-100 text-red-700' :
                                snap.cms_survey_risk_level === 'high' ? 'bg-orange-100 text-orange-700' :
                                snap.cms_survey_risk_level === 'moderate' ? 'bg-amber-100 text-amber-700' :
                                'bg-green-100 text-green-700'
                              }>
                                {snap.cms_survey_risk_level}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    <Calendar className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-medium">No metric snapshots saved yet</p>
                    <p className="text-sm mt-1">Click &quot;Save Snapshot&quot; to record current SRTR metrics</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
