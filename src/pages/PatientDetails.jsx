import React from 'react';
import { api } from '@/api/apiClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, Heart, Droplet, Calendar, Phone, Mail, FileText, Download, RefreshCw } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from 'date-fns';
import PriorityBadge from '../components/waitlist/PriorityBadge';
import PriorityBreakdown from '../components/patients/PriorityBreakdown';
import PatientSyncControls from '../components/ehr/PatientSyncControls';
import { ReadinessBarrierList } from '../components/barriers';
import { AHHQPanel } from '../components/ahhq';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function PatientDetails() {
  // Use React Router's useLocation to get query params (works with HashRouter)
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const patientId = urlParams.get('id');
  const queryClient = useQueryClient();

  const { data: patient, isLoading } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      const patients = await api.entities.Patient.list();
      return patients.find(p => p.id === patientId);
    },
    enabled: !!patientId,
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['auditLogs', patientId],
    queryFn: () => api.entities.AuditLog.filter({ entity_id: patientId }, '-created_at', 50),
    enabled: !!patientId,
  });

  const recalculatePriorityMutation = useMutation({
    mutationFn: () => api.functions.invoke('calculatePriorityAdvanced', { patient_id: patientId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <div className="text-slate-600">Loading patient details...</div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-slate-600">Patient not found</p>
              <Link to={createPageUrl('Dashboard')}>
                <Button className="mt-4">Back to Dashboard</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const organLabels = {
    kidney: 'Kidney',
    liver: 'Liver',
    heart: 'Heart',
    lung: 'Lung',
    pancreas: 'Pancreas',
    kidney_pancreas: 'Kidney-Pancreas',
    intestine: 'Intestine',
  };

  const daysOnWaitlist = patient.date_added_to_waitlist
    ? Math.floor((new Date() - new Date(patient.date_added_to_waitlist)) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center space-x-4">
          <Link to={createPageUrl('Dashboard')}>
            <Button variant="outline" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-slate-900">
              {patient.first_name} {patient.last_name}
            </h1>
            <p className="text-slate-600">Patient ID: {patient.patient_id}</p>
          </div>
          <div className="flex items-center space-x-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => recalculatePriorityMutation.mutate()}
              disabled={recalculatePriorityMutation.isPending}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${recalculatePriorityMutation.isPending ? 'animate-spin' : ''}`} />
              Recalculate
            </Button>
            <PriorityBadge score={patient.priority_score || 0} size="lg" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Heart className="w-4 h-4 mr-2 text-cyan-600" />
                Organ Needed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">
                {organLabels[patient.organ_needed]}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Droplet className="w-4 h-4 mr-2 text-red-600" />
                Blood Type
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{patient.blood_type}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Calendar className="w-4 h-4 mr-2 text-slate-600" />
                Days on Waitlist
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{daysOnWaitlist}</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {patient.phone && (
                <div className="flex items-center space-x-2">
                  <Phone className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-900">{patient.phone}</span>
                </div>
              )}
              {patient.email && (
                <div className="flex items-center space-x-2">
                  <Mail className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-900">{patient.email}</span>
                </div>
              )}
              {patient.date_of_birth && (
                <div className="flex items-center space-x-2">
                  <Calendar className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-900">
                    DOB: {format(new Date(patient.date_of_birth), 'MMM d, yyyy')}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle>Emergency Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {patient.emergency_contact_name && (
                <div className="flex items-center space-x-2">
                  <User className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-900">{patient.emergency_contact_name}</span>
                </div>
              )}
              {patient.emergency_contact_phone && (
                <div className="flex items-center space-x-2">
                  <Phone className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-900">{patient.emergency_contact_phone}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Clinical Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-slate-600">Medical Urgency</div>
                <div className="text-lg font-semibold text-slate-900 capitalize">
                  {patient.medical_urgency}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-600">Waitlist Status</div>
                <Badge className="mt-1 bg-green-100 text-green-700">
                  {patient.waitlist_status?.replace(/_/g, ' ')}
                </Badge>
              </div>
              {patient.meld_score && (
                <div>
                  <div className="text-sm text-slate-600">MELD Score</div>
                  <div className="text-lg font-semibold text-slate-900">{patient.meld_score}</div>
                </div>
              )}
              {patient.las_score && (
                <div>
                  <div className="text-sm text-slate-600">LAS Score</div>
                  <div className="text-lg font-semibold text-slate-900">{patient.las_score}</div>
                </div>
              )}
            </div>

            {patient.diagnosis && (
              <div>
                <div className="text-sm font-medium text-slate-600 mb-1">Diagnosis</div>
                <div className="text-slate-900">{patient.diagnosis}</div>
              </div>
            )}

            {patient.notes && (
              <div>
                <div className="text-sm font-medium text-slate-600 mb-1">Clinical Notes</div>
                <div className="text-slate-900 bg-slate-50 p-3 rounded-lg">{patient.notes}</div>
              </div>
            )}

            {patient.document_urls && patient.document_urls.length > 0 && (
              <div>
                <div className="text-sm font-medium text-slate-600 mb-2">Attached Documents</div>
                <div className="space-y-2">
                  {patient.document_urls.map((url, index) => (
                    <a
                      key={index}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center space-x-2 text-cyan-600 hover:text-cyan-700"
                    >
                      <FileText className="w-4 h-4" />
                      <span>Document {index + 1}</span>
                      <Download className="w-3 h-3" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Documentation Status Section - Non-Clinical Operational Tracking */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Readiness Barriers Section (Non-Clinical) */}
          <ReadinessBarrierList 
            patientId={patient.id}
            patientName={`${patient.first_name} ${patient.last_name}`}
          />

          {/* aHHQ Status Section (Non-Clinical Documentation Tracking) */}
          <AHHQPanel 
            patientId={patient.id}
            patientName={`${patient.first_name} ${patient.last_name}`}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <PriorityBreakdown patient={patient} />
          </div>
          <div>
            <PatientSyncControls patient={patient} />
          </div>
        </div>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Activity Log</CardTitle>
          </CardHeader>
          <CardContent>
            {auditLogs.length === 0 ? (
              <p className="text-slate-500 text-center py-4">No activity recorded yet</p>
            ) : (
              <div className="space-y-3">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start space-x-3 pb-3 border-b border-slate-100 last:border-0">
                    <div className="flex-1">
                      <p className="text-sm text-slate-900">{log.details}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {format(new Date(log.created_at), 'MMM d, yyyy h:mm a')} by {log.user_email}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}