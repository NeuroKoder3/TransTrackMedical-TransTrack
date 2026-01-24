import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { X, Save, Search } from 'lucide-react';

export default function DonorForm({ donor, onSave, onCancel, onMatch }) {
  const [formData, setFormData] = useState(donor || {
    donor_id: '',
    organ_type: '',
    blood_type: '',
    hla_typing: '',
    donor_age: null,
    donor_weight_kg: null,
    donor_height_cm: null,
    organ_quality: 'good',
    procurement_date: new Date().toISOString().split('T')[0],
    cold_ischemia_time_hours: null,
    status: 'available',
    location: '',
    notes: '',
    expiration_date: '',
  });

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleSaveAndMatch = async () => {
    await onSave(formData);
    if (onMatch) {
      onMatch();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Donor Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="donor_id">Donor ID *</Label>
              <Input
                id="donor_id"
                value={formData.donor_id}
                onChange={(e) => handleChange('donor_id', e.target.value)}
                placeholder="DONOR-12345"
              />
            </div>
            <div>
              <Label htmlFor="organ_type">Organ Type *</Label>
              <Select value={formData.organ_type} onValueChange={(value) => handleChange('organ_type', value)}>
                <SelectTrigger>
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
            </div>
            <div>
              <Label htmlFor="blood_type">Blood Type *</Label>
              <Select value={formData.blood_type} onValueChange={(value) => handleChange('blood_type', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select blood type" />
                </SelectTrigger>
                <SelectContent>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="hla_typing">HLA Typing</Label>
            <Input
              id="hla_typing"
              value={formData.hla_typing}
              onChange={(e) => handleChange('hla_typing', e.target.value)}
              placeholder="A1, A2, B7, B8, DR3, DR4"
            />
            <p className="text-xs text-slate-500 mt-1">Enter HLA antigens separated by commas</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="donor_age">Donor Age</Label>
              <Input
                id="donor_age"
                type="number"
                value={formData.donor_age || ''}
                onChange={(e) => handleChange('donor_age', parseFloat(e.target.value) || null)}
              />
            </div>
            <div>
              <Label htmlFor="donor_weight_kg">Weight (kg)</Label>
              <Input
                id="donor_weight_kg"
                type="number"
                value={formData.donor_weight_kg || ''}
                onChange={(e) => handleChange('donor_weight_kg', parseFloat(e.target.value) || null)}
              />
            </div>
            <div>
              <Label htmlFor="donor_height_cm">Height (cm)</Label>
              <Input
                id="donor_height_cm"
                type="number"
                value={formData.donor_height_cm || ''}
                onChange={(e) => handleChange('donor_height_cm', parseFloat(e.target.value) || null)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="organ_quality">Organ Quality</Label>
              <Select value={formData.organ_quality} onValueChange={(value) => handleChange('organ_quality', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="marginal">Marginal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => handleChange('status', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="allocated">Allocated</SelectItem>
                  <SelectItem value="transplanted">Transplanted</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="procurement_date">Procurement Date</Label>
              <Input
                id="procurement_date"
                type="date"
                value={formData.procurement_date}
                onChange={(e) => handleChange('procurement_date', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cold_ischemia_time_hours">Cold Ischemia Time (hrs)</Label>
              <Input
                id="cold_ischemia_time_hours"
                type="number"
                step="0.1"
                value={formData.cold_ischemia_time_hours || ''}
                onChange={(e) => handleChange('cold_ischemia_time_hours', parseFloat(e.target.value) || null)}
              />
            </div>
            <div>
              <Label htmlFor="expiration_date">Expiration Date</Label>
              <Input
                id="expiration_date"
                type="date"
                value={formData.expiration_date}
                onChange={(e) => handleChange('expiration_date', e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={formData.location}
              onChange={(e) => handleChange('location', e.target.value)}
              placeholder="Procurement center"
            />
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={3}
              placeholder="Additional donor or organ information"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end space-x-3">
        <Button variant="outline" onClick={onCancel}>
          <X className="w-4 h-4 mr-2" />
          Cancel
        </Button>
        <Button onClick={() => onSave(formData)} className="bg-slate-600 hover:bg-slate-700">
          <Save className="w-4 h-4 mr-2" />
          {donor ? 'Update' : 'Add'} Donor
        </Button>
        {!donor && (
          <Button onClick={handleSaveAndMatch} className="bg-cyan-600 hover:bg-cyan-700">
            <Search className="w-4 h-4 mr-2" />
            Save & Find Matches
          </Button>
        )}
      </div>
    </div>
  );
}