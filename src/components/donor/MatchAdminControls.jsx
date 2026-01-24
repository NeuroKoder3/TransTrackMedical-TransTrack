import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/api/apiClient';

export default function MatchAdminControls({ match, donor, onOverride }) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [newRank, setNewRank] = useState(match.priority_rank);
  const [submitting, setSubmitting] = useState(false);

  const handleOverride = async () => {
    if (!overrideReason.trim()) {
      alert('Please provide a reason for the override');
      return;
    }

    setSubmitting(true);
    try {
      // Find the match record
      const allMatches = await api.entities.Match.filter({
        donor_organ_id: donor.id,
        patient_id: match.patient_id,
      });
      
      if (allMatches.length > 0) {
        await api.entities.Match.update(allMatches[0].id, {
          admin_override: true,
          override_reason: overrideReason,
          priority_rank: newRank,
        });

        // Log the override
        const user = await api.auth.me();
        await api.entities.AuditLog.create({
          action: 'update',
          entity_type: 'Match',
          entity_id: allMatches[0].id,
          patient_name: match.patient_name,
          details: `Admin override: Match priority changed from rank ${match.priority_rank} to ${newRank}. Reason: ${overrideReason}`,
          user_email: user.email,
          user_role: user.role,
        });

        onOverride && onOverride();
        setShowOverride(false);
      }
    } catch (error) {
      console.error('Override error:', error);
      alert('Failed to apply override');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="text-base flex items-center space-x-2">
          <Shield className="w-4 h-4 text-amber-700" />
          <span>Administrative Controls</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!showOverride ? (
          <div>
            <Alert className="bg-white border-amber-200 mb-4">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                Admin override allows you to manually adjust match priority rankings based on 
                clinical judgment or special circumstances not captured by the algorithm.
              </AlertDescription>
            </Alert>
            <Button
              variant="outline"
              onClick={() => setShowOverride(true)}
              className="w-full border-amber-300 text-amber-700 hover:bg-amber-100"
            >
              <Shield className="w-4 h-4 mr-2" />
              Override Match Priority
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label>New Priority Rank</Label>
              <Input
                type="number"
                min="1"
                value={newRank}
                onChange={(e) => setNewRank(parseInt(e.target.value))}
                className="mt-1"
              />
              <p className="text-xs text-slate-600 mt-1">
                Current rank: {match.priority_rank}
              </p>
            </div>

            <div>
              <Label>Override Reason *</Label>
              <Textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain the clinical or administrative reason for this override..."
                rows={3}
                className="mt-1"
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setShowOverride(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleOverride}
                disabled={submitting}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                {submitting ? 'Applying...' : 'Apply Override'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}