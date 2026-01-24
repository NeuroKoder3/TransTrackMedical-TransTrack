import React, { useState } from 'react';
import { api } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Users } from 'lucide-react';
import PatientForm from '../components/patients/PatientForm';
import { motion, AnimatePresence } from 'framer-motion';

export default function Patients() {
  const [showForm, setShowForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const queryClient = useQueryClient();

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.entities.Patient.list('-created_date', 500),
  });

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => api.auth.me(),
  });

  const createPatientMutation = useMutation({
    mutationFn: async (patientData) => {
      const patient = await api.entities.Patient.create(patientData);
      
      // Calculate initial priority
      await api.functions.invoke('calculatePriorityAdvanced', { patient_id: patient.id });
      
      // Log action
      await api.entities.AuditLog.create({
        action: 'create',
        entity_type: 'Patient',
        entity_id: patient.id,
        patient_name: `${patientData.first_name} ${patientData.last_name}`,
        details: 'New patient added to waitlist',
        user_email: user.email,
        user_role: user.role,
      });
      
      return patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      setShowForm(false);
      setEditingPatient(null);
    },
  });

  const updatePatientMutation = useMutation({
    mutationFn: async ({ id, patientData, oldData }) => {
      const updated = await api.entities.Patient.update(id, patientData);
      
      // Recalculate priority after update
      await api.functions.invoke('calculatePriorityAdvanced', { patient_id: id });
      
      // Check notification rules
      await api.functions.invoke('checkNotificationRules', {
        patient_id: id,
        event_type: 'update',
        old_data: oldData,
      });
      
      // Log action
      await api.entities.AuditLog.create({
        action: 'update',
        entity_type: 'Patient',
        entity_id: id,
        patient_name: `${patientData.first_name} ${patientData.last_name}`,
        details: 'Patient information updated',
        user_email: user.email,
        user_role: user.role,
      });
      
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      setShowForm(false);
      setEditingPatient(null);
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
              }}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Patient
            </Button>
          )}
        </div>

        <AnimatePresence mode="wait">
          {showForm ? (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <PatientForm
                patient={editingPatient}
                onSave={handleSave}
                onCancel={() => {
                  setShowForm(false);
                  setEditingPatient(null);
                }}
              />
            </motion.div>
          ) : (
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