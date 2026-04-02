import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  RefreshCw, BarChart3, ArrowUpRight,
  ArrowDownRight, Minus, Save, Info, CheckCircle, AlertTriangle,
  Calendar, Target, Activity
} from 'lucide-react';
import { formatDate } from '@/utils';

function TrendIndicator({ current, previous, inverted = false }) {
  if (previous === undefined || previous === null) return <Minus className="w-4 h-4 text-slate-400" />;
  const delta = current - previous;
  if (delta === 0) return <Minus className="w-4 h-4 text-slate-400" />;
  const isPositive = inverted ? delta < 0 : delta > 0;
  return (
    <span className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
      {Math.abs(delta)}
    </span>
  );
}

export default function OutcomesDashboard() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: dashboard, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['outcomesDashboard'],
    queryFn: async () => {
      if (window.electronAPI?.outcomes) {
        return await window.electronAPI.outcomes.getDashboard();
      }
      return null;
    },
    refetchInterval: 120000,
  });

  const saveSnapshotMutation = useMutation({
    mutationFn: async () => {
      if (!window.electronAPI?.outcomes) throw new Error('Outcomes API not available');
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return await window.electronAPI.outcomes.saveSnapshot(
        thirtyDaysAgo.toISOString(), now.toISOString()
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['outcomesDashboard'] }),
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

  const current = dashboard?.current || {};
  const trends = dashboard?.trends || {};
  const history = dashboard?.historicalSnapshots || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-cyan-600" />
              Outcomes Dashboard
            </h1>
            <p className="text-slate-600 mt-1">
              Track operational outcomes and measure TransTrack ROI
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
              Failed to load outcomes data: {error?.message || 'Unknown error'}. Please try refreshing.
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

        {saveSnapshotMutation.isSuccess && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700">Snapshot saved successfully.</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-700 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Evals Renewed On Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-green-900">{current.evaluations_renewed_on_time || 0}</div>
                <TrendIndicator current={current.evaluations_renewed_on_time} previous={trends.evaluations_renewed_on_time?.previous} />
              </div>
              <p className="text-xs text-green-600 mt-1">Last 30 days</p>
            </CardContent>
          </Card>

          <Card className="border-red-200 bg-red-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Evaluations Lapsed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-red-900">{current.evaluations_lapsed || 0}</div>
                <TrendIndicator current={current.evaluations_lapsed} previous={trends.evaluations_lapsed?.previous} inverted />
              </div>
              <p className="text-xs text-red-600 mt-1">Currently expired</p>
            </CardContent>
          </Card>

          <Card className="border-cyan-200 bg-cyan-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-cyan-700 flex items-center gap-2">
                <Target className="w-4 h-4" />
                Barriers Resolved
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-cyan-900">{current.barriers_resolved || 0}</div>
                <TrendIndicator current={current.barriers_resolved} previous={trends.barriers_resolved?.previous} />
              </div>
              <p className="text-xs text-cyan-600 mt-1">Avg {current.avg_barrier_resolution_days || 0} days to resolve</p>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-amber-700 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Total Inactivations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-amber-900">{current.total_inactivations || 0}</div>
                <TrendIndicator current={current.total_inactivations} previous={trends.total_inactivations?.previous} inverted />
              </div>
              <p className="text-xs text-amber-600 mt-1">Last 30 days</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Metrics Overview</TabsTrigger>
            <TabsTrigger value="tasks">Task Metrics</TabsTrigger>
            <TabsTrigger value="history">Snapshot History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Risk Management Metrics</CardTitle>
                  <CardDescription>Current period operational risk indicators</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Active Patients</span>
                    <span className="font-bold text-slate-900">{current.total_active_patients || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Patients At Risk</span>
                    <span className="font-bold text-slate-900">
                      {current.patients_at_risk || 0}
                      <span className="text-sm font-normal text-slate-500 ml-1">({current.patients_at_risk_percentage || 0}%)</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Risk Alerts Generated</span>
                    <span className="font-bold text-slate-900">{current.risk_alerts_generated || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Risk Alerts Acted On</span>
                    <span className="font-bold text-slate-900">
                      {current.risk_alerts_acted_on || 0}
                      {current.risk_alerts_generated > 0 && (
                        <span className="text-sm font-normal text-slate-500 ml-1">
                          ({Math.round((current.risk_alerts_acted_on / current.risk_alerts_generated) * 100)}%)
                        </span>
                      )}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Barrier Resolution</CardTitle>
                  <CardDescription>Readiness barrier management performance</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Barriers Opened</span>
                    <span className="font-bold text-slate-900">{current.barriers_opened || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Barriers Resolved</span>
                    <span className="font-bold text-green-700">{current.barriers_resolved || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Avg Resolution Time</span>
                    <span className="font-bold text-slate-900">{current.avg_barrier_resolution_days || 0} days</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Risk Alerts Resolved</span>
                    <span className="font-bold text-green-700">{current.risk_alerts_with_resolution || 0}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="tasks">
            <Card>
              <CardHeader>
                <CardTitle>Task Automation Metrics</CardTitle>
                <CardDescription>Automated task generation and completion performance</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 text-center">
                    <div className="text-sm text-blue-600">Auto-Generated Tasks</div>
                    <div className="text-3xl font-bold text-blue-900 mt-1">{current.tasks_auto_generated || 0}</div>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200 text-center">
                    <div className="text-sm text-green-600">Completed On Time</div>
                    <div className="text-3xl font-bold text-green-900 mt-1">{current.tasks_completed_on_time || 0}</div>
                  </div>
                  <div className="p-4 bg-orange-50 rounded-lg border border-orange-200 text-center">
                    <div className="text-sm text-orange-600">Tasks Escalated</div>
                    <div className="text-3xl font-bold text-orange-900 mt-1">{current.tasks_escalated || 0}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Snapshot History</CardTitle>
                <CardDescription>
                  Previously saved outcome snapshots for trend analysis
                </CardDescription>
              </CardHeader>
              <CardContent>
                {history.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Date</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Active Patients</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Inactivations</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Evals Renewed</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Barriers Resolved</th>
                          <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">At-Risk %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {history.map((snap) => (
                          <tr key={snap.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-sm">{formatDate(snap.snapshot_date)}</td>
                            <td className="px-4 py-3 text-center font-medium">{snap.total_active_patients}</td>
                            <td className="px-4 py-3 text-center">
                              <Badge className={snap.total_inactivations > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                                {snap.total_inactivations}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-center font-medium text-green-700">{snap.evaluations_renewed_on_time}</td>
                            <td className="px-4 py-3 text-center font-medium">{snap.barriers_resolved}</td>
                            <td className="px-4 py-3 text-center">
                              <Badge className={
                                snap.patients_at_risk_percentage > 20 ? 'bg-red-100 text-red-700' :
                                snap.patients_at_risk_percentage > 10 ? 'bg-amber-100 text-amber-700' :
                                'bg-green-100 text-green-700'
                              }>
                                {snap.patients_at_risk_percentage}%
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
                    <p className="font-medium">No snapshots saved yet</p>
                    <p className="text-sm mt-1">Click &quot;Save Snapshot&quot; to record current metrics</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Alert className="bg-blue-50 border-blue-200">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-700 text-sm">
            Outcomes data is computed from operational signals in your local database.
            Save periodic snapshots to track improvement trends over time.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
