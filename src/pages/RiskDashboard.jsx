import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AlertTriangle, AlertCircle, Clock, FileText, Users, 
  RefreshCw, TrendingDown, Activity, Shield, ClipboardList,
  Info, ExternalLink, FileCheck
} from 'lucide-react';
import { BarrierRiskBadge } from '@/components/barriers';
import { AHHQRiskBadge } from '@/components/ahhq';
import { createPageUrl } from '@/utils';
import api from '@/api/localClient';

export default function RiskDashboard() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: dashboard, isLoading, refetch } = useQuery({
    queryKey: ['riskDashboard'],
    queryFn: async () => {
      if (window.electronAPI?.risk) {
        return await window.electronAPI.risk.getDashboard();
      }
      return null;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: fullReport } = useQuery({
    queryKey: ['riskReport'],
    queryFn: async () => {
      if (window.electronAPI?.risk) {
        return await window.electronAPI.risk.getFullReport();
      }
      return null;
    },
  });

  // Fetch barrier dashboard data
  const { data: barrierDashboard } = useQuery({
    queryKey: ['barrierDashboard'],
    queryFn: () => api.barriers.getDashboard(),
    refetchInterval: 60000,
  });

  // Fetch aHHQ dashboard data
  const { data: ahhqDashboard } = useQuery({
    queryKey: ['ahhqDashboard'],
    queryFn: async () => {
      if (window.electronAPI?.ahhq) {
        return await window.electronAPI.ahhq.getDashboard();
      }
      return null;
    },
    refetchInterval: 60000,
  });

  // Fetch patients with aHHQ issues
  const { data: ahhqPatientsWithIssues } = useQuery({
    queryKey: ['ahhqPatientsWithIssues'],
    queryFn: async () => {
      if (window.electronAPI?.ahhq) {
        return await window.electronAPI.ahhq.getPatientsWithIssues(10);
      }
      return [];
    },
    refetchInterval: 60000,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const getRiskBadge = (level) => {
    const styles = {
      critical: 'bg-red-100 text-red-700 border-red-200',
      high: 'bg-orange-100 text-orange-700 border-orange-200',
      medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      low: 'bg-green-100 text-green-700 border-green-200',
    };
    return styles[level] || 'bg-gray-100 text-gray-700';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <Shield className="w-8 h-8 text-cyan-600" />
              Operational Risk Intelligence
            </h1>
            <p className="text-slate-600 mt-1">
              Monitor operational risks across your transplant waitlist
            </p>
          </div>
          <Button onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Risk Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="border-red-200 bg-red-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Evaluations Expiring
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-900">
                {dashboard?.metrics?.evaluationsExpiringSoon || 0}
              </div>
              <p className="text-xs text-red-600 mt-1">Within 30 days</p>
            </CardContent>
          </Card>

          <Card className="border-orange-200 bg-orange-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-700 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Stale Documentation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-900">
                {dashboard?.metrics?.staleDocumentation || 0}
              </div>
              <p className="text-xs text-orange-600 mt-1">No updates in 60+ days</p>
            </CardContent>
          </Card>

          <Card className="border-yellow-200 bg-yellow-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Incomplete Records
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-900">
                {dashboard?.metrics?.incompleteRecords || 0}
              </div>
              <p className="text-xs text-yellow-600 mt-1">Missing critical data</p>
            </CardContent>
          </Card>

          {/* Readiness Barriers Tile (Non-Clinical) */}
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-amber-700 flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                Readiness Barriers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-amber-900">
                {barrierDashboard?.patientsWithBarriers || 0}
                <span className="text-lg font-normal text-amber-600 ml-2">
                  ({barrierDashboard?.patientsWithBarriersPercentage || '0.0'}%)
                </span>
              </div>
              <p className="text-xs text-amber-600 mt-1">
                {barrierDashboard?.totalOpenBarriers || 0} open barriers
              </p>
            </CardContent>
          </Card>

          {/* aHHQ Status Tile (Non-Clinical Documentation Tracking) */}
          <Card className="border-purple-200 bg-purple-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-purple-700 flex items-center gap-2">
                <FileCheck className="w-4 h-4" />
                aHHQ Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-900">
                {ahhqDashboard?.patientsNeedingAttention || 0}
                <span className="text-lg font-normal text-purple-600 ml-2">
                  ({ahhqDashboard?.patientsNeedingAttentionPercentage || '0.0'}%)
                </span>
              </div>
              <p className="text-xs text-purple-600 mt-1">
                {ahhqDashboard?.expiringCount || 0} expiring, {ahhqDashboard?.expiredCount || 0} expired
              </p>
            </CardContent>
          </Card>

          <Card className="border-cyan-200 bg-cyan-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-cyan-700 flex items-center gap-2">
                <Users className="w-4 h-4" />
                At-Risk Patients
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-900">
                {dashboard?.atRiskCount || 0}
                <span className="text-lg font-normal text-cyan-600 ml-2">
                  ({dashboard?.atRiskPercentage || 0}%)
                </span>
              </div>
              <p className="text-xs text-cyan-600 mt-1">Of {dashboard?.totalActive || 0} active</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="patients" className="space-y-4">
          <TabsList>
            <TabsTrigger value="patients">At-Risk Patients</TabsTrigger>
            <TabsTrigger value="barriers">Readiness Barriers</TabsTrigger>
            <TabsTrigger value="ahhq">aHHQ Status</TabsTrigger>
            <TabsTrigger value="segments">Segment Analysis</TabsTrigger>
            <TabsTrigger value="actions">Action Items</TabsTrigger>
          </TabsList>

          <TabsContent value="patients">
            <Card>
              <CardHeader>
                <CardTitle>Patients Requiring Attention</CardTitle>
                <CardDescription>
                  Patients with operational risks that may affect their waitlist status
                </CardDescription>
              </CardHeader>
              <CardContent>
                {dashboard?.topAtRiskPatients?.length > 0 ? (
                  <div className="space-y-3">
                    {dashboard.topAtRiskPatients.map((patient) => (
                      <div 
                        key={patient.id}
                        className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border"
                      >
                        <div>
                          <div className="font-medium text-slate-900">{patient.name}</div>
                          <div className="text-sm text-slate-500">{patient.mrn}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {patient.risks.map((risk, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {risk}
                            </Badge>
                          ))}
                          <Badge className={getRiskBadge(patient.riskCount >= 3 ? 'critical' : 'high')}>
                            {patient.riskCount} risks
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <Activity className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No at-risk patients identified</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Readiness Barriers Tab (Non-Clinical) */}
          <TabsContent value="barriers">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5" />
                  Readiness Barriers Overview
                </CardTitle>
                <CardDescription>
                  Non-clinical operational tracking for transplant readiness
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Non-clinical disclaimer */}
                <Alert className="mb-6 bg-blue-50 border-blue-200">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-700 text-sm">
                    <strong>Non-Clinical Notice:</strong> Readiness barriers are operational workflow items only. 
                    They do not affect allocation decisions or replace UNOS/OPTN systems.
                  </AlertDescription>
                </Alert>

                {/* Barrier Statistics */}
                {barrierDashboard ? (
                  <div className="space-y-6">
                    {/* Summary Stats - With Status Icons */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                          <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                            <span className="text-white text-xs font-bold">✓</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600">Open</div>
                          <div className="text-2xl font-bold text-slate-900">{barrierDashboard.byStatus?.open || 0}</div>
                        </div>
                      </div>
                      <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center">
                          <Clock className="w-6 h-6 text-yellow-600" />
                        </div>
                        <div>
                          <div className="text-sm text-yellow-700">In Progress</div>
                          <div className="text-2xl font-bold text-yellow-900">{barrierDashboard.byStatus?.in_progress || 0}</div>
                        </div>
                      </div>
                      <div className="p-4 bg-red-50 rounded-lg border border-red-200 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                          <AlertTriangle className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                          <div className="text-sm text-red-600">High Risk</div>
                          <div className="text-2xl font-bold text-red-900">{barrierDashboard.byRiskLevel?.high || 0}</div>
                        </div>
                      </div>
                      <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                          <Clock className="w-6 h-6 text-amber-600" />
                        </div>
                        <div>
                          <div className="text-sm text-amber-600">Overdue</div>
                          <div className="text-2xl font-bold text-amber-900">{barrierDashboard.overdueBarriers || 0}</div>
                        </div>
                      </div>
                    </div>

                    {/* Barriers by Type - Horizontal Bar Chart Style */}
                    <div>
                      <h4 className="font-medium text-slate-700 mb-3">Barriers by Type</h4>
                      <div className="space-y-2">
                        {(() => {
                          const typeEntries = Object.entries(barrierDashboard.byType || {}).filter(([_, count]) => count > 0);
                          const maxCount = Math.max(...typeEntries.map(([_, count]) => count), 1);
                          const typeColors = {
                            PENDING_TESTING: 'bg-blue-500',
                            INSURANCE_CLEARANCE: 'bg-purple-500',
                            TRANSPORTATION_PLAN: 'bg-green-500',
                            CAREGIVER_SUPPORT: 'bg-cyan-500',
                            HOUSING_DISTANCE: 'bg-orange-500',
                            PSYCHOSOCIAL_FOLLOWUP: 'bg-pink-500',
                            FINANCIAL_CLEARANCE: 'bg-amber-500',
                            OTHER_NON_CLINICAL: 'bg-slate-500',
                          };
                          const typeLabels = {
                            PENDING_TESTING: 'Pending Testing',
                            INSURANCE_CLEARANCE: 'Insurance Clearance',
                            TRANSPORTATION_PLAN: 'Transportation',
                            CAREGIVER_SUPPORT: 'Caregiver Support',
                            HOUSING_DISTANCE: 'Housing/Distance',
                            PSYCHOSOCIAL_FOLLOWUP: 'Psychosocial Follow-up',
                            FINANCIAL_CLEARANCE: 'Financial Clearance',
                            OTHER_NON_CLINICAL: 'Other (Non-Clinical)',
                          };
                          
                          return typeEntries.map(([type, count]) => (
                            <div key={type} className="flex items-center gap-3">
                              <div className="w-40 text-sm text-slate-600 truncate">
                                {typeLabels[type] || type.replace(/_/g, ' ')}
                              </div>
                              <div className="flex-1 h-8 bg-slate-100 rounded-lg overflow-hidden relative">
                                <div 
                                  className={`h-full ${typeColors[type] || 'bg-slate-500'} rounded-lg transition-all duration-500`}
                                  style={{ width: `${(count / maxCount) * 100}%` }}
                                />
                              </div>
                              <div className="w-8 text-right">
                                <Badge variant="secondary" className="font-bold">{count}</Badge>
                              </div>
                            </div>
                          ));
                        })()}
                        {Object.values(barrierDashboard.byType || {}).every(count => count === 0) && (
                          <div className="text-center py-4 text-slate-500">
                            <p className="text-sm">No barriers by type to display</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Top Barrier Patients - Table Style */}
                    <div>
                      <h4 className="font-medium text-slate-700 mb-3">Patients with Most Barriers</h4>
                      {barrierDashboard.topBarrierPatients?.length > 0 ? (
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-slate-50 border-b">
                              <tr>
                                <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Patient Name</th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Patient ID</th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Active Barriers</th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Risk Score</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {barrierDashboard.topBarrierPatients.map((patient) => {
                                // Calculate risk score display
                                let riskLabel = 'Low';
                                let riskColor = 'text-green-600';
                                let riskDot = 'bg-green-500';
                                if (patient.highRiskCount >= 2) {
                                  riskLabel = 'High';
                                  riskColor = 'text-red-600';
                                  riskDot = 'bg-red-500';
                                } else if (patient.highRiskCount >= 1 || patient.barrierCount >= 3) {
                                  riskLabel = 'Medium-High';
                                  riskColor = 'text-orange-600';
                                  riskDot = 'bg-orange-500';
                                } else if (patient.barrierCount >= 2) {
                                  riskLabel = 'Medium';
                                  riskColor = 'text-yellow-600';
                                  riskDot = 'bg-yellow-500';
                                }
                                
                                return (
                                  <tr key={patient.patientId} className="hover:bg-slate-50">
                                    <td className="px-4 py-3">
                                      <Link 
                                        to={`${createPageUrl('PatientDetails')}?id=${patient.patientId}`}
                                        className="font-medium text-slate-900 hover:text-cyan-600"
                                      >
                                        {patient.patientName}
                                      </Link>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-600">
                                      {patient.mrn || '-'}
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className="font-medium">{patient.barrierCount}</span>
                                      {patient.highRiskCount > 0 && (
                                        <span className="text-red-600 text-sm ml-1">
                                          ({patient.highRiskCount} High
                                          {patient.barrierCount - patient.highRiskCount > 0 && 
                                            `, ${patient.barrierCount - patient.highRiskCount} Med`})
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${riskDot}`}></span>
                                        <span className={`text-sm font-medium ${riskColor}`}>{riskLabel}</span>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-300">
                          <Activity className="w-12 h-12 mx-auto mb-3 text-green-400" />
                          <p className="font-medium">No patients with readiness barriers</p>
                          <p className="text-sm text-slate-400 mt-1">All patients are barrier-free</p>
                        </div>
                      )}
                    </div>

                    {/* By Owning Role */}
                    {barrierDashboard.byOwningRole && Object.keys(barrierDashboard.byOwningRole).length > 0 && (
                      <div>
                        <h4 className="font-medium text-slate-700 mb-3">Barriers by Responsible Team</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {Object.entries(barrierDashboard.byOwningRole).map(([role, count]) => (
                            count > 0 && (
                              <div key={role} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <span className="text-sm text-slate-600 capitalize">{role.replace(/_/g, ' ')}</span>
                                <Badge variant="outline">{count}</Badge>
                              </div>
                            )
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <ClipboardList className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                    <h3 className="text-lg font-medium text-slate-700 mb-2">No Barrier Data Available</h3>
                    <p className="text-slate-500 max-w-md mx-auto">
                      Readiness barrier tracking is ready. Add barriers to patients from their detail pages to start tracking non-clinical operational barriers.
                    </p>
                    <Button 
                      className="mt-4" 
                      variant="outline"
                      onClick={handleRefresh}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh Data
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* aHHQ Status Tab (Non-Clinical Documentation Tracking) */}
          <TabsContent value="ahhq">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileCheck className="w-5 h-5" />
                  aHHQ Documentation Status
                </CardTitle>
                <CardDescription>
                  Non-clinical operational tracking for health history questionnaire documentation
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Non-clinical disclaimer */}
                <Alert className="mb-6 bg-blue-50 border-blue-200">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-700 text-sm">
                    <strong>Non-Clinical Notice:</strong> aHHQ tracking is for operational documentation purposes only. 
                    It tracks whether required questionnaires are present, complete, and current. 
                    It does NOT store medical narratives, clinical interpretations, or affect allocation decisions.
                  </AlertDescription>
                </Alert>

                {/* aHHQ Statistics */}
                {ahhqDashboard && (
                  <div className="space-y-6">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                        <div className="text-sm text-green-600">Complete</div>
                        <div className="text-2xl font-bold text-green-900">{ahhqDashboard.completeCount || 0}</div>
                      </div>
                      <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                        <div className="text-sm text-red-600">Incomplete</div>
                        <div className="text-2xl font-bold text-red-900">{ahhqDashboard.incompleteCount || 0}</div>
                      </div>
                      <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                        <div className="text-sm text-amber-600">Expiring Soon</div>
                        <div className="text-2xl font-bold text-amber-900">{ahhqDashboard.expiringCount || 0}</div>
                        <div className="text-xs text-amber-500">within {ahhqDashboard.warningThresholdDays || 30} days</div>
                      </div>
                      <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                        <div className="text-sm text-red-600">Expired</div>
                        <div className="text-2xl font-bold text-red-900">{ahhqDashboard.expiredCount || 0}</div>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="text-sm text-slate-600">No aHHQ</div>
                        <div className="text-2xl font-bold text-slate-900">{ahhqDashboard.patientsWithoutAHHQ || 0}</div>
                      </div>
                    </div>

                    {/* By Status */}
                    {ahhqDashboard.byStatus && Object.keys(ahhqDashboard.byStatus).length > 0 && (
                      <div>
                        <h4 className="font-medium text-slate-900 mb-3">By Status</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {Object.entries(ahhqDashboard.byStatus).map(([status, count]) => (
                            <div key={status} className="p-3 bg-slate-50 rounded-lg border flex justify-between items-center">
                              <span className="text-sm text-slate-600 capitalize">{status.replace(/_/g, ' ')}</span>
                              <span className="font-bold text-slate-900">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* By Owning Role */}
                    {ahhqDashboard.byOwningRole && Object.keys(ahhqDashboard.byOwningRole).length > 0 && (
                      <div>
                        <h4 className="font-medium text-slate-900 mb-3">By Owning Role</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {Object.entries(ahhqDashboard.byOwningRole).map(([role, count]) => (
                            <div key={role} className="p-3 bg-slate-50 rounded-lg border flex justify-between items-center">
                              <span className="text-sm text-slate-600 capitalize">{role.replace(/_/g, ' ')}</span>
                              <span className="font-bold text-slate-900">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Patients with aHHQ Issues */}
                    {ahhqPatientsWithIssues && ahhqPatientsWithIssues.length > 0 && (
                      <div>
                        <h4 className="font-medium text-slate-900 mb-3">Patients Requiring Attention</h4>
                        <div className="space-y-2">
                          {ahhqPatientsWithIssues.map((patient, idx) => (
                            <div 
                              key={idx}
                              className="p-3 bg-slate-50 rounded-lg border flex justify-between items-center"
                            >
                              <div>
                                <div className="font-medium text-slate-900">{patient.patient_name || 'Unknown'}</div>
                                <div className="text-xs text-slate-500">
                                  {patient.status ? `Status: ${patient.status}` : 'No aHHQ on file'}
                                  {patient.days_until_expiration !== null && patient.days_until_expiration >= 0 && (
                                    <span className="ml-2">• {patient.days_until_expiration} days until expiry</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <AHHQRiskBadge issueType={patient.issue_type} size="small" />
                                <Link to={`${createPageUrl('PatientDetails')}?id=${patient.patient_id}`}>
                                  <Button variant="outline" size="sm">
                                    View <ExternalLink className="w-3 h-3 ml-1" />
                                  </Button>
                                </Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!ahhqDashboard && (
                  <p className="text-slate-500 text-center py-8">No aHHQ data available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="segments">
            <div className="grid gap-4">
              {fullReport?.segmentAnalysis?.map((segment, idx) => (
                <Card key={idx}>
                  <CardHeader>
                    <CardTitle className="text-lg">{segment.segmentName}</CardTitle>
                    <CardDescription>{segment.totalPatients} patients</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {segment.findings.length > 0 ? (
                      <div className="space-y-2">
                        {segment.findings.map((finding, fIdx) => (
                          <Alert key={fIdx} variant={finding.level === 'critical' ? 'destructive' : 'default'}>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>{finding.title}</AlertTitle>
                            <AlertDescription>
                              {finding.description}
                              {finding.recommendation && (
                                <div className="mt-1 text-sm font-medium">
                                  Recommendation: {finding.recommendation}
                                </div>
                              )}
                            </AlertDescription>
                          </Alert>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-green-600">No operational risks identified</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="actions">
            <Card>
              <CardHeader>
                <CardTitle>Prioritized Action Items</CardTitle>
                <CardDescription>
                  Tasks requiring immediate attention to mitigate operational risks
                </CardDescription>
              </CardHeader>
              <CardContent>
                {fullReport?.actionItems?.length > 0 ? (
                  <div className="space-y-3">
                    {fullReport.actionItems.map((item, idx) => (
                      <div 
                        key={idx}
                        className={`p-4 rounded-lg border-l-4 ${
                          item.priority === 'URGENT' 
                            ? 'border-l-red-500 bg-red-50' 
                            : 'border-l-orange-500 bg-orange-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={item.priority === 'URGENT' ? 'bg-red-600' : 'bg-orange-600'}>
                            {item.priority}
                          </Badge>
                          {item.isNonClinical && (
                            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                              Non-Clinical
                            </Badge>
                          )}
                          <span className="font-medium text-slate-900">
                            {item.patient || item.segment}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">{item.issue}</p>
                        <p className="text-sm font-medium text-slate-700 mt-1">
                          Action: {item.action}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <TrendingDown className="w-12 h-12 mx-auto mb-3 text-green-300" />
                    <p>No urgent action items</p>
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
