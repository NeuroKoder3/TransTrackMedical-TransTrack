/**
 * ReadinessBarrierForm Component
 * 
 * Form for adding or editing a readiness barrier.
 * 
 * IMPORTANT DISCLAIMER:
 * Readiness barriers are NON-CLINICAL, NON-ALLOCATIVE, and designed for
 * operational workflow visibility only. They do NOT perform allocation decisions,
 * listing authority functions, or replace UNOS/OPTN systems.
 * 
 * Do NOT store sensitive psychosocial narratives, diagnoses, or medical opinions.
 * Barriers are operational flags, not clinical notes.
 */

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from '@/components/ui/alert';
import api from '@/api/localClient';

const MAX_NOTES_LENGTH = 255;

export default function ReadinessBarrierForm({ 
  patientId, 
  barrier = null, // If provided, we're editing
  onSave, 
  onCancel 
}) {
  const isEditing = !!barrier;
  
  // Fetch barrier metadata
  const { data: barrierTypes = {} } = useQuery({
    queryKey: ['barrierTypes'],
    queryFn: () => api.barriers.getTypes(),
  });
  
  const { data: barrierStatuses = {} } = useQuery({
    queryKey: ['barrierStatuses'],
    queryFn: () => api.barriers.getStatuses(),
  });
  
  const { data: riskLevels = {} } = useQuery({
    queryKey: ['barrierRiskLevels'],
    queryFn: () => api.barriers.getRiskLevels(),
  });
  
  const { data: owningRoles = {} } = useQuery({
    queryKey: ['barrierOwningRoles'],
    queryFn: () => api.barriers.getOwningRoles(),
  });
  
  // Form state
  const [formData, setFormData] = useState({
    barrier_type: barrier?.barrier_type || '',
    status: barrier?.status || 'open',
    risk_level: barrier?.risk_level || 'low',
    owning_role: barrier?.owning_role || '',
    target_resolution_date: barrier?.target_resolution_date?.split('T')[0] || '',
    notes: barrier?.notes || '',
  });
  
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Update form if barrier prop changes
  useEffect(() => {
    if (barrier) {
      setFormData({
        barrier_type: barrier.barrier_type || '',
        status: barrier.status || 'open',
        risk_level: barrier.risk_level || 'low',
        owning_role: barrier.owning_role || '',
        target_resolution_date: barrier.target_resolution_date?.split('T')[0] || '',
        notes: barrier.notes || '',
      });
    }
  }, [barrier]);
  
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when field is edited
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };
  
  const validate = () => {
    const newErrors = {};
    
    if (!formData.barrier_type) {
      newErrors.barrier_type = 'Please select a barrier type';
    }
    
    if (!formData.owning_role) {
      newErrors.owning_role = 'Please select an owning role';
    }
    
    if (formData.notes && formData.notes.length > MAX_NOTES_LENGTH) {
      newErrors.notes = `Notes must be ${MAX_NOTES_LENGTH} characters or less`;
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validate()) return;
    
    setIsSubmitting(true);
    
    try {
      const data = {
        ...formData,
        patient_id: patientId,
        target_resolution_date: formData.target_resolution_date || null,
        notes: formData.notes || null,
      };
      
      await onSave(data);
    } catch (error) {
      console.error('Error saving barrier:', error);
      setErrors({ submit: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <Card className="border-cyan-200 shadow-md">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          {isEditing ? 'Edit Readiness Barrier' : 'Add Readiness Barrier'}
        </CardTitle>
        <CardDescription>
          Track non-clinical operational barriers to transplant readiness.
          This does not affect allocation decisions.
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <Alert className="mb-4 bg-blue-50 border-blue-200">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-700 text-sm">
            <strong>Non-Clinical Notice:</strong> This feature is for operational tracking only. 
            Do not enter clinical diagnoses, medical opinions, or sensitive narratives.
          </AlertDescription>
        </Alert>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Barrier Type */}
          <div className="space-y-2">
            <Label htmlFor="barrier_type">
              Barrier Type <span className="text-red-500">*</span>
            </Label>
            <Select
              value={formData.barrier_type}
              onValueChange={(value) => handleChange('barrier_type', value)}
            >
              <SelectTrigger className={errors.barrier_type ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select barrier type" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(barrierTypes).map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.barrier_type && (
              <p className="text-red-500 text-sm">{errors.barrier_type}</p>
            )}
          </div>
          
          {/* Status */}
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => handleChange('status', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(barrierStatuses).map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Risk Level */}
          <div className="space-y-2">
            <Label htmlFor="risk_level">Operational Risk Level</Label>
            <Select
              value={formData.risk_level}
              onValueChange={(value) => handleChange('risk_level', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select risk level" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(riskLevels).map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              Risk level indicates workflow priority, not clinical severity
            </p>
          </div>
          
          {/* Owning Role */}
          <div className="space-y-2">
            <Label htmlFor="owning_role">
              Responsible Team <span className="text-red-500">*</span>
            </Label>
            <Select
              value={formData.owning_role}
              onValueChange={(value) => handleChange('owning_role', value)}
            >
              <SelectTrigger className={errors.owning_role ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select responsible team" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(owningRoles).map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.owning_role && (
              <p className="text-red-500 text-sm">{errors.owning_role}</p>
            )}
          </div>
          
          {/* Target Resolution Date */}
          <div className="space-y-2">
            <Label htmlFor="target_resolution_date">Target Resolution Date</Label>
            <Input
              type="date"
              id="target_resolution_date"
              value={formData.target_resolution_date}
              onChange={(e) => handleChange('target_resolution_date', e.target.value)}
            />
            <p className="text-xs text-slate-500">Optional: Expected date for barrier resolution</p>
          </div>
          
          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">
              Notes <span className="text-slate-500 text-xs">(optional, {MAX_NOTES_LENGTH} char max)</span>
            </Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Brief, non-clinical notes only..."
              maxLength={MAX_NOTES_LENGTH}
              rows={3}
              className={errors.notes ? 'border-red-500' : ''}
            />
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">
                Do not include clinical details or diagnoses
              </span>
              <span className={formData.notes.length > MAX_NOTES_LENGTH - 20 ? 'text-amber-600' : 'text-slate-500'}>
                {formData.notes.length}/{MAX_NOTES_LENGTH}
              </span>
            </div>
            {errors.notes && (
              <p className="text-red-500 text-sm">{errors.notes}</p>
            )}
          </div>
          
          {/* Submit Error */}
          {errors.submit && (
            <Alert variant="destructive">
              <AlertDescription>{errors.submit}</AlertDescription>
            </Alert>
          )}
          
          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSubmitting}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              {isSubmitting ? 'Saving...' : (isEditing ? 'Update Barrier' : 'Add Barrier')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
