import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { User, Droplet, TrendingUp, Award, Phone, Calendar } from 'lucide-react';
import PriorityBadge from '../waitlist/PriorityBadge';
import MatchAdminControls from './MatchAdminControls';

export default function MatchList({ matches, donor, onUpdateMatch, isSimulation = false, user, onRefresh }) {
  const getCompatibilityColor = (score) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-orange-600';
  };

  const getMatchStatusColor = (status) => {
    const colors = {
      potential: 'bg-blue-100 text-blue-700 border-blue-200',
      contacted: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      accepted: 'bg-green-100 text-green-700 border-green-200',
      declined: 'bg-red-100 text-red-700 border-red-200',
      expired: 'bg-slate-100 text-slate-700 border-slate-200',
    };
    return colors[status] || colors.potential;
  };

  return (
    <div className="space-y-4">
      {matches.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <User className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600">No matches found</p>
          </CardContent>
        </Card>
      ) : (
        matches.map((match, index) => (
          <Card key={index} className="border-2 hover:shadow-lg transition-shadow">
            <CardHeader className="bg-gradient-to-r from-slate-50 to-cyan-50">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4">
                  <div className="bg-gradient-to-br from-cyan-500 to-teal-600 p-3 rounded-xl">
                    <User className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">
                      {match.patient_name}
                      {match.priority_rank <= 3 && (
                        <Badge className="ml-2 bg-amber-100 text-amber-700">
                          <Award className="w-3 h-3 mr-1" />
                          Top {match.priority_rank} Match
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="text-sm text-slate-600">MRN: {match.patient_id_mrn}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-3xl font-bold ${getCompatibilityColor(match.compatibility_score)}`}>
                    {match.compatibility_score.toFixed(0)}%
                  </div>
                  <p className="text-xs text-slate-600">Compatible</p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div>
                  <h4 className="text-sm font-medium text-slate-600 mb-3">Patient Details</h4>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 text-sm">
                      <Droplet className="w-4 h-4 text-red-600" />
                      <span className="text-slate-600">Blood:</span>
                      <span className="font-medium text-slate-900">{match.blood_type}</span>
                      {match.blood_type_compatible && (
                        <Badge variant="outline" className="text-green-600 border-green-200">
                          Compatible
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-sm">
                      <TrendingUp className="w-4 h-4 text-cyan-600" />
                      <span className="text-slate-600">Medical Urgency:</span>
                      <span className="font-medium text-slate-900 capitalize">{match.medical_urgency}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm">
                      <Calendar className="w-4 h-4 text-slate-500" />
                      <span className="text-slate-600">Waitlist:</span>
                      <span className="font-medium text-slate-900">{match.days_on_waitlist} days</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-slate-600 mb-3">Compatibility Scores</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">HLA Match:</span>
                      <span className="font-medium text-slate-900">{match.hla_match_score.toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Priority Score:</span>
                      <span className="font-medium text-slate-900">{match.priority_score?.toFixed(0) || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Size Compatible:</span>
                      <span className={`font-medium ${match.size_compatible ? 'text-green-600' : 'text-orange-600'}`}>
                        {match.size_compatible ? 'Yes' : 'Check Required'}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-slate-600 mb-3">Priority</h4>
                  <PriorityBadge score={match.priority_score || 0} size="md" />
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-100">
                {match.virtual_crossmatch && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Virtual Crossmatch:</span>
                    <Badge className={`${
                      match.virtual_crossmatch === 'negative' ? 'bg-green-100 text-green-700 border-green-200' :
                      match.virtual_crossmatch === 'positive' ? 'bg-red-100 text-red-700 border-red-200' :
                      'bg-yellow-100 text-yellow-700 border-yellow-200'
                    } border`}>
                      {match.virtual_crossmatch.toUpperCase()}
                    </Badge>
                  </div>
                )}
                
                {match.predicted_graft_survival && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Predicted 1-Year Survival:</span>
                    <span className="font-semibold text-green-700">{match.predicted_graft_survival.toFixed(0)}%</span>
                  </div>
                )}

                {match.hla_matches && (
                  <div className="text-sm">
                    <span className="text-slate-600">HLA Locus Matches:</span>
                    <div className="flex space-x-3 mt-1">
                      <span className="text-xs">A: {match.hla_matches.A}/2</span>
                      <span className="text-xs">B: {match.hla_matches.B}/2</span>
                      <span className="text-xs">DR: {match.hla_matches.DR}/2</span>
                      <span className="text-xs">DQ: {match.hla_matches.DQ}/2</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  {!isSimulation && (
                    <>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm text-slate-600">Match Status:</span>
                        <Badge className={`${getMatchStatusColor(match.match_status)} border`}>
                          {match.match_status?.replace(/_/g, ' ').toUpperCase() || 'POTENTIAL'}
                        </Badge>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUpdateMatch(match, 'contacted')}
                        >
                          <Phone className="w-4 h-4 mr-1" />
                          Mark Contacted
                        </Button>
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() => onUpdateMatch(match, 'accepted')}
                        >
                          Accept Match
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUpdateMatch(match, 'declined')}
                        >
                          Decline
                        </Button>
                      </div>
                    </>
                  )}
                  {isSimulation && (
                    <p className="text-xs text-purple-600 italic">
                      Simulation mode - actions disabled
                    </p>
                  )}
                </div>
              </div>

              {!isSimulation && user?.role === 'admin' && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <MatchAdminControls 
                    match={match} 
                    donor={donor}
                    onOverride={onRefresh}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}