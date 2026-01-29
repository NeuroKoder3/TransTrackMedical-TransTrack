/**
 * AHHQForm Component
 * 
 * Form for creating or updating Adult Health History Questionnaire (aHHQ) records.
 * 
 * IMPORTANT DISCLAIMER:
 * This form is for OPERATIONAL DOCUMENTATION tracking only.
 * It does NOT collect or store medical information.
 */

import React, { useState, useEffect } from 'react';
import { Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function AHHQForm({
  ahhq = null,
  statuses = {},
  issues = {},
  owningRoles = {},
  onSave,
  onCancel,
  isLoading = false,
}) {
  const [formData, setFormData] = useState({
    status: 'incomplete',
    last_completed_date: '',
    validity_period_days: 365,
    identified_issues: [],
    owning_role: 'coordinator',
    notes: '',
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (ahhq) {
      setFormData({
        status: ahhq.status || 'incomplete',
        last_completed_date: ahhq.last_completed_date 
          ? new Date(ahhq.last_completed_date).toISOString().split('T')[0]
          : '',
        validity_period_days: ahhq.validity_period_days || 365,
        identified_issues: ahhq.identified_issues || [],
        owning_role: ahhq.owning_role || 'coordinator',
        notes: ahhq.notes || '',
      });
    }
  }, [ahhq]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const handleIssueToggle = (issueKey) => {
    setFormData(prev => {
      const current = prev.identified_issues || [];
      if (current.includes(issueKey)) {
        return { ...prev, identified_issues: current.filter(i => i !== issueKey) };
      } else {
        return { ...prev, identified_issues: [...current, issueKey] };
      }
    });
  };

  const validate = () => {
    const newErrors = {};
    
    if (!formData.status) {
      newErrors.status = 'Status is required';
    }
    
    if (!formData.owning_role) {
      newErrors.owning_role = 'Owning role is required';
    }
    
    if (formData.notes && formData.notes.length > 255) {
      newErrors.notes = 'Notes must be 255 characters or less';
    }
    
    if (formData.validity_period_days && (formData.validity_period_days < 1 || formData.validity_period_days > 730)) {
      newErrors.validity_period_days = 'Validity period must be between 1 and 730 days';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!validate()) return;
    
    const submitData = {
      ...formData,
      last_completed_date: formData.last_completed_date 
        ? new Date(formData.last_completed_date).toISOString()
        : null,
      validity_period_days: parseInt(formData.validity_period_days) || 365,
    };
    
    onSave(submitData);
  };

  const statusOptions = statuses ? Object.entries(statuses).map(([key, value]) => ({
    value: typeof value === 'string' ? value : key.toLowerCase(),
    label: typeof value === 'string' 
      ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ')
      : key.replace(/_/g, ' '),
  })) : [];

  const roleOptions = owningRoles ? Object.entries(owningRoles).map(([key, value]) => ({
    value: value.value || key.toLowerCase(),
    label: value.label || key,
  })) : [];

  const issueOptions = issues ? Object.entries(issues).map(([key, value]) => ({
    value: value.value || key,
    label: value.label || key,
    description: value.description || '',
  })) : [];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Status */}
      <div className="space-y-2">
        <Label htmlFor="status">Documentation Status *</Label>
        <Select 
          value={formData.status} 
          onValueChange={(value) => handleChange('status', value)}
        >
          <SelectTrigger className={errors.status ? 'border-red-500' : ''}>
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.status && <p className="text-sm text-red-500">{errors.status}</p>}
      </div>

      {/* Last Completed Date */}
      <div className="space-y-2">
        <Label htmlFor="last_completed_date">Last Completed Date</Label>
        <Input
          id="last_completed_date"
          type="date"
          value={formData.last_completed_date}
          onChange={(e) => handleChange('last_completed_date', e.target.value)}
          max={new Date().toISOString().split('T')[0]}
        />
        <p className="text-xs text-slate-500">
          Date when the aHHQ was last fully completed
        </p>
      </div>

      {/* Validity Period */}
      <div className="space-y-2">
        <Label htmlFor="validity_period_days">Validity Period (days)</Label>
        <Input
          id="validity_period_days"
          type="number"
          min="1"
          max="730"
          value={formData.validity_period_days}
          onChange={(e) => handleChange('validity_period_days', e.target.value)}
          className={errors.validity_period_days ? 'border-red-500' : ''}
        />
        {errors.validity_period_days && (
          <p className="text-sm text-red-500">{errors.validity_period_days}</p>
        )}
        <p className="text-xs text-slate-500">
          Default is 365 days. Adjust per organizational policy.
        </p>
      </div>

      {/* Owning Role */}
      <div className="space-y-2">
        <Label htmlFor="owning_role">Owning Role *</Label>
        <Select 
          value={formData.owning_role} 
          onValueChange={(value) => handleChange('owning_role', value)}
        >
          <SelectTrigger className={errors.owning_role ? 'border-red-500' : ''}>
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.owning_role && <p className="text-sm text-red-500">{errors.owning_role}</p>}
      </div>

      {/* Identified Issues */}
      <div className="space-y-2">
        <Label>Documentation Issues (if any)</Label>
        <div className="space-y-2 max-h-40 overflow-y-auto p-2 border rounded-lg bg-slate-50">
          {issueOptions.map(opt => (
            <div key={opt.value} className="flex items-start space-x-2">
              <Checkbox
                id={`issue-${opt.value}`}
                checked={formData.identified_issues.includes(opt.value)}
                onCheckedChange={() => handleIssueToggle(opt.value)}
              />
              <div className="grid gap-0.5 leading-none">
                <label
                  htmlFor={`issue-${opt.value}`}
                  className="text-sm font-medium cursor-pointer"
                >
                  {opt.label}
                </label>
                {opt.description && (
                  <p className="text-xs text-slate-500">{opt.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">
          Notes <span className="text-slate-400 text-xs">({255 - (formData.notes?.length || 0)} chars remaining)</span>
        </Label>
        <Textarea
          id="notes"
          placeholder="Brief operational notes only (non-clinical)..."
          value={formData.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          maxLength={255}
          rows={2}
          className={errors.notes ? 'border-red-500' : ''}
        />
        {errors.notes && <p className="text-sm text-red-500">{errors.notes}</p>}
        <Alert className="bg-amber-50 border-amber-200">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-700 text-xs">
            Do NOT enter medical information, diagnoses, or clinical narratives.
            Notes are for brief operational comments only.
          </AlertDescription>
        </Alert>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={isLoading} className="flex-1">
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            ahhq ? 'Update Record' : 'Create Record'
          )}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
