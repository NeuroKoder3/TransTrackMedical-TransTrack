import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { api } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Plus, X, Save, Link as LinkIcon, Copy, ArrowLeftRight, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import SyncFieldSelector from './SyncFieldSelector';

export default function EHRIntegrationManager() {
  const [showForm, setShowForm] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState(null);
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    integration_name: '',
    ehr_system_type: 'epic',
    endpoint_url: '',
    is_active: true,
    sync_frequency: 'manual',
    auto_create_patients: false,
    auto_update_existing: true,
    enable_bidirectional_sync: false,
    sync_fields_to_ehr: [],
    auth_type: 'bearer_token',
  });

  const { data: integrations = [] } = useQuery({
    queryKey: ['ehrIntegrations'],
    queryFn: () => api.entities.EHRIntegration.list('-created_date', 50),
  });

  const createIntegrationMutation = useMutation({
    mutationFn: (data) => api.entities.EHRIntegration.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ehrIntegrations'] });
      setShowForm(false);
      setEditingIntegration(null);
    },
  });

  const updateIntegrationMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.EHRIntegration.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ehrIntegrations'] });
      setEditingIntegration(null);
    },
  });

  const handleSave = () => {
    createIntegrationMutation.mutate(formData);
  };

  const handleSaveSyncFields = (fields) => {
    if (editingIntegration) {
      updateIntegrationMutation.mutate({
        id: editingIntegration.id,
        data: { sync_fields_to_ehr: fields }
      });
    }
  };

  const webhookUrl = `${window.location.origin}/api/functions/fhirWebhook`;

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  return (
    <div className="space-y-6">
      <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center space-x-2">
                <LinkIcon className="w-5 h-5 text-blue-600" />
                <span>EHR Integrations</span>
              </CardTitle>
              <p className="text-sm text-slate-600 mt-2">
                Configure FHIR-compliant connections to external health record systems
              </p>
            </div>
            {!showForm && (
              <Button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Integration
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New EHR Integration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Integration Name</Label>
                <Input
                  value={formData.integration_name}
                  onChange={(e) => setFormData({ ...formData, integration_name: e.target.value })}
                  placeholder="e.g., Main Hospital Epic System"
                />
              </div>
              <div>
                <Label>EHR System Type</Label>
                <Select value={formData.ehr_system_type} onValueChange={(value) => setFormData({ ...formData, ehr_system_type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="epic">Epic</SelectItem>
                    <SelectItem value="cerner">Cerner</SelectItem>
                    <SelectItem value="meditech">Meditech</SelectItem>
                    <SelectItem value="allscripts">Allscripts</SelectItem>
                    <SelectItem value="athenahealth">athenahealth</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>FHIR Endpoint URL</Label>
              <Input
                value={formData.endpoint_url}
                onChange={(e) => setFormData({ ...formData, endpoint_url: e.target.value })}
                placeholder="https://fhir.example.com/R4"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between">
                <Label>Auto-Create New Patients</Label>
                <Switch
                  checked={formData.auto_create_patients}
                  onCheckedChange={(checked) => setFormData({ ...formData, auto_create_patients: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Auto-Update Existing</Label>
                <Switch
                  checked={formData.auto_update_existing}
                  onCheckedChange={(checked) => setFormData({ ...formData, auto_update_existing: checked })}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <Label>Enable Bi-Directional Sync</Label>
                  <p className="text-xs text-slate-500">Push TransTrack updates back to EHR</p>
                </div>
                <Switch
                  checked={formData.enable_bidirectional_sync}
                  onCheckedChange={(checked) => setFormData({ ...formData, enable_bidirectional_sync: checked })}
                />
              </div>

              {formData.enable_bidirectional_sync && (
                <div>
                  <Label>Authentication Type</Label>
                  <Select value={formData.auth_type} onValueChange={(value) => setFormData({ ...formData, auth_type: value })}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bearer_token">Bearer Token</SelectItem>
                      <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                      <SelectItem value="basic_auth">Basic Auth</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 mt-2">
                    Set API credentials in environment variables: EHR_API_KEY_{'{integration_id}'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700">
                <Save className="w-4 h-4 mr-2" />
                Save Integration
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook Endpoint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            Configure your EHR system to send FHIR data to this endpoint:
          </p>
          <div className="flex items-center space-x-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <code className="text-sm flex-1 text-slate-700 font-mono">{webhookUrl}</code>
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(webhookUrl)}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <Alert className="bg-amber-50 border-amber-200">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-900 text-sm">
              <strong>Authentication Required:</strong> Set the EHR_WEBHOOK_SECRET environment variable 
              and include it as a Bearer token in the Authorization header.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configured Integrations</CardTitle>
        </CardHeader>
        <CardContent>
          {integrations.length === 0 ? (
            <p className="text-center py-8 text-slate-500">No integrations configured yet</p>
          ) : (
            <div className="space-y-4">
              {integrations.map((integration) => (
                <div key={integration.id} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="p-4 bg-white">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="font-medium text-slate-900">{integration.integration_name}</h4>
                          <Badge className="capitalize">{integration.ehr_system_type}</Badge>
                          <Badge variant={integration.is_active ? 'default' : 'secondary'}>
                            {integration.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          {integration.enable_bidirectional_sync && (
                            <Badge className="bg-purple-100 text-purple-700">
                              <ArrowLeftRight className="w-3 h-3 mr-1" />
                              Bi-Directional
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 mt-1">{integration.endpoint_url}</p>
                        <div className="flex space-x-4 mt-2 text-xs text-slate-500">
                          {integration.last_sync_date && (
                            <span>Last import: {format(new Date(integration.last_sync_date), 'MMM d, h:mm a')}</span>
                          )}
                          <span>Imports: {integration.total_imports || 0}</span>
                          {integration.enable_bidirectional_sync && (
                            <span>Exports: {integration.total_exports || 0}</span>
                          )}
                        </div>
                      </div>
                      {integration.enable_bidirectional_sync && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingIntegration(integration)}
                        >
                          <Settings className="w-4 h-4 mr-1" />
                          Configure Sync
                        </Button>
                      )}
                    </div>
                  </div>

                  {editingIntegration?.id === integration.id && (
                    <div className="border-t border-slate-200 bg-slate-50 p-4">
                      <SyncFieldSelector
                        integration={integration}
                        onSave={handleSaveSyncFields}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}