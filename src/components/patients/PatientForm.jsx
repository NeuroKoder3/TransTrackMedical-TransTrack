import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { X, Save, Upload, AlertCircle } from 'lucide-react';
import { api } from '@/api/apiClient';

export default function PatientForm({ patient, onSave, onCancel }) {
  const [formData, setFormData] = useState(patient || {
    patient_id: '',
    first_name: '',
    last_name: '',
    date_of_birth: '',
    blood_type: '',
    phone: '',
    email: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    organ_needed: '',
    medical_urgency: 'medium',
    waitlist_status: 'active',
    date_added_to_waitlist: new Date().toISOString().split('T')[0],
    last_evaluation_date: '',
    meld_score: null,
    las_score: null,
    pra_percentage: null,
    cpra_percentage: null,
    weight_kg: null,
    height_cm: null,
    diagnosis: '',
    comorbidities: '',
    medications: '',
    notes: '',
    hla_typing: '',
    donor_preferences: '',
    functional_status: 'independent',
    prognosis_rating: 'good',
    comorbidity_score: null,
    previous_transplants: 0,
    psychological_clearance: true,
    compliance_score: null,
    support_system_rating: 'good',
  });

  const [uploading, setUploading] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [showErrors, setShowErrors] = useState(false);

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
    // Clear validation error for this field when user makes changes
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  // Validate form data
  const validateForm = () => {
    const errors = {};
    
    // Required field validations
    if (!formData.patient_id || formData.patient_id.trim() === '') {
      errors.patient_id = 'Patient ID is required';
    }
    if (!formData.first_name || formData.first_name.trim() === '') {
      errors.first_name = 'First name is required';
    }
    if (!formData.last_name || formData.last_name.trim() === '') {
      errors.last_name = 'Last name is required';
    }
    if (!formData.blood_type) {
      errors.blood_type = 'Blood type is required';
    }
    if (!formData.organ_needed) {
      errors.organ_needed = 'Organ needed is required';
    }
    
    // Email validation (if provided)
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Invalid email format';
    }
    
    // Score range validations
    if (formData.meld_score !== null && formData.meld_score !== '' && 
        (formData.meld_score < 6 || formData.meld_score > 40)) {
      errors.meld_score = 'MELD score must be between 6 and 40';
    }
    if (formData.las_score !== null && formData.las_score !== '' && 
        (formData.las_score < 0 || formData.las_score > 100)) {
      errors.las_score = 'LAS score must be between 0 and 100';
    }
    if (formData.pra_percentage !== null && formData.pra_percentage !== '' && 
        (formData.pra_percentage < 0 || formData.pra_percentage > 100)) {
      errors.pra_percentage = 'PRA must be between 0 and 100';
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = () => {
    setShowErrors(true);
    if (validateForm()) {
      onSave(formData);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    setUploading(true);
    
    try {
      const uploadPromises = files.map(file => 
        api.integrations.Core.UploadFile({ file })
      );
      const results = await Promise.all(uploadPromises);
      const urls = results.map(r => r.file_url);
      
      handleChange('document_urls', [...(formData.document_urls || []), ...urls]);
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Validation Error Summary */}
      {showErrors && Object.keys(validationErrors).length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please fix the following errors before saving:
            <ul className="list-disc list-inside mt-2">
              {Object.values(validationErrors).map((error, idx) => (
                <li key={idx}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="patient_id" className={validationErrors.patient_id ? 'text-red-600' : ''}>
                Patient ID *
              </Label>
              <Input
                id="patient_id"
                value={formData.patient_id}
                onChange={(e) => handleChange('patient_id', e.target.value)}
                placeholder="MRN-12345"
                className={validationErrors.patient_id ? 'border-red-500' : ''}
                aria-invalid={!!validationErrors.patient_id}
                aria-describedby={validationErrors.patient_id ? 'patient_id-error' : undefined}
              />
              {validationErrors.patient_id && (
                <p id="patient_id-error" className="text-sm text-red-600 mt-1">{validationErrors.patient_id}</p>
              )}
            </div>
            <div>
              <Label htmlFor="first_name" className={validationErrors.first_name ? 'text-red-600' : ''}>
                First Name *
              </Label>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) => handleChange('first_name', e.target.value)}
                className={validationErrors.first_name ? 'border-red-500' : ''}
                aria-invalid={!!validationErrors.first_name}
              />
              {validationErrors.first_name && (
                <p className="text-sm text-red-600 mt-1">{validationErrors.first_name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="last_name" className={validationErrors.last_name ? 'text-red-600' : ''}>
                Last Name *
              </Label>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => handleChange('last_name', e.target.value)}
                className={validationErrors.last_name ? 'border-red-500' : ''}
                aria-invalid={!!validationErrors.last_name}
              />
              {validationErrors.last_name && (
                <p className="text-sm text-red-600 mt-1">{validationErrors.last_name}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="date_of_birth">Date of Birth</Label>
              <Input
                id="date_of_birth"
                type="date"
                value={formData.date_of_birth}
                onChange={(e) => handleChange('date_of_birth', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="blood_type" className={validationErrors.blood_type ? 'text-red-600' : ''}>
                Blood Type *
              </Label>
              <Select value={formData.blood_type} onValueChange={(value) => handleChange('blood_type', value)}>
                <SelectTrigger className={validationErrors.blood_type ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select blood type" />
                </SelectTrigger>
                <SelectContent>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {validationErrors.blood_type && (
                <p className="text-sm text-red-600 mt-1">{validationErrors.blood_type}</p>
              )}
            </div>
            <div>
              <Label htmlFor="organ_needed" className={validationErrors.organ_needed ? 'text-red-600' : ''}>
                Organ Needed *
              </Label>
              <Select value={formData.organ_needed} onValueChange={(value) => handleChange('organ_needed', value)}>
                <SelectTrigger className={validationErrors.organ_needed ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select organ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kidney">Kidney</SelectItem>
                  <SelectItem value="liver">Liver</SelectItem>
                  <SelectItem value="heart">Heart</SelectItem>
                  <SelectItem value="lung">Lung</SelectItem>
                  <SelectItem value="pancreas">Pancreas</SelectItem>
                  <SelectItem value="kidney_pancreas">Kidney-Pancreas</SelectItem>
                  <SelectItem value="intestine">Intestine</SelectItem>
                </SelectContent>
              </Select>
              {validationErrors.organ_needed && (
                <p className="text-sm text-red-600 mt-1">{validationErrors.organ_needed}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="emergency_contact_name">Emergency Contact Name</Label>
              <Input
                id="emergency_contact_name"
                value={formData.emergency_contact_name}
                onChange={(e) => handleChange('emergency_contact_name', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="emergency_contact_phone">Emergency Contact Phone</Label>
              <Input
                id="emergency_contact_phone"
                value={formData.emergency_contact_phone}
                onChange={(e) => handleChange('emergency_contact_phone', e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waitlist Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="medical_urgency">Medical Urgency</Label>
              <Select value={formData.medical_urgency} onValueChange={(value) => handleChange('medical_urgency', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="waitlist_status">Waitlist Status</Label>
              <Select value={formData.waitlist_status} onValueChange={(value) => handleChange('waitlist_status', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="temporarily_inactive">Temporarily Inactive</SelectItem>
                  <SelectItem value="transplanted">Transplanted</SelectItem>
                  <SelectItem value="removed">Removed</SelectItem>
                  <SelectItem value="deceased">Deceased</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="date_added_to_waitlist">Date Added to Waitlist</Label>
              <Input
                id="date_added_to_waitlist"
                type="date"
                value={formData.date_added_to_waitlist}
                onChange={(e) => handleChange('date_added_to_waitlist', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="last_evaluation_date">Last Evaluation Date</Label>
              <Input
                id="last_evaluation_date"
                type="date"
                value={formData.last_evaluation_date}
                onChange={(e) => handleChange('last_evaluation_date', e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clinical Scores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="meld_score">MELD Score (6-40)</Label>
              <Input
                id="meld_score"
                type="number"
                min="6"
                max="40"
                value={formData.meld_score || ''}
                onChange={(e) => handleChange('meld_score', parseFloat(e.target.value) || null)}
              />
            </div>
            <div>
              <Label htmlFor="las_score">LAS Score (0-100)</Label>
              <Input
                id="las_score"
                type="number"
                min="0"
                max="100"
                value={formData.las_score || ''}
                onChange={(e) => handleChange('las_score', parseFloat(e.target.value) || null)}
              />
            </div>
            <div>
              <Label htmlFor="pra_percentage">PRA %</Label>
              <Input
                id="pra_percentage"
                type="number"
                min="0"
                max="100"
                value={formData.pra_percentage || ''}
                onChange={(e) => handleChange('pra_percentage', parseFloat(e.target.value) || null)}
              />
            </div>
            <div>
              <Label htmlFor="cpra_percentage">CPRA %</Label>
              <Input
                id="cpra_percentage"
                type="number"
                min="0"
                max="100"
                value={formData.cpra_percentage || ''}
                onChange={(e) => handleChange('cpra_percentage', parseFloat(e.target.value) || null)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="weight_kg">Weight (kg)</Label>
              <Input
                id="weight_kg"
                type="number"
                value={formData.weight_kg || ''}
                onChange={(e) => handleChange('weight_kg', parseFloat(e.target.value) || null)}
              />
            </div>
            <div>
              <Label htmlFor="height_cm">Height (cm)</Label>
              <Input
                id="height_cm"
                type="number"
                value={formData.height_cm || ''}
                onChange={(e) => handleChange('height_cm', parseFloat(e.target.value) || null)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clinical Assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="functional_status">Functional Status</Label>
              <Select value={formData.functional_status} onValueChange={(value) => handleChange('functional_status', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="independent">Independent</SelectItem>
                  <SelectItem value="partially_dependent">Partially Dependent</SelectItem>
                  <SelectItem value="fully_dependent">Fully Dependent</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="prognosis_rating">Prognosis Rating</Label>
              <Select value={formData.prognosis_rating} onValueChange={(value) => handleChange('prognosis_rating', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="comorbidity_score">Comorbidity Score (0-10)</Label>
              <Input
                id="comorbidity_score"
                type="number"
                min="0"
                max="10"
                value={formData.comorbidity_score || ''}
                onChange={(e) => handleChange('comorbidity_score', parseFloat(e.target.value) || null)}
              />
            </div>
            <div>
              <Label htmlFor="compliance_score">Compliance Score (0-10)</Label>
              <Input
                id="compliance_score"
                type="number"
                min="0"
                max="10"
                value={formData.compliance_score || ''}
                onChange={(e) => handleChange('compliance_score', parseFloat(e.target.value) || null)}
              />
            </div>
            <div>
              <Label htmlFor="previous_transplants">Previous Transplants</Label>
              <Input
                id="previous_transplants"
                type="number"
                min="0"
                value={formData.previous_transplants || 0}
                onChange={(e) => handleChange('previous_transplants', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="support_system_rating">Support System Rating</Label>
            <Select value={formData.support_system_rating} onValueChange={(value) => handleChange('support_system_rating', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="excellent">Excellent</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="adequate">Adequate</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Medical Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="diagnosis">Primary Diagnosis</Label>
            <Textarea
              id="diagnosis"
              value={formData.diagnosis}
              onChange={(e) => handleChange('diagnosis', e.target.value)}
              placeholder="Primary diagnosis requiring transplant"
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="comorbidities">Comorbidities</Label>
            <Textarea
              id="comorbidities"
              value={formData.comorbidities}
              onChange={(e) => handleChange('comorbidities', e.target.value)}
              placeholder="Additional medical conditions"
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="medications">Current Medications</Label>
            <Textarea
              id="medications"
              value={formData.medications}
              onChange={(e) => handleChange('medications', e.target.value)}
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="hla_typing">HLA Typing</Label>
            <Input
              id="hla_typing"
              value={formData.hla_typing}
              onChange={(e) => handleChange('hla_typing', e.target.value)}
              placeholder="HLA typing results"
            />
          </div>

          <div>
            <Label htmlFor="notes">Clinical Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={3}
            />
          </div>

          <div>
            <Label>Document Attachments</Label>
            <div className="mt-2">
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              />
              <label htmlFor="file-upload">
                <Button variant="outline" asChild disabled={uploading}>
                  <span>
                    <Upload className="w-4 h-4 mr-2" />
                    {uploading ? 'Uploading...' : 'Upload Documents'}
                  </span>
                </Button>
              </label>
              {formData.document_urls && formData.document_urls.length > 0 && (
                <div className="mt-2 text-sm text-slate-600">
                  {formData.document_urls.length} document(s) attached
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end space-x-3">
        <Button variant="outline" onClick={onCancel}>
          <X className="w-4 h-4 mr-2" />
          Cancel
        </Button>
        <Button onClick={handleSave} className="bg-cyan-600 hover:bg-cyan-700">
          <Save className="w-4 h-4 mr-2" />
          {patient ? 'Update Patient' : 'Add Patient'}
        </Button>
      </div>
    </div>
  );
}