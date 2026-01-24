import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, RefreshCw, FileJson, CheckCircle, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format } from 'date-fns';

export default function PatientSyncControls({ patient }) {
  const [selectedIntegration, setSelectedIntegration] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const queryClient = useQueryClient();

  const { data: integrations = [] } = useQuery({
    queryKey: ['ehrIntegrations'],
    queryFn: () => api.entities.EHRIntegration.filter({ 
      is_active: true, 
      enable_bidirectional_sync: true 
    }),
  });

  const { data: syncLogs = [] } = useQuery({
    queryKey: ['ehrSyncLogs', patient.id],
    queryFn: () => api.entities.EHRSyncLog.filter({ 
      patient_id: patient.id 
    }, '-created_date', 10),
  });

  const handlePushToEHR = async () => {
    if (!selectedIntegration) {
      alert('Please select an integration');
      return;
    }

    setSyncing(true);
    setSyncResult(null);

    try {
      const response = await api.functions.invoke('pushToEHR', {
        patient_id: patient.id,
        integration_id: selectedIntegration,
      });

      setSyncResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['ehrSyncLogs', patient.id] });
    } catch (error) {
      setSyncResult({
        success: false,
        errors: [error.message]
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleExportFHIR = async () => {
    try {
      const response = await api.functions.invoke('exportToFHIR', {
        patient_id: patient.id,
      });

      const fhirData = JSON.stringify(response.data.fhir_bundle, null, 2);
      const blob = new Blob([fhirData], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `patient-${patient.patient_id}-fhir.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-base flex items-center space-x-2">
            <ArrowRight className="w-4 h-4 text-blue-600" />
            <span>Push to EHR System</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {integrations.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No active EHR integrations with bidirectional sync enabled
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div>
                <Label className="text-sm text-slate-600 mb-2 block">Select Target EHR System</Label>
                <Select value={selectedIntegration} onValueChange={setSelectedIntegration}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose integration" />
                  </SelectTrigger>
                  <SelectContent>
                    {integrations.map((integration) => (
                      <SelectItem key={integration.id} value={integration.id}>
                        {integration.integration_name} ({integration.ehr_system_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedIntegration && (
                <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg">
                  <p className="font-medium text-slate-700 mb-1">Fields to be synced:</p>
                  <p className="text-xs">
                    {integrations.find(i => i.id === selectedIntegration)?.sync_fields_to_ehr?.join(', ') || 'None configured'}
                  </p>
                </div>
              )}

              <Button
                onClick={handlePushToEHR}
                disabled={!selectedIntegration || syncing}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                <ArrowRight className="w-4 h-4 mr-2" />
                {syncing ? 'Pushing to EHR...' : 'Push to EHR'}
              </Button>
            </>
          )}

          <div className="pt-4 border-t border-slate-200">
            <Button
              variant="outline"
              onClick={handleExportFHIR}
              className="w-full"
            >
              <FileJson className="w-4 h-4 mr-2" />
              Download as FHIR JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      {syncResult && (
        <Card className={`border-2 ${
          syncResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
        }`}>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2 mb-2">
              {syncResult.success ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
              <span className="font-medium">
                {syncResult.success ? 'Sync Successful' : 'Sync Failed'}
              </span>
            </div>
            {syncResult.success && (
              <p className="text-sm text-slate-600">
                {syncResult.synced_fields?.length || 0} fields synced to EHR
              </p>
            )}
            {syncResult.errors && syncResult.errors.length > 0 && (
              <div className="text-sm text-red-700 mt-2">
                {syncResult.errors.map((err, i) => (
                  <p key={i}>• {err}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {syncLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Sync Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {syncLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-sm py-2 border-b border-slate-100 last:border-0">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <Badge className={
                        log.sync_direction === 'outbound' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                      }>
                        {log.sync_direction}
                      </Badge>
                      <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                        {log.status}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {format(new Date(log.created_date), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    {log.fields_synced && log.fields_synced.length > 0 && (
                      <p className="text-xs text-slate-500 mt-1">
                        {log.fields_synced.length} field(s) • {log.sync_duration_ms}ms
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}