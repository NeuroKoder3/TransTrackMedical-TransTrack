import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Save, Shield } from 'lucide-react';

export default function SyncFieldSelector({ integration, onSave }) {
  const availableFields = [
    { id: 'demographics', label: 'Demographics', fields: ['first_name', 'last_name', 'date_of_birth', 'phone', 'email'] },
    { id: 'contact', label: 'Emergency Contact', fields: ['emergency_contact_name', 'emergency_contact_phone'] },
    { id: 'clinical_scores', label: 'Clinical Scores', fields: ['meld_score', 'las_score', 'pra_percentage', 'cpra_percentage', 'priority_score'] },
    { id: 'vitals', label: 'Vitals', fields: ['weight_kg', 'height_cm'] },
    { id: 'waitlist_status', label: 'Waitlist Status', fields: ['waitlist_status', 'medical_urgency', 'date_added_to_waitlist'] },
    { id: 'medical_info', label: 'Medical Information', fields: ['diagnosis', 'comorbidities', 'medications', 'hla_typing'] },
    { id: 'assessments', label: 'Clinical Assessments', fields: ['functional_status', 'prognosis_rating', 'comorbidity_score', 'compliance_score'] },
  ];

  const [selectedFields, setSelectedFields] = useState(
    integration?.sync_fields_to_ehr || []
  );

  const toggleFieldGroup = (group, checked) => {
    if (checked) {
      setSelectedFields([...new Set([...selectedFields, ...group.fields])]);
    } else {
      setSelectedFields(selectedFields.filter(f => !group.fields.includes(f)));
    }
  };

  const isGroupSelected = (group) => {
    return group.fields.every(f => selectedFields.includes(f));
  };

  const isGroupPartiallySelected = (group) => {
    return group.fields.some(f => selectedFields.includes(f)) && !isGroupSelected(group);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configure Outbound Sync Fields</CardTitle>
        <p className="text-sm text-slate-600">
          Select which patient data fields should be pushed back to the EHR system
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert className="bg-blue-50 border-blue-200">
          <Shield className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-900 text-sm">
            Only selected fields will be included in outbound FHIR resources. Changes sync when 
            patient records are updated or when manually triggered.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          {availableFields.map((group) => (
            <div key={group.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-3">
                <Checkbox
                  checked={isGroupSelected(group)}
                  onCheckedChange={(checked) => toggleFieldGroup(group, checked)}
                  className={isGroupPartiallySelected(group) ? 'data-[state=checked]:bg-slate-400' : ''}
                />
                <Label className="font-medium text-slate-900 cursor-pointer">
                  {group.label}
                </Label>
                <span className="text-xs text-slate-500">
                  ({group.fields.filter(f => selectedFields.includes(f)).length}/{group.fields.length})
                </span>
              </div>
              <div className="ml-6 grid grid-cols-1 md:grid-cols-2 gap-2">
                {group.fields.map((field) => (
                  <div key={field} className="flex items-center space-x-2">
                    <Checkbox
                      checked={selectedFields.includes(field)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedFields([...selectedFields, field]);
                        } else {
                          setSelectedFields(selectedFields.filter(f => f !== field));
                        }
                      }}
                    />
                    <Label className="text-sm text-slate-600 cursor-pointer">
                      {field.replace(/_/g, ' ')}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-slate-200">
          <div className="text-sm text-slate-600">
            <strong>{selectedFields.length}</strong> fields selected for sync
          </div>
          <Button 
            onClick={() => onSave(selectedFields)} 
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Configuration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}