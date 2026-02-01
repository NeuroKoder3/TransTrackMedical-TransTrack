/**
 * LabForm Component
 * 
 * Form for adding or editing lab results.
 * 
 * IMPORTANT DISCLAIMER:
 * Lab results are stored for DOCUMENTATION purposes only.
 * The system does NOT interpret lab values or provide clinical assessments.
 */

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Save, Info, FlaskConical } from 'lucide-react';
import api from '@/api/localClient';

export default function LabForm({ 
  patientId, 
  lab = null, 
  onSave, 
  onCancel,
}) {
  const isEditing = !!lab;
  
  // Fetch common lab codes
  const { data: commonCodes = [] } = useQuery({
    queryKey: ['labCodes'],
    queryFn: () => api.labs.getCodes(),
  });
  
  const [formData, setFormData] = useState({
    patient_id: patientId,
    test_code: '',
    test_name: '',
    value: '',
    units: '',
    reference_range: '',
    collected_at: new Date().toISOString().split('T')[0],
    resulted_at: '',
    ordering_service: '',
  });
  
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Populate form when editing
  useEffect(() => {
    if (lab) {
      setFormData({
        patient_id: patientId,
        test_code: lab.test_code || '',
        test_name: lab.test_name || '',
        value: lab.value || '',
        units: lab.units || '',
        reference_range: lab.reference_range || '',
        collected_at: lab.collected_at ? lab.collected_at.split('T')[0] : '',
        resulted_at: lab.resulted_at ? lab.resulted_at.split('T')[0] : '',
        ordering_service: lab.ordering_service || '',
      });
    }
  }, [lab, patientId]);
  
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };
  
  const handleCodeSelect = (code) => {
    const selected = commonCodes.find(c => c.code === code);
    if (selected) {
      setFormData(prev => ({
        ...prev,
        test_code: selected.code,
        test_name: selected.name,
      }));
    }
  };
  
  const validate = () => {
    const newErrors = {};
    
    if (!formData.test_code.trim()) {
      newErrors.test_code = 'Test code is required';
    }
    if (!formData.test_name.trim()) {
      newErrors.test_name = 'Test name is required';
    }
    if (!formData.value.trim()) {
      newErrors.value = 'Value is required';
    }
    if (!formData.collected_at) {
      newErrors.collected_at = 'Collection date is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validate()) return;
    
    setIsSubmitting(true);
    try {
      await onSave(formData);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Group codes by category
  const codesByCategory = commonCodes.reduce((acc, code) => {
    const cat = code.category || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(code);
    return acc;
  }, {});
  
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-cyan-600" />
            <CardTitle className="text-lg">
              {isEditing ? 'Edit Lab Result' : 'Add Lab Result'}
            </CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <CardDescription className="text-xs">
          Documentation purposes only. Values are not clinically interpreted.
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <Alert className="mb-4 bg-slate-50 border-slate-200">
          <Info className="h-4 w-4 text-slate-600" />
          <AlertDescription className="text-slate-600 text-xs">
            Lab results are stored for documentation completeness only. 
            The system does NOT interpret values as normal/abnormal.
          </AlertDescription>
        </Alert>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Test Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="test_code">
                Test Code <span className="text-red-500">*</span>
              </Label>
              <Select 
                value={formData.test_code} 
                onValueChange={handleCodeSelect}
              >
                <SelectTrigger className={errors.test_code ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select or type code" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(codesByCategory).map(([category, codes]) => (
                    <div key={category}>
                      <div className="px-2 py-1.5 text-xs font-medium text-slate-500 bg-slate-50">
                        {category}
                      </div>
                      {codes.map(code => (
                        <SelectItem key={code.code} value={code.code}>
                          {code.code} - {code.name}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
              {errors.test_code && (
                <p className="text-xs text-red-500">{errors.test_code}</p>
              )}
              <Input
                id="test_code"
                value={formData.test_code}
                onChange={(e) => handleChange('test_code', e.target.value.toUpperCase())}
                placeholder="Or enter custom code"
                className="mt-1"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="test_name">
                Test Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="test_name"
                value={formData.test_name}
                onChange={(e) => handleChange('test_name', e.target.value)}
                placeholder="e.g., Creatinine"
                className={errors.test_name ? 'border-red-500' : ''}
              />
              {errors.test_name && (
                <p className="text-xs text-red-500">{errors.test_name}</p>
              )}
            </div>
          </div>
          
          {/* Value and Units */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="value">
                Value <span className="text-red-500">*</span>
              </Label>
              <Input
                id="value"
                value={formData.value}
                onChange={(e) => handleChange('value', e.target.value)}
                placeholder="e.g., 1.2"
                className={errors.value ? 'border-red-500' : ''}
              />
              {errors.value && (
                <p className="text-xs text-red-500">{errors.value}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="units">Units</Label>
              <Input
                id="units"
                value={formData.units}
                onChange={(e) => handleChange('units', e.target.value)}
                placeholder="e.g., mg/dL"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="reference_range">Reference Range</Label>
              <Input
                id="reference_range"
                value={formData.reference_range}
                onChange={(e) => handleChange('reference_range', e.target.value)}
                placeholder="e.g., 0.6-1.3"
              />
            </div>
          </div>
          
          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="collected_at">
                Date Collected <span className="text-red-500">*</span>
              </Label>
              <Input
                id="collected_at"
                type="date"
                value={formData.collected_at}
                onChange={(e) => handleChange('collected_at', e.target.value)}
                className={errors.collected_at ? 'border-red-500' : ''}
              />
              {errors.collected_at && (
                <p className="text-xs text-red-500">{errors.collected_at}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="resulted_at">Date Resulted</Label>
              <Input
                id="resulted_at"
                type="date"
                value={formData.resulted_at}
                onChange={(e) => handleChange('resulted_at', e.target.value)}
              />
            </div>
          </div>
          
          {/* Ordering Service */}
          <div className="space-y-2">
            <Label htmlFor="ordering_service">Ordering Service (Optional)</Label>
            <Input
              id="ordering_service"
              value={formData.ordering_service}
              onChange={(e) => handleChange('ordering_service', e.target.value)}
              placeholder="e.g., Nephrology"
            />
          </div>
          
          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              className="bg-cyan-600 hover:bg-cyan-700"
              disabled={isSubmitting}
            >
              <Save className="w-4 h-4 mr-2" />
              {isSubmitting ? 'Saving...' : (isEditing ? 'Update' : 'Save Lab')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
