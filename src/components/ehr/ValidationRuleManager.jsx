import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Save, AlertTriangle, CheckCircle, Shield } from 'lucide-react';

export default function ValidationRuleManager() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    rule_name: '',
    rule_type: 'required_field',
    target_field: '',
    is_active: true,
    severity: 'error',
    validation_config: {},
    error_message: '',
    apply_to_resource_types: ['Patient'],
  });

  const { data: rules = [] } = useQuery({
    queryKey: ['ehrValidationRules'],
    queryFn: () => api.entities.EHRValidationRule.list('-created_at', 100),
  });

  const createRuleMutation = useMutation({
    mutationFn: (data) => api.entities.EHRValidationRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ehrValidationRules'] });
      setShowForm(false);
      resetForm();
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.EHRValidationRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ehrValidationRules'] });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => api.entities.EHRValidationRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ehrValidationRules'] });
    },
  });

  const resetForm = () => {
    setFormData({
      rule_name: '',
      rule_type: 'required_field',
      target_field: '',
      is_active: true,
      severity: 'error',
      validation_config: {},
      error_message: '',
      apply_to_resource_types: ['Patient'],
    });
  };

  const handleSave = () => {
    createRuleMutation.mutate(formData);
  };

  const toggleRule = (rule) => {
    updateRuleMutation.mutate({
      id: rule.id,
      data: { is_active: !rule.is_active }
    });
  };

  const renderRuleTypeFields = () => {
    switch (formData.rule_type) {
      case 'date_format':
        return (
          <div>
            <Label>Date Format Pattern</Label>
            <Input
              value={formData.validation_config.date_format || ''}
              onChange={(e) => setFormData({
                ...formData,
                validation_config: { ...formData.validation_config, date_format: e.target.value }
              })}
              placeholder="YYYY-MM-DD"
            />
          </div>
        );
      case 'value_range':
        return (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Min Value</Label>
              <Input
                type="number"
                value={formData.validation_config.min_value || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  validation_config: { ...formData.validation_config, min_value: parseFloat(e.target.value) }
                })}
              />
            </div>
            <div>
              <Label>Max Value</Label>
              <Input
                type="number"
                value={formData.validation_config.max_value || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  validation_config: { ...formData.validation_config, max_value: parseFloat(e.target.value) }
                })}
              />
            </div>
          </div>
        );
      case 'enum_check':
        return (
          <div>
            <Label>Allowed Values (comma-separated)</Label>
            <Input
              value={(formData.validation_config.allowed_values || []).join(', ')}
              onChange={(e) => setFormData({
                ...formData,
                validation_config: { 
                  ...formData.validation_config, 
                  allowed_values: e.target.value.split(',').map(v => v.trim())
                }
              })}
              placeholder="active, inactive, pending"
            />
          </div>
        );
      case 'regex_pattern':
        return (
          <div>
            <Label>Regex Pattern</Label>
            <Input
              value={formData.validation_config.pattern || ''}
              onChange={(e) => setFormData({
                ...formData,
                validation_config: { ...formData.validation_config, pattern: e.target.value }
              })}
              placeholder="^[A-Z]\d{6}$"
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-green-200 bg-gradient-to-r from-green-50 to-emerald-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-green-600" />
                <span>FHIR Data Validation Rules</span>
              </CardTitle>
              <p className="text-sm text-slate-600 mt-2">
                Define validation rules to ensure incoming FHIR data quality
              </p>
            </div>
            {!showForm && (
              <Button onClick={() => setShowForm(true)} className="bg-green-600 hover:bg-green-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Rule
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Validation Rule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Rule Name</Label>
                <Input
                  value={formData.rule_name}
                  onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
                  placeholder="e.g., Require Patient MRN"
                />
              </div>
              <div>
                <Label>Rule Type</Label>
                <Select value={formData.rule_type} onValueChange={(value) => setFormData({ ...formData, rule_type: value, validation_config: {} })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required_field">Required Field</SelectItem>
                    <SelectItem value="date_format">Date Format</SelectItem>
                    <SelectItem value="value_range">Value Range</SelectItem>
                    <SelectItem value="enum_check">Enum Check</SelectItem>
                    <SelectItem value="regex_pattern">Regex Pattern</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Target Field</Label>
              <Input
                value={formData.target_field}
                onChange={(e) => setFormData({ ...formData, target_field: e.target.value })}
                placeholder="e.g., identifier.value or birthDate"
              />
              <p className="text-xs text-slate-500 mt-1">
                Use dot notation for nested fields (e.g., name.family, identifier[0].value)
              </p>
            </div>

            {renderRuleTypeFields()}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Severity</Label>
                <Select value={formData.severity} onValueChange={(value) => setFormData({ ...formData, severity: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="error">Error (Block Import)</SelectItem>
                    <SelectItem value="warning">Warning (Allow Import)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between pt-6">
                <Label>Rule Active</Label>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>
            </div>

            <div>
              <Label>Custom Error Message</Label>
              <Textarea
                value={formData.error_message}
                onChange={(e) => setFormData({ ...formData, error_message: e.target.value })}
                placeholder="This field is required for all patient records"
                rows={2}
              />
            </div>

            <div className="flex justify-end space-x-3">
              <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700">
                <Save className="w-4 h-4 mr-2" />
                Save Rule
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Validation Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-center py-8 text-slate-500">No validation rules defined yet</p>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <div key={rule.id} className="p-4 border border-slate-200 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <h4 className="font-medium text-slate-900">{rule.rule_name}</h4>
                        <Badge className="capitalize">{rule.rule_type.replace('_', ' ')}</Badge>
                        <Badge variant={rule.severity === 'error' ? 'destructive' : 'default'}>
                          {rule.severity === 'error' ? (
                            <><AlertTriangle className="w-3 h-3 mr-1" /> Error</>
                          ) : (
                            <><CheckCircle className="w-3 h-3 mr-1" /> Warning</>
                          )}
                        </Badge>
                        <Badge variant={rule.is_active ? 'default' : 'secondary'}>
                          {rule.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 mb-1">
                        <strong>Field:</strong> {rule.target_field}
                      </p>
                      {rule.error_message && (
                        <p className="text-xs text-slate-500 italic">"{rule.error_message}"</p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={rule.is_active}
                        onCheckedChange={() => toggleRule(rule)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm('Delete this validation rule?')) {
                            deleteRuleMutation.mutate(rule.id);
                          }
                        }}
                      >
                        <X className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}