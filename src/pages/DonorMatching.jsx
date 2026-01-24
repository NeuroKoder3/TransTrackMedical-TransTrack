import React, { useState } from 'react';
import { api } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, Plus, Search, Users, Activity, Beaker } from 'lucide-react';
import DonorForm from '../components/donor/DonorForm';
import MatchList from '../components/donor/MatchList';
import MatchSimulator from '../components/donor/MatchSimulator';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';

export default function DonorMatching() {
  const [showDonorForm, setShowDonorForm] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [selectedDonor, setSelectedDonor] = useState(null);
  const [matches, setMatches] = useState([]);
  const [matching, setMatching] = useState(false);
  const queryClient = useQueryClient();

  const { data: donors = [], isLoading } = useQuery({
    queryKey: ['donors'],
    queryFn: () => api.entities.DonorOrgan.list('-created_date', 100),
  });

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => api.auth.me(),
  });

  const createDonorMutation = useMutation({
    mutationFn: async (donorData) => {
      const donor = await api.entities.DonorOrgan.create(donorData);
      
      await api.entities.AuditLog.create({
        action: 'create',
        entity_type: 'DonorOrgan',
        entity_id: donor.id,
        details: `New donor organ added: ${donorData.donor_id} (${donorData.organ_type})`,
        user_email: user.email,
        user_role: user.role,
      });
      
      return donor;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['donors'] });
      setShowDonorForm(false);
    },
  });

  const handleSaveDonor = async (donorData) => {
    await createDonorMutation.mutateAsync(donorData);
  };

  const handleFindMatches = async (donor) => {
    setMatching(true);
    setSelectedDonor(donor);
    try {
      const response = await api.functions.invoke('matchDonorAdvanced', {
        donor_organ_id: donor.id,
      });
      setMatches(response.data.matches);
    } catch (error) {
      console.error('Matching error:', error);
    } finally {
      setMatching(false);
    }
  };

  const handleUpdateMatch = async (match, newStatus) => {
    try {
      // Find the match record
      const allMatches = await api.entities.Match.filter({
        donor_organ_id: selectedDonor.id,
        patient_id: match.patient_id,
      });
      
      if (allMatches.length > 0) {
        await api.entities.Match.update(allMatches[0].id, {
          match_status: newStatus,
          ...(newStatus === 'contacted' && { contacted_date: new Date().toISOString().split('T')[0] }),
          ...(newStatus !== 'potential' && { response_date: new Date().toISOString().split('T')[0] }),
        });

        // If accepted, update donor status
        if (newStatus === 'accepted') {
          await api.entities.DonorOrgan.update(selectedDonor.id, {
            status: 'allocated',
            allocated_to_patient_id: match.patient_id,
          });
          
          // Create notification
          await api.entities.Notification.create({
            recipient_email: user.email,
            title: 'Match Accepted',
            message: `Donor ${selectedDonor.donor_id} has been allocated to ${match.patient_name}`,
            notification_type: 'donor_match',
            priority_level: 'high',
            related_patient_id: match.patient_id,
            related_patient_name: match.patient_name,
          });
        }

        // Refresh matches
        handleFindMatches(selectedDonor);
      }
    } catch (error) {
      console.error('Update match error:', error);
    }
  };

  const availableDonors = donors.filter(d => d.status === 'available');
  const allocatedDonors = donors.filter(d => d.status === 'allocated' || d.status === 'transplanted');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Donor Matching</h1>
            <p className="text-slate-600 mt-1">Match donor organs with compatible recipients</p>
          </div>
          {!showDonorForm && !showSimulator && (
            <div className="flex space-x-2">
              <Button onClick={() => setShowSimulator(true)} variant="outline" className="border-purple-300 text-purple-700 hover:bg-purple-50">
                <Beaker className="w-5 h-5 mr-2" />
                Match Simulator
              </Button>
              <Button onClick={() => setShowDonorForm(true)} className="bg-cyan-600 hover:bg-cyan-700">
                <Plus className="w-5 h-5 mr-2" />
                Add Donor Organ
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-green-700 flex items-center">
                <Heart className="w-4 h-4 mr-2" />
                Available Organs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-900">{availableDonors.length}</div>
            </CardContent>
          </Card>

          <Card className="border-blue-200 bg-blue-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-blue-700 flex items-center">
                <Activity className="w-4 h-4 mr-2" />
                Allocated
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-900">{allocatedDonors.length}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-700 flex items-center">
                <Users className="w-4 h-4 mr-2" />
                Total Donors
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{donors.length}</div>
            </CardContent>
          </Card>
        </div>

        <AnimatePresence mode="wait">
          {showSimulator ? (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <MatchSimulator onClose={() => setShowSimulator(false)} />
            </motion.div>
          ) : showDonorForm ? (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <DonorForm
                onSave={handleSaveDonor}
                onCancel={() => setShowDonorForm(false)}
                onMatch={() => {
                  // Get the last created donor and match it
                  const latestDonor = donors[0];
                  if (latestDonor) {
                    handleFindMatches(latestDonor);
                  }
                }}
              />
            </motion.div>
          ) : selectedDonor ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <Card className="border-cyan-200 bg-gradient-to-r from-cyan-50 to-teal-50">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-xl">
                        Donor {selectedDonor.donor_id}
                      </CardTitle>
                      <div className="flex items-center space-x-3 mt-2">
                        <Badge className="bg-purple-100 text-purple-700 capitalize">
                          {selectedDonor.organ_type.replace(/_/g, '-')}
                        </Badge>
                        <Badge className="bg-red-100 text-red-700">
                          {selectedDonor.blood_type}
                        </Badge>
                        <Badge className="bg-green-100 text-green-700 capitalize">
                          {selectedDonor.organ_quality}
                        </Badge>
                      </div>
                    </div>
                    <div className="space-x-2">
                      <Button
                        variant="outline"
                        onClick={() => setSelectedDonor(null)}
                      >
                        Back to Donors
                      </Button>
                      <Button
                        onClick={() => handleFindMatches(selectedDonor)}
                        disabled={matching}
                        className="bg-cyan-600 hover:bg-cyan-700"
                      >
                        <Search className="w-4 h-4 mr-2" />
                        {matching ? 'Matching...' : 'Refresh Matches'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-4">
                  Compatible Recipients ({matches.length})
                </h2>
                {matching ? (
                  <Card>
                    <CardContent className="p-12 text-center">
                      <div className="w-16 h-16 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="text-slate-600">Finding compatible recipients...</p>
                    </CardContent>
                  </Card>
                ) : (
                  <MatchList
                    matches={matches}
                    donor={selectedDonor}
                    onUpdateMatch={handleUpdateMatch}
                    user={user}
                    onRefresh={() => handleFindMatches(selectedDonor)}
                  />
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Available Donor Organs</CardTitle>
                </CardHeader>
                <CardContent>
                  {availableDonors.length === 0 ? (
                    <div className="text-center py-12">
                      <Heart className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                      <p className="text-slate-600">No available donor organs</p>
                      <Button className="mt-4" onClick={() => setShowDonorForm(true)}>
                        Add Donor Organ
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {availableDonors.map((donor) => (
                        <Card key={donor.id} className="border-slate-200 hover:shadow-lg transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h3 className="font-bold text-slate-900">Donor {donor.donor_id}</h3>
                                <p className="text-sm text-slate-600">
                                  {format(new Date(donor.procurement_date), 'MMM d, yyyy')}
                                </p>
                              </div>
                              <Badge className="bg-green-100 text-green-700">
                                {donor.status}
                              </Badge>
                            </div>
                            <div className="space-y-2 mb-4">
                              <div className="flex items-center space-x-2 text-sm">
                                <span className="text-slate-600">Organ:</span>
                                <span className="font-medium text-slate-900 capitalize">
                                  {donor.organ_type.replace(/_/g, '-')}
                                </span>
                              </div>
                              <div className="flex items-center space-x-2 text-sm">
                                <span className="text-slate-600">Blood:</span>
                                <span className="font-medium text-slate-900">{donor.blood_type}</span>
                              </div>
                              <div className="flex items-center space-x-2 text-sm">
                                <span className="text-slate-600">Quality:</span>
                                <span className="font-medium text-slate-900 capitalize">{donor.organ_quality}</span>
                              </div>
                            </div>
                            <Button
                              onClick={() => handleFindMatches(donor)}
                              className="w-full bg-cyan-600 hover:bg-cyan-700"
                              size="sm"
                            >
                              <Search className="w-4 h-4 mr-2" />
                              Find Matches
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}