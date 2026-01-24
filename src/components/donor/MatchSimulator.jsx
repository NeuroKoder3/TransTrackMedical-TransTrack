import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/apiClient';
import { Beaker, Play, X } from 'lucide-react';
import MatchList from './MatchList';

export default function MatchSimulator({ onClose }) {
  const [hypotheticalDonor, setHypotheticalDonor] = useState({
    donor_id: 'SIM-' + Date.now(),
    organ_type: 'kidney',
    blood_type: 'O+',
    hla_typing: 'A1, A2, B7, B8, DR3, DR4',
    donor_age: 35,
    donor_weight_kg: 75,
    donor_height_cm: 175,
    organ_quality: 'good',
  });

  const [matches, setMatches] = useState([]);
  const [simulating, setSimulating] = useState(false);

  const handleChange = (field, value) => {
    setHypotheticalDonor({ ...hypotheticalDonor, [field]: value });
  };

  const handleRunSimulation = async () => {
    setSimulating(true);
    try {
      const response = await api.functions.invoke('matchDonorAdvanced', {
        simulation_mode: true,
        hypothetical_donor: hypotheticalDonor,
      });
      setMatches(response.data.matches);
    } catch (error) {
      console.error('Simulation error:', error);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <Beaker className="w-5 h-5 text-purple-600" />
              <span>Match Simulation Tool</span>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-sm text-slate-600 mt-2">
            Create a hypothetical donor profile to predict potential matches
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hypothetical Donor Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Donor ID</Label>
              <Input
                value={hypotheticalDonor.donor_id}
                onChange={(e) => handleChange('donor_id', e.target.value)}
                placeholder="SIM-001"
              />
            </div>
            <div>
              <Label>Organ Type</Label>
              <Select value={hypotheticalDonor.organ_type} onValueChange={(value) => handleChange('organ_type', value)}>
                <SelectTrigger>
                  <SelectValue />
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
              <Label>Blood Type</Label>
              <Select value={hypotheticalDonor.blood_type} onValueChange={(value) => handleChange('blood_type', value)}>
                <SelectTrigger>
                  <SelectValue />
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
            <Label>HLA Typing</Label>
            <Input
              value={hypotheticalDonor.hla_typing}
              onChange={(e) => handleChange('hla_typing', e.target.value)}
              placeholder="A1, A2, B7, B8, DR3, DR4, DQ2"
            />
            <p className="text-xs text-slate-500 mt-1">Enter HLA antigens separated by commas</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>Donor Age</Label>
              <Input
                type="number"
                value={hypotheticalDonor.donor_age || ''}
                onChange={(e) => handleChange('donor_age', parseFloat(e.target.value))}
              />
            </div>
            <div>
              <Label>Weight (kg)</Label>
              <Input
                type="number"
                value={hypotheticalDonor.donor_weight_kg || ''}
                onChange={(e) => handleChange('donor_weight_kg', parseFloat(e.target.value))}
              />
            </div>
            <div>
              <Label>Height (cm)</Label>
              <Input
                type="number"
                value={hypotheticalDonor.donor_height_cm || ''}
                onChange={(e) => handleChange('donor_height_cm', parseFloat(e.target.value))}
              />
            </div>
            <div>
              <Label>Organ Quality</Label>
              <Select value={hypotheticalDonor.organ_quality} onValueChange={(value) => handleChange('organ_quality', value)}>
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
          </div>

          <div className="flex justify-end pt-4">
            <Button
              onClick={handleRunSimulation}
              disabled={simulating}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Play className="w-4 h-4 mr-2" />
              {simulating ? 'Running Simulation...' : 'Run Simulation'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {matches.length > 0 && (
        <div>
          <Card className="border-purple-200 bg-purple-50 mb-4">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-purple-900">Simulation Results</h3>
                  <p className="text-sm text-purple-700">
                    Found {matches.length} potential recipient{matches.length !== 1 ? 's' : ''} for this hypothetical donor
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-purple-700">
                    {matches[0]?.compatibility_score.toFixed(0)}%
                  </div>
                  <p className="text-xs text-purple-600">Top Match</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <MatchList
            matches={matches}
            donor={hypotheticalDonor}
            onUpdateMatch={() => {}}
            isSimulation={true}
          />
        </div>
      )}
    </div>
  );
}