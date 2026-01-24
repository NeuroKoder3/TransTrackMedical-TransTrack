import React, { useState } from 'react';
import { api } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Settings, Save, RefreshCw, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function PrioritySettings() {
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => api.auth.me(),
  });

  const { data: weights = [] } = useQuery({
    queryKey: ['priorityWeights'],
    queryFn: () => api.entities.PriorityWeights.list(),
    enabled: user?.role === 'admin',
  });

  const activeWeight = weights.find(w => w.is_active) || {
    weight_name: 'Default',
    medical_urgency_weight: 30,
    time_on_waitlist_weight: 25,
    organ_specific_score_weight: 25,
    evaluation_recency_weight: 10,
    blood_type_rarity_weight: 10,
    evaluation_decay_rate: 0.5,
    is_active: true,
  };

  const [formData, setFormData] = useState(activeWeight);
  const [recalculating, setRecalculating] = useState(false);

  const saveWeightsMutation = useMutation({
    mutationFn: async (data) => {
      // Deactivate all existing weights
      await Promise.all(
        weights.map(w => api.entities.PriorityWeights.update(w.id, { is_active: false }))
      );
      
      // Create or update new weights
      if (activeWeight.id) {
        return api.entities.PriorityWeights.update(activeWeight.id, data);
      } else {
        return api.entities.PriorityWeights.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priorityWeights'] });
    },
  });

  const handleSave = () => {
    saveWeightsMutation.mutate(formData);
  };

  const handleRecalculateAll = async () => {
    setRecalculating(true);
    try {
      const patients = await api.entities.Patient.filter({ waitlist_status: 'active' });
      
      for (const patient of patients) {
        await api.functions.invoke('calculatePriorityAdvanced', { patient_id: patient.id });
      }
      
      alert(`Successfully recalculated priority scores for ${patients.length} active patients`);
    } catch (error) {
      console.error('Recalculation error:', error);
      alert('Error recalculating priorities');
    } finally {
      setRecalculating(false);
    }
  };

  const totalWeight = 
    formData.medical_urgency_weight + 
    formData.time_on_waitlist_weight + 
    formData.organ_specific_score_weight + 
    formData.evaluation_recency_weight + 
    formData.blood_type_rarity_weight;

  const isValidTotal = totalWeight === 100;

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-12 text-center">
              <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-red-900 mb-2">Admin Access Required</h2>
              <p className="text-red-700">Only administrators can configure priority weights</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Priority Scoring Configuration</h1>
            <p className="text-slate-600 mt-1">Customize the weighting factors for priority calculations</p>
          </div>
          <Button
            onClick={handleRecalculateAll}
            disabled={recalculating}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${recalculating ? 'animate-spin' : ''}`} />
            {recalculating ? 'Recalculating...' : 'Recalculate All'}
          </Button>
        </div>

        {!isValidTotal && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Total weight must equal 100%. Current total: {totalWeight}%
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Weight Distribution</CardTitle>
            <p className="text-sm text-slate-600">
              Adjust the importance of each factor in calculating patient priority scores
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-base">Medical Urgency Weight</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    value={formData.medical_urgency_weight}
                    onChange={(e) => setFormData({ ...formData, medical_urgency_weight: parseInt(e.target.value) || 0 })}
                    className="w-20 text-right"
                  />
                  <span className="text-slate-600">%</span>
                </div>
              </div>
              <Slider
                value={[formData.medical_urgency_weight]}
                onValueChange={([value]) => setFormData({ ...formData, medical_urgency_weight: value })}
                max={100}
                step={1}
                className="mt-2"
              />
              <p className="text-xs text-slate-500 mt-1">
                Considers patient's medical urgency, functional status, and prognosis
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-base">Time on Waitlist Weight</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    value={formData.time_on_waitlist_weight}
                    onChange={(e) => setFormData({ ...formData, time_on_waitlist_weight: parseInt(e.target.value) || 0 })}
                    className="w-20 text-right"
                  />
                  <span className="text-slate-600">%</span>
                </div>
              </div>
              <Slider
                value={[formData.time_on_waitlist_weight]}
                onValueChange={([value]) => setFormData({ ...formData, time_on_waitlist_weight: value })}
                max={100}
                step={1}
                className="mt-2"
              />
              <p className="text-xs text-slate-500 mt-1">
                Awards points based on how long patient has been waiting
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-base">Organ-Specific Score Weight</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    value={formData.organ_specific_score_weight}
                    onChange={(e) => setFormData({ ...formData, organ_specific_score_weight: parseInt(e.target.value) || 0 })}
                    className="w-20 text-right"
                  />
                  <span className="text-slate-600">%</span>
                </div>
              </div>
              <Slider
                value={[formData.organ_specific_score_weight]}
                onValueChange={([value]) => setFormData({ ...formData, organ_specific_score_weight: value })}
                max={100}
                step={1}
                className="mt-2"
              />
              <p className="text-xs text-slate-500 mt-1">
                Uses MELD, LAS, PRA/CPRA, or other organ-specific clinical scores
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-base">Evaluation Recency Weight</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    value={formData.evaluation_recency_weight}
                    onChange={(e) => setFormData({ ...formData, evaluation_recency_weight: parseInt(e.target.value) || 0 })}
                    className="w-20 text-right"
                  />
                  <span className="text-slate-600">%</span>
                </div>
              </div>
              <Slider
                value={[formData.evaluation_recency_weight]}
                onValueChange={([value]) => setFormData({ ...formData, evaluation_recency_weight: value })}
                max={100}
                step={1}
                className="mt-2"
              />
              <p className="text-xs text-slate-500 mt-1">
                Rewards patients with recent medical evaluations
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-base">Blood Type Rarity Weight</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    value={formData.blood_type_rarity_weight}
                    onChange={(e) => setFormData({ ...formData, blood_type_rarity_weight: parseInt(e.target.value) || 0 })}
                    className="w-20 text-right"
                  />
                  <span className="text-slate-600">%</span>
                </div>
              </div>
              <Slider
                value={[formData.blood_type_rarity_weight]}
                onValueChange={([value]) => setFormData({ ...formData, blood_type_rarity_weight: value })}
                max={100}
                step={1}
                className="mt-2"
              />
              <p className="text-xs text-slate-500 mt-1">
                Adjusts for difficulty finding compatible donors for rare blood types
              </p>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <div className="flex justify-between items-center text-lg font-semibold">
                <span>Total Weight:</span>
                <span className={isValidTotal ? 'text-green-600' : 'text-red-600'}>
                  {totalWeight}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Time Decay Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>Evaluation Decay Rate (per 90 days)</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={formData.evaluation_decay_rate}
                    onChange={(e) => setFormData({ ...formData, evaluation_decay_rate: parseFloat(e.target.value) || 0 })}
                    className="w-20 text-right"
                  />
                </div>
              </div>
              <Slider
                value={[formData.evaluation_decay_rate * 100]}
                onValueChange={([value]) => setFormData({ ...formData, evaluation_decay_rate: value / 100 })}
                max={100}
                step={5}
                className="mt-2"
              />
              <p className="text-xs text-slate-500 mt-1">
                Rate at which evaluation score decreases over time (0 = no decay, 1 = full decay)
              </p>
              <p className="text-xs text-slate-600 mt-2">
                Example: With {(formData.evaluation_decay_rate * 100).toFixed(0)}% decay rate, an evaluation 
                180 days old will score {((1 - formData.evaluation_decay_rate) ** 2 * 100).toFixed(0)}% of its original value
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuration Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Configuration Name</Label>
              <Input
                value={formData.weight_name || ''}
                onChange={(e) => setFormData({ ...formData, weight_name: e.target.value })}
                placeholder="e.g., Default, High Urgency Focus, Balanced"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label>Active Configuration</Label>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end space-x-3">
          <Button
            onClick={handleSave}
            disabled={!isValidTotal || saveWeightsMutation.isPending}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveWeightsMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>

        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-6">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div>
                <h3 className="font-semibold text-amber-900 mb-1">Important Note</h3>
                <p className="text-sm text-amber-800">
                  After saving new weight configurations, click "Recalculate All" to update priority scores 
                  for all active patients. This ensures consistency across the waitlist using the new weights.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}