import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { 
  Shield, FileCheck, Database, Users, Clock, Download,
  CheckCircle, XCircle, AlertTriangle, Search, RefreshCw,
  ClipboardList, Info
} from 'lucide-react';
import { format } from 'date-fns';
import api from '@/api/localClient';

export default function ComplianceCenter() {
  const [auditFilters, setAuditFilters] = useState({
    startDate: '',
    endDate: '',
    entityType: '',
    limit: 100,
  });

  const [barrierAuditFilters, setBarrierAuditFilters] = useState({
    startDate: '',
    endDate: '',
  });

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['complianceSummary'],
    queryFn: async () => {
      if (window.electronAPI?.compliance) {
        return await window.electronAPI.compliance.getSummary();
      }
      return null;
    },
  });

  const { data: validationReport } = useQuery({
    queryKey: ['validationReport'],
    queryFn: async () => {
      if (window.electronAPI?.compliance) {
        return await window.electronAPI.compliance.getValidationReport();
      }
      return null;
    },
  });

  const { data: dataCompleteness } = useQuery({
    queryKey: ['dataCompleteness'],
    queryFn: async () => {
      if (window.electronAPI?.compliance) {
        return await window.electronAPI.compliance.getDataCompleteness();
      }
      return null;
    },
  });

  const { data: auditTrail, refetch: refetchAudit } = useQuery({
    queryKey: ['auditTrail', auditFilters],
    queryFn: async () => {
      if (window.electronAPI?.compliance) {
        return await window.electronAPI.compliance.getAuditTrail(auditFilters);
      }
      return null;
    },
  });

  // Barrier audit history
  const { data: barrierAuditHistory = [], refetch: refetchBarrierAudit } = useQuery({
    queryKey: ['barrierAuditHistory', barrierAuditFilters],
    queryFn: () => api.barriers.getAuditHistory(
      null, 
      barrierAuditFilters.startDate || null, 
      barrierAuditFilters.endDate || null
    ),
  });

  // Barrier dashboard for summary
  const { data: barrierDashboard } = useQuery({
    queryKey: ['barrierDashboard'],
    queryFn: () => api.barriers.getDashboard(),
  });

  const getStatusIcon = (status) => {
    if (status === 'PASS' || status === 'IMPLEMENTED') {
      return <CheckCircle className="w-4 h-4 text-green-600" />;
    }
    if (status === 'FAIL') {
      return <XCircle className="w-4 h-4 text-red-600" />;
    }
    return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
  };

  if (loadingSummary) {
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
              Compliance Center
            </h1>
            <p className="text-slate-600 mt-1">
              Read-only compliance view for regulators and auditors
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-green-600 border-green-300">
              HIPAA Compliant
            </Badge>
            <Badge variant="outline" className="text-green-600 border-green-300">
              FDA 21 CFR Part 11
            </Badge>
            <Badge variant="outline" className="text-green-600 border-green-300">
              AATB
            </Badge>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Users className="w-4 h-4" />
                Total Patients
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{summary?.patients?.total || 0}</div>
              <p className="text-xs text-slate-500 mt-1">
                {summary?.patients?.active || 0} active
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Database className="w-4 h-4" />
                Audit Entries
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {summary?.auditActivity?.totalActions || 0}
              </div>
              <p className="text-xs text-slate-500 mt-1">Last 30 days</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Users className="w-4 h-4" />
                System Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{summary?.users?.total || 0}</div>
              <p className="text-xs text-slate-500 mt-1">
                {summary?.users?.admins || 0} administrators
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <FileCheck className="w-4 h-4" />
                Data Completeness
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {dataCompleteness?.summary?.averageCompleteness || 0}%
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {dataCompleteness?.summary?.completeRecords || 0} complete records
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="validation" className="space-y-4">
          <TabsList>
            <TabsTrigger value="validation">Validation Report</TabsTrigger>
            <TabsTrigger value="audit">Audit Trail</TabsTrigger>
            <TabsTrigger value="barriers">Barrier Audit</TabsTrigger>
            <TabsTrigger value="completeness">Data Completeness</TabsTrigger>
          </TabsList>

          <TabsContent value="validation">
            <Card>
              <CardHeader>
                <CardTitle>System Validation Report</CardTitle>
                <CardDescription>
                  Formal validation status for regulatory compliance
                </CardDescription>
              </CardHeader>
              <CardContent>
                {validationReport?.sections?.map((section, idx) => (
                  <div key={idx} className="mb-6">
                    <h3 className="font-semibold text-slate-900 mb-3">{section.title}</h3>
                    <div className="space-y-2">
                      {section.items.map((item, iIdx) => (
                        <div 
                          key={iIdx}
                          className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            {getStatusIcon(item.status)}
                            <span className="font-medium">{item.check}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-slate-500">{item.details}</span>
                            <Badge variant={item.status === 'PASS' || item.status === 'IMPLEMENTED' ? 'default' : 'destructive'}>
                              {item.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <CardTitle>Audit Trail</CardTitle>
                <CardDescription>
                  Complete record of all system actions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 mb-4">
                  <div className="flex-1">
                    <Label>Start Date</Label>
                    <Input 
                      type="date" 
                      value={auditFilters.startDate}
                      onChange={(e) => setAuditFilters({...auditFilters, startDate: e.target.value})}
                    />
                  </div>
                  <div className="flex-1">
                    <Label>End Date</Label>
                    <Input 
                      type="date" 
                      value={auditFilters.endDate}
                      onChange={(e) => setAuditFilters({...auditFilters, endDate: e.target.value})}
                    />
                  </div>
                  <div className="flex-1">
                    <Label>Entity Type</Label>
                    <Input 
                      placeholder="e.g., Patient"
                      value={auditFilters.entityType}
                      onChange={(e) => setAuditFilters({...auditFilters, entityType: e.target.value})}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={() => refetchAudit()}>
                      <Search className="w-4 h-4 mr-2" />
                      Search
                    </Button>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Entity</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditTrail?.logs?.slice(0, 50).map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm">
                            {log.created_date ? format(new Date(log.created_date), 'MMM d, yyyy HH:mm') : 'N/A'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{log.action}</Badge>
                          </TableCell>
                          <TableCell>{log.entity_type}</TableCell>
                          <TableCell>{log.user_email}</TableCell>
                          <TableCell className="text-sm text-slate-500 max-w-xs truncate">
                            {log.details}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-sm text-slate-500 mt-2">
                  Showing {Math.min(50, auditTrail?.logs?.length || 0)} of {auditTrail?.count || 0} entries
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Barrier Audit Trail Tab */}
          <TabsContent value="barriers">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5" />
                  Readiness Barrier Audit Trail
                </CardTitle>
                <CardDescription>
                  Complete audit history for non-clinical readiness barriers
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Non-clinical disclaimer */}
                <Alert className="mb-4 bg-blue-50 border-blue-200">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-700 text-sm">
                    <strong>Non-Clinical Notice:</strong> Readiness barriers are operational tracking items only. 
                    They do not affect allocation decisions or replace UNOS/OPTN systems.
                  </AlertDescription>
                </Alert>

                {/* Summary Stats */}
                {barrierDashboard && (
                  <div className="mb-6 p-4 bg-slate-50 rounded-lg">
                    <div className="grid grid-cols-4 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-slate-900">
                          {barrierDashboard.patientsWithBarriers || 0}
                        </div>
                        <div className="text-sm text-slate-500">Patients with Barriers</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-amber-600">
                          {barrierDashboard.totalOpenBarriers || 0}
                        </div>
                        <div className="text-sm text-slate-500">Total Open</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-red-600">
                          {barrierDashboard.byRiskLevel?.high || 0}
                        </div>
                        <div className="text-sm text-slate-500">High Risk</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-orange-600">
                          {barrierDashboard.overdueBarriers || 0}
                        </div>
                        <div className="text-sm text-slate-500">Overdue</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Filters */}
                <div className="flex gap-4 mb-4">
                  <div className="flex-1">
                    <Label>Start Date</Label>
                    <Input 
                      type="date" 
                      value={barrierAuditFilters.startDate}
                      onChange={(e) => setBarrierAuditFilters({...barrierAuditFilters, startDate: e.target.value})}
                    />
                  </div>
                  <div className="flex-1">
                    <Label>End Date</Label>
                    <Input 
                      type="date" 
                      value={barrierAuditFilters.endDate}
                      onChange={(e) => setBarrierAuditFilters({...barrierAuditFilters, endDate: e.target.value})}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={() => refetchBarrierAudit()}>
                      <Search className="w-4 h-4 mr-2" />
                      Search
                    </Button>
                  </div>
                </div>

                {/* Audit Table */}
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Patient</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {barrierAuditHistory.length > 0 ? (
                        barrierAuditHistory.slice(0, 100).map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-sm">
                              {log.created_date ? format(new Date(log.created_date), 'MMM d, yyyy HH:mm') : 'N/A'}
                            </TableCell>
                            <TableCell>
                              <Badge 
                                variant="outline"
                                className={
                                  log.action === 'create' ? 'bg-green-50 text-green-700 border-green-200' :
                                  log.action === 'resolve' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                  log.action === 'delete' ? 'bg-red-50 text-red-700 border-red-200' :
                                  'bg-amber-50 text-amber-700 border-amber-200'
                                }
                              >
                                {log.action}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{log.patient_name || '—'}</TableCell>
                            <TableCell>{log.user_email}</TableCell>
                            <TableCell className="text-sm text-slate-500 max-w-xs">
                              {(() => {
                                try {
                                  const details = JSON.parse(log.details);
                                  if (details.barrier_type) return `Type: ${details.barrier_type.replace(/_/g, ' ')}`;
                                  if (details.changes) return `Changed: ${Object.keys(details.changes).join(', ')}`;
                                  return log.details;
                                } catch {
                                  return log.details;
                                }
                              })()}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                            No barrier audit entries found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-sm text-slate-500 mt-2">
                  Showing {Math.min(100, barrierAuditHistory.length)} entries
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="completeness">
            <Card>
              <CardHeader>
                <CardTitle>Data Completeness Report</CardTitle>
                <CardDescription>
                  Records with missing required fields
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 p-4 bg-slate-50 rounded-lg">
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-slate-900">
                        {dataCompleteness?.summary?.totalPatients || 0}
                      </div>
                      <div className="text-sm text-slate-500">Total Records</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-600">
                        {dataCompleteness?.summary?.completeRecords || 0}
                      </div>
                      <div className="text-sm text-slate-500">Complete</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-orange-600">
                        {dataCompleteness?.summary?.incompleteRecords || 0}
                      </div>
                      <div className="text-sm text-slate-500">Incomplete</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-cyan-600">
                        {dataCompleteness?.summary?.averageCompleteness || 0}%
                      </div>
                      <div className="text-sm text-slate-500">Avg Completeness</div>
                    </div>
                  </div>
                </div>

                {dataCompleteness?.details?.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Patient</TableHead>
                          <TableHead>MRN</TableHead>
                          <TableHead>Completeness</TableHead>
                          <TableHead>Missing Fields</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dataCompleteness.details.map((record) => (
                          <TableRow key={record.patientId}>
                            <TableCell className="font-medium">{record.name}</TableCell>
                            <TableCell>{record.mrn}</TableCell>
                            <TableCell>
                              <Badge variant={parseFloat(record.completenessPercent) >= 80 ? 'default' : 'destructive'}>
                                {record.completenessPercent}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-slate-500">
                              {record.missingFields.join(', ')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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
