import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain, RefreshCw, AlertTriangle, TrendingUp, Users,
  Info, ExternalLink, Play, Zap, ShieldAlert
} from 'lucide-react';
import { createPageUrl, formatDate } from '@/utils';
import { api } from '@/api/apiClient';

function RiskGauge({ score, size = 'large' }) {
  const radius = size === 'large' ? 60 : 30;
  const stroke = size === 'large' ? 10 : 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const dim = (radius + stroke) * 2;

  let color = '#22c55e';
  if (score >= 75) color = '#ef4444';
  else if (score >= 50) color = '#f97316';
  else if (score >= 25) color = '#eab308';

  return (
    <svg width={dim} height={dim} className="transform -rotate-90">
      <circle cx={radius + stroke} cy={radius + stroke} r={radius}
        fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
      <circle cx={radius + stroke} cy={radius + stroke} r={radius}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" className="transition-all duration-700" />
      <text x={radius + stroke} y={radius + stroke}
        textAnchor="middle" dominantBaseline="central"
        className="transform rotate-90 origin-center"
        fill={color} fontSize={size === 'large' ? 20 : 12} fontWeight="bold"
        style={{ transform: `rotate(90deg)`, transformOrigin: `${radius + stroke}px ${radius + stroke}px` }}>
        {Math.round(score)}
      </text>
    </svg>
  );
}

function RiskBadge({ level }) {
  const styles = {
    critical: 'bg-red-100 text-red-700 border-red-200',
    high: 'bg-orange-100 text-orange-700 border-orange-200',
    moderate: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    low: 'bg-green-100 text-green-700 border-green-200',
  };
  const label = level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Unknown';
  return (
    <Badge className={styles[level] || 'bg-slate-100 text-slate-700'}>
      {label}
    </Badge>
  );
}

export default function PredictiveRisk() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: dashboard, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['predictionsDashboard'],
    queryFn: () => api.predictions.getDashboard(),
    refetchInterval: 120000,
  });

  const runPredictionsMutation = useMutation({
    mutationFn: () => api.predictions.runAll(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['predictionsDashboard'] }),
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

  const summary = dashboard?.summary || {};
  const topRisk = dashboard?.topRiskPatients || [];
  const factors = dashboard?.factorAverages || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <Brain className="w-8 h-8 text-purple-600" />
              Predictive Inactivation Risk
            </h1>
            <p className="text-slate-600 mt-1">
              Multi-factor risk scoring to prevent operational inactivations
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => runPredictionsMutation.mutate()} disabled={runPredictionsMutation.isPending}>
              <Play className={`w-4 h-4 mr-2 ${runPredictionsMutation.isPending ? 'animate-spin' : ''}`} />
              {runPredictionsMutation.isPending ? 'Running...' : 'Run Predictions'}
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
              Failed to load predictions: {error?.message || 'Unknown error'}. Please try refreshing.
            </AlertDescription>
          </Alert>
        )}

        {runPredictionsMutation.isError && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-700 text-sm">
              Failed to run predictions: {runPredictionsMutation.error?.message || 'Unknown error'}
            </AlertDescription>
          </Alert>
        )}

        <Alert className="bg-blue-50 border-blue-200">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-700 text-sm">
            <strong>Non-Clinical Notice:</strong> These predictions are operational risk indicators computed from
            documentation currency, barrier status, and administrative signals. They do NOT affect allocation decisions
            or replace clinical judgment.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="border-red-200 bg-red-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-700 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" /> Critical
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-900">{summary.critical || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-orange-200 bg-orange-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> High
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-900">{summary.high || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-yellow-200 bg-yellow-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-700">Moderate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-900">{summary.moderate || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-700">Low</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-900">{summary.low || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Avg Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{summary.avgScore || 0}</div>
              <p className="text-xs text-slate-500">out of 100</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="patients" className="space-y-4">
          <TabsList>
            <TabsTrigger value="patients">High-Risk Patients</TabsTrigger>
            <TabsTrigger value="factors">Factor Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="patients">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Patients at Highest Inactivation Risk
                </CardTitle>
                <CardDescription>
                  Sorted by composite risk score. Click a patient to view details.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {topRisk.length > 0 ? (
                  <div className="space-y-3">
                    {topRisk.map((patient) => (
                      <div key={patient.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border hover:bg-slate-100 transition-colors">
                        <div className="flex items-center gap-4">
                          <RiskGauge score={patient.riskScore} size="small" />
                          <div>
                            <Link to={`${createPageUrl('PatientDetails')}?id=${patient.id}`}
                              className="font-medium text-slate-900 hover:text-cyan-600">
                              {patient.name}
                            </Link>
                            <div className="text-sm text-slate-500">{patient.mrn} &middot; {patient.organNeeded || 'N/A'}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right hidden md:block">
                            {patient.predictedDays && (
                              <span className="text-sm text-slate-500">
                                Risk within {patient.predictedDays} days
                              </span>
                            )}
                            <div className="flex flex-wrap justify-end gap-1 mt-1">
                              {(patient.factors || []).slice(0, 2).map((f, i) => (
                                <Badge key={i} variant="outline" className="text-xs">{f}</Badge>
                              ))}
                            </div>
                          </div>
                          <RiskBadge level={patient.riskLevel} />
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`${createPageUrl('PatientDetails')}?id=${patient.id}`}>
                              <ExternalLink className="w-4 h-4" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    <Brain className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-medium">No predictions available</p>
                    <p className="text-sm mt-1">Click &quot;Run Predictions&quot; to compute inactivation risk scores</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="factors">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  Contributing Factor Analysis
                </CardTitle>
                <CardDescription>
                  Average factor scores across all active patients (0-100 scale)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { label: 'Evaluation Expiry', value: factors.evalExpiry, weight: '30%', color: 'bg-red-500' },
                    { label: 'Documentation Freshness', value: factors.documentation, weight: '20%', color: 'bg-orange-500' },
                    { label: 'Readiness Barriers', value: factors.barriers, weight: '20%', color: 'bg-amber-500' },
                    { label: 'Status Churn', value: factors.statusChurn, weight: '15%', color: 'bg-purple-500' },
                    { label: 'Contact Recency', value: factors.contactRecency, weight: '15%', color: 'bg-blue-500' },
                  ].map(({ label, value, weight, color }) => (
                    <div key={label} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-700 font-medium">{label}</span>
                        <span className="text-slate-500">
                          {value || 0}/100 <span className="text-xs">(weight: {weight})</span>
                        </span>
                      </div>
                      <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${color} rounded-full transition-all duration-500`}
                          style={{ width: `${Math.min(value || 0, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 bg-slate-50 rounded-lg">
                  <h4 className="font-medium text-slate-700 mb-2">How the Score Works</h4>
                  <p className="text-sm text-slate-500">
                    Each patient receives a 0-100 composite score from five weighted factors.
                    Higher scores indicate greater operational risk of inactivation.
                    Scores above 75 are &quot;critical,&quot; 50-74 are &quot;high,&quot; 25-49 are &quot;moderate,&quot; and below 25 are &quot;low.&quot;
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {dashboard?.lastRunDate && (
          <div className="text-center text-sm text-slate-400">
            Last prediction run: {formatDate(dashboard.lastRunDate)}
          </div>
        )}
      </div>
    </div>
  );
}
