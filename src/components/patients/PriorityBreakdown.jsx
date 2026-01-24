import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Clock, Activity, Droplet, AlertCircle, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function PriorityBreakdown({ patient }) {
  if (!patient.priority_score_breakdown) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Info className="w-12 h-12 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-600">Priority breakdown not available</p>
          <p className="text-sm text-slate-500 mt-1">Recalculate priority to see detailed breakdown</p>
        </CardContent>
      </Card>
    );
  }

  const breakdown = patient.priority_score_breakdown;
  const { components, raw_scores, weighted_scores, adjustments, weights_used } = breakdown;

  const ScoreBar = ({ label, raw, weighted, max = 100, icon: Icon, color = 'cyan' }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {Icon && <Icon className={`w-4 h-4 text-${color}-600`} />}
          <span className="text-sm font-medium text-slate-700">{label}</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-500">Raw: {raw.toFixed(1)}</span>
          <Badge variant="outline" className="text-xs">
            {weighted.toFixed(1)} pts
          </Badge>
        </div>
      </div>
      <Progress value={(weighted / max) * 100} className={`h-2 bg-${color}-100`} />
    </div>
  );

  return (
    <div className="space-y-6">
      <Card className="border-cyan-200 bg-gradient-to-r from-cyan-50 to-teal-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5 text-cyan-600" />
              <span>Priority Score Breakdown</span>
            </CardTitle>
            <div className="text-right">
              <div className="text-3xl font-bold text-cyan-700">
                {breakdown.total.toFixed(1)}
              </div>
              <p className="text-xs text-slate-600">Total Score</p>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Main Scoring Components</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {weighted_scores.medical_urgency !== undefined && (
            <div>
              <ScoreBar
                label="Medical Urgency"
                raw={raw_scores.medical_urgency}
                weighted={weighted_scores.medical_urgency}
                max={weights_used.medical_urgency_weight}
                icon={AlertCircle}
                color="red"
              />
              {components.medical_urgency && (
                <div className="mt-2 ml-6 text-xs text-slate-600 space-y-1">
                  <p>• Base urgency: {components.medical_urgency.base?.toFixed(1)} ({patient.medical_urgency})</p>
                  {patient.functional_status && (
                    <p>• Functional status: ×{components.medical_urgency.functional_adjustment?.toFixed(2)} ({patient.functional_status})</p>
                  )}
                  {patient.prognosis_rating && (
                    <p>• Prognosis: ×{components.medical_urgency.prognosis_adjustment?.toFixed(2)} ({patient.prognosis_rating})</p>
                  )}
                </div>
              )}
            </div>
          )}

          {weighted_scores.time_on_waitlist !== undefined && (
            <div>
              <ScoreBar
                label="Time on Waitlist"
                raw={raw_scores.time_on_waitlist}
                weighted={weighted_scores.time_on_waitlist}
                max={weights_used.time_on_waitlist_weight}
                icon={Clock}
                color="amber"
              />
              {components.time_on_waitlist && (
                <div className="mt-2 ml-6 text-xs text-slate-600">
                  <p>• Days on waitlist: {components.time_on_waitlist.days}</p>
                  {components.time_on_waitlist.long_wait_bonus > 0 && (
                    <p>• Long wait bonus: +{components.time_on_waitlist.long_wait_bonus} points</p>
                  )}
                </div>
              )}
            </div>
          )}

          {weighted_scores.organ_specific !== undefined && (
            <div>
              <ScoreBar
                label="Organ-Specific Score"
                raw={raw_scores.organ_specific}
                weighted={weighted_scores.organ_specific}
                max={weights_used.organ_specific_score_weight}
                icon={Activity}
                color="purple"
              />
              {components.organ_specific && (
                <div className="mt-2 ml-6 text-xs text-slate-600">
                  <p>• Type: {components.organ_specific.type}</p>
                  {components.organ_specific.score && (
                    <p>• Raw score: {components.organ_specific.score}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {weighted_scores.evaluation_recency !== undefined && (
            <div>
              <ScoreBar
                label="Evaluation Recency"
                raw={raw_scores.evaluation_recency}
                weighted={weighted_scores.evaluation_recency}
                max={weights_used.evaluation_recency_weight}
                icon={Clock}
                color="green"
              />
              {components.evaluation_recency && (
                <div className="mt-2 ml-6 text-xs text-slate-600">
                  {components.evaluation_recency.days_since_eval !== undefined ? (
                    <>
                      <p>• Days since evaluation: {components.evaluation_recency.days_since_eval}</p>
                      {components.evaluation_recency.decay_periods > 0 && (
                        <p>• Decay applied: {components.evaluation_recency.decay_periods} period(s) at {(components.evaluation_recency.decay_rate * 100).toFixed(0)}%</p>
                      )}
                    </>
                  ) : (
                    <p>• {components.evaluation_recency.status}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {weighted_scores.blood_type_rarity !== undefined && (
            <div>
              <ScoreBar
                label="Blood Type Rarity"
                raw={raw_scores.blood_type_rarity}
                weighted={weighted_scores.blood_type_rarity}
                max={weights_used.blood_type_rarity_weight}
                icon={Droplet}
                color="red"
              />
              {components.blood_type_rarity && (
                <div className="mt-2 ml-6 text-xs text-slate-600">
                  <p>• Blood type: {components.blood_type_rarity.blood_type}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {adjustments && (Object.values(adjustments).some(v => v !== 0)) && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base">Score Adjustments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {adjustments.comorbidity_penalty !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">Comorbidity Penalty:</span>
                <span className="font-medium text-orange-700">
                  {adjustments.comorbidity_penalty.toFixed(1)} pts
                </span>
              </div>
            )}
            {adjustments.previous_transplant_adjustment !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">Previous Transplant:</span>
                <span className="font-medium text-orange-700">
                  {adjustments.previous_transplant_adjustment.toFixed(1)} pts
                </span>
              </div>
            )}
            {adjustments.compliance_bonus !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">Compliance Bonus:</span>
                <span className="font-medium text-green-700">
                  +{adjustments.compliance_bonus.toFixed(1)} pts
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-base">Weight Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Medical Urgency:</span>
              <span className="font-medium">{weights_used.medical_urgency_weight}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Time on Waitlist:</span>
              <span className="font-medium">{weights_used.time_on_waitlist_weight}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Organ-Specific:</span>
              <span className="font-medium">{weights_used.organ_specific_score_weight}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Evaluation Recency:</span>
              <span className="font-medium">{weights_used.evaluation_recency_weight}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Blood Type Rarity:</span>
              <span className="font-medium">{weights_used.blood_type_rarity_weight}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Eval. Decay Rate:</span>
              <span className="font-medium">{(weights_used.evaluation_decay_rate * 100).toFixed(0)}%</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}