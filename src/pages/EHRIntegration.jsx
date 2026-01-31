import React from 'react';
import { api } from '@/api/apiClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Database, Upload, Settings, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import FHIRImporter from '../components/ehr/FHIRImporter';
import EHRIntegrationManager from '../components/ehr/EHRIntegrationManager';
import ValidationRuleManager from '../components/ehr/ValidationRuleManager';
import { format } from 'date-fns';

export default function EHRIntegration() {
  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => api.auth.me(),
  });

  const { data: importHistory = [], refetch: refetchHistory } = useQuery({
    queryKey: ['ehrImports'],
    queryFn: () => api.entities.EHRImport.list('-created_date', 50),
  });

  const handleImportComplete = () => {
    refetchHistory();
  };

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-12 text-center">
              <Settings className="w-16 h-16 text-red-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-red-900 mb-2">Admin Access Required</h2>
              <p className="text-red-700">Only administrators can manage EHR integrations</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">EHR Integration</h1>
          <p className="text-slate-600 mt-1">FHIR-compliant data exchange with health record systems</p>
        </div>

        <Tabs defaultValue="import" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="import">
              <Upload className="w-4 h-4 mr-2" />
              Import Data
            </TabsTrigger>
            <TabsTrigger value="integrations">
              <Settings className="w-4 h-4 mr-2" />
              Integrations
            </TabsTrigger>
            <TabsTrigger value="validation">
              <Database className="w-4 h-4 mr-2" />
              Validation Rules
            </TabsTrigger>
            <TabsTrigger value="history">
              <FileText className="w-4 h-4 mr-2" />
              Import History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="mt-6">
            <FHIRImporter onImportComplete={handleImportComplete} />
          </TabsContent>

          <TabsContent value="integrations" className="mt-6">
            <EHRIntegrationManager />
          </TabsContent>

          <TabsContent value="validation" className="mt-6">
            <ValidationRuleManager />
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Import History</CardTitle>
              </CardHeader>
              <CardContent>
                {importHistory.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-600">No import history yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {importHistory.map((importRecord) => (
                      <div key={importRecord.id} className="p-4 border border-slate-200 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <h4 className="font-medium text-slate-900">
                                {importRecord.source_system || 'Unknown System'}
                              </h4>
                              <Badge className={
                                importRecord.status === 'success' ? 'bg-green-100 text-green-700' :
                                importRecord.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-700'
                              }>
                                {importRecord.status}
                              </Badge>
                              <Badge variant="outline" className="capitalize">
                                {importRecord.import_type?.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                            <p className="text-sm text-slate-600 mt-2">
                              {format(new Date(importRecord.created_date), 'MMM d, yyyy h:mm a')} by {importRecord.imported_by}
                            </p>
                            <div className="flex space-x-6 mt-3 text-sm">
                              <span className="text-slate-600">
                                Processed: <strong className="text-slate-900">{importRecord.records_processed}</strong>
                              </span>
                              <span className="text-green-600">
                                Created: <strong>{importRecord.records_created}</strong>
                              </span>
                              <span className="text-blue-600">
                                Updated: <strong>{importRecord.records_updated}</strong>
                              </span>
                              {importRecord.records_failed > 0 && (
                                <span className="text-red-600">
                                  Failed: <strong>{importRecord.records_failed}</strong>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base">FHIR Specification Compliance</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 space-y-3">
            <div>
              <h4 className="font-medium text-slate-900 mb-2">Supported FHIR Version</h4>
              <p>FHIR R4 (v4.0.1)</p>
            </div>

            <div>
              <h4 className="font-medium text-slate-900 mb-2">Data Exchange Methods</h4>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Manual Upload:</strong> Import FHIR Bundle JSON files</li>
                <li><strong>Webhook:</strong> Receive real-time updates via FHIR webhook endpoint</li>
                <li><strong>REST API:</strong> Query FHIR endpoints (coming soon)</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium text-slate-900 mb-2">Security & Compliance</h4>
              <ul className="list-disc list-inside space-y-1">
                <li>Bearer token authentication for webhooks</li>
                <li>TLS/SSL encryption for data in transit</li>
                <li>Complete audit logging of all imports</li>
                <li>HIPAA-compliant data handling</li>
                <li>Role-based access control</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}