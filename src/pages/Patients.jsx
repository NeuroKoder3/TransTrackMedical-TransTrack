import React, { useState } from 'react';
import { api } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Users, Loader2, AlertCircle } from 'lucide-react';
import PatientForm from '../components/patients/PatientForm';
import { motion, AnimatePresence } from 'framer-motion';

export default function Patients() {
  const [showForm, setShowForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [error, setError] = useState(null);
  const queryClient = useQueryClient();

  const { data: patients = [], isLoading, error: queryError } = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.entities.Patient.list('-created_at', 500),
  });

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => api.auth.me(),
  });

  const createPatientMutation = useMutation({
    mutationFn: async (patientData) => {
      const patient = await api.entities.Patient.create(patientData);
      
      // Calculate initial priority
      try {
        await api.functions.invoke('calculatePriorityAdvanced', { patient_id: patient.id });
      } catch (e) {
        // Priority calculation is non-critical, continue
      }
      
      return patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      setShowForm(false);
      setEditingPatient(null);
      setError(null);
    },
    onError: (error) => {
      setError(error.message || 'Failed to create patient. Please try again.');
    },
  });

  const updatePatientMutation = useMutation({
    mutationFn: async ({ id, patientData, oldData }) => {
      const updated = await api.entities.Patient.update(id, patientData);
      
      // Recalculate priority after update
      try {
        await api.functions.invoke('calculatePriorityAdvanced', { patient_id: id });
        
        // Check notification rules
        await api.functions.invoke('checkNotificationRules', {
          patient_id: id,
          event_type: 'update',
          old_data: oldData,
        });
      } catch (e) {
        // Non-critical, continue
      }
      
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      setShowForm(false);
      setEditingPatient(null);
      setError(null);
    },
    onError: (error) => {
      setError(error.message || 'Failed to update patient. Please try again.');
    },
  });

  const handleSave = (patientData) => {
    if (editingPatient) {
      updatePatientMutation.mutate({ id: editingPatient.id, patientData, oldData: editingPatient });
    } else {
      createPatientMutation.mutate(patientData);
    }
  };

  const handleEdit = (patient) => {
    setEditingPatient(patient);
    setShowForm(true);
  };

  const isMutating = createPatientMutation.isPending || updatePatientMutation.isPending;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Patient Management</h1>
            <p className="text-slate-600 mt-1">Add and manage patient records</p>
          </div>
          {!showForm && (
            <Button
              onClick={() => {
                setEditingPatient(null);
                setShowForm(true);
                setError(null);
              }}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Patient
            </Button>
          )}
        </div>

        {/* Error Display */}
        {(error || queryError) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error || queryError?.message || 'An error occurred. Please try again.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {isLoading && (
          <Card className="border-slate-200">
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-600 mr-2" />
              <span className="text-slate-600">Loading patients...</span>
            </CardContent>
          </Card>
        )}

        <AnimatePresence mode="wait">
          {showForm ? (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {isMutating && (
                <div className="mb-4 flex items-center text-cyan-600">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  <span>Saving patient...</span>
                </div>
              )}
              <PatientForm
                patient={editingPatient}
                onSave={handleSave}
                onCancel={() => {
                  setShowForm(false);
                  setEditingPatient(null);
                  setError(null);
                }}
              />
            </motion.div>
          ) : !isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {patients.length === 0 ? (
                <Card className="border-slate-200">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Users className="w-16 h-16 text-slate-300 mb-4" />
                    <p className="text-slate-600 text-lg mb-2">No patients yet</p>
                    <p className="text-slate-500 text-sm">Add your first patient to get started</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                            Patient
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                            Blood Type
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                            Organ
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                            Priority
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {patients.map((patient) => (
                          <tr key={patient.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <div>
                                <div className="font-medium text-slate-900">
                                  {patient.first_name} {patient.last_name}
                                </div>
                                <div className="text-sm text-slate-500">{patient.patient_id}</div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-900">{patient.blood_type}</td>
                            <td className="px-6 py-4 text-sm text-slate-900 capitalize">
                              {patient.organ_needed?.replace(/_/g, '-')}
                            </td>
                            <td className="px-6 py-4">
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                                {patient.waitlist_status?.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="font-semibold text-slate-900">
                                {(patient.priority_score || 0).toFixed(0)}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleEdit(patient)}
                              >
                                Edit
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}