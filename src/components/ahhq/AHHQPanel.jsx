/**
 * AHHQPanel Component
 * 
 * Displays and manages Adult Health History Questionnaire (aHHQ) status
 * for a patient. Allows creating, updating, and completing aHHQ records.
 * 
 * IMPORTANT DISCLAIMER:
 * This component is for OPERATIONAL DOCUMENTATION tracking only.
 * It tracks whether required health history questionnaires are present,
 * complete, and current. It does NOT store medical narratives,
 * clinical interpretations, or eligibility determinations.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  FileText, 
  Plus, 
  Edit2, 
  Check, 
  AlertTriangle,
  Calendar,
  User,
  Clock,
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AHHQStatusBadge, AHHQExpirationBadge } from './AHHQStatusBadge';
import AHHQForm from './AHHQForm';

const api = window.electronAPI || {};

export default function AHHQPanel({ patientId, patientName }) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Fetch aHHQ for patient
  const { data: ahhq, isLoading, error } = useQuery({
    queryKey: ['ahhq', patientId],
    queryFn: async () => {
      if (api.ahhq) {
        return await api.ahhq.getByPatient(patientId);
      }
      return null;
    },
    enabled: !!patientId,
  });

  // Fetch aHHQ summary
  const { data: summary } = useQuery({
    queryKey: ['ahhqSummary', patientId],
    queryFn: async () => {
      if (api.ahhq) {
        return await api.ahhq.getPatientSummary(patientId);
      }
      return null;
    },
    enabled: !!patientId,
  });

  // Fetch constants
  const { data: statuses } = useQuery({
    queryKey: ['ahhqStatuses'],
    queryFn: async () => api.ahhq?.getStatuses(),
  });

  const { data: issues } = useQuery({
    queryKey: ['ahhqIssues'],
    queryFn: async () => api.ahhq?.getIssues(),
  });

  const { data: owningRoles } = useQuery({
    queryKey: ['ahhqOwningRoles'],
    queryFn: async () => api.ahhq?.getOwningRoles(),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data) => {
      return await api.ahhq.create({ ...data, patient_id: patientId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['ahhq', patientId]);
      queryClient.invalidateQueries(['ahhqSummary', patientId]);
      queryClient.invalidateQueries(['riskDashboard']);
      setIsCreating(false);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await api.ahhq.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['ahhq', patientId]);
      queryClient.invalidateQueries(['ahhqSummary', patientId]);
      queryClient.invalidateQueries(['riskDashboard']);
      setIsEditing(false);
    },
  });

  // Mark complete mutation
  const completeMutation = useMutation({
    mutationFn: async (id) => {
      return await api.ahhq.markComplete(id, new Date().toISOString());
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['ahhq', patientId]);
      queryClient.invalidateQueries(['ahhqSummary', patientId]);
      queryClient.invalidateQueries(['riskDashboard']);
    },
  });

  const handleCreate = (data) => {
    createMutation.mutate(data);
  };

  const handleUpdate = (data) => {
    updateMutation.mutate({ id: ahhq.id, data });
  };

  const handleMarkComplete = () => {
    if (ahhq?.id) {
      completeMutation.mutate(ahhq.id);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-slate-200 rounded w-1/3"></div>
            <div className="h-4 bg-slate-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Creating new aHHQ
  if (isCreating) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="w-5 h-5 text-cyan-600" />
            Create aHHQ Record
          </CardTitle>
          <CardDescription>
            Track health history questionnaire documentation status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4 bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-700 text-xs">
              <strong>Non-Clinical Notice:</strong> This tracks whether the aHHQ documentation 
              is present, complete, and current. It does NOT store medical information.
            </AlertDescription>
          </Alert>
          <AHHQForm
            statuses={statuses}
            issues={issues}
            owningRoles={owningRoles}
            onSave={handleCreate}
            onCancel={() => setIsCreating(false)}
            isLoading={createMutation.isPending}
          />
        </CardContent>
      </Card>
    );
  }

  // Editing existing aHHQ
  if (isEditing && ahhq) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="w-5 h-5 text-cyan-600" />
            Update aHHQ Record
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4 bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-700 text-xs">
              <strong>Non-Clinical Notice:</strong> This tracks whether the aHHQ documentation 
              is present, complete, and current. It does NOT store medical information.
            </AlertDescription>
          </Alert>
          <AHHQForm
            ahhq={ahhq}
            statuses={statuses}
            issues={issues}
            owningRoles={owningRoles}
            onSave={handleUpdate}
            onCancel={() => setIsEditing(false)}
            isLoading={updateMutation.isPending}
          />
        </CardContent>
      </Card>
    );
  }

  // No aHHQ record exists
  if (!ahhq) {
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="w-5 h-5 text-amber-600" />
            aHHQ Status
            <Badge variant="outline" className="ml-2 bg-amber-100 text-amber-800 border-amber-300">
              Not on File
            </Badge>
          </CardTitle>
          <CardDescription>
            No health history questionnaire record found for this patient
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4 bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-700 text-xs">
              <strong>Non-Clinical Notice:</strong> aHHQ tracking is for operational documentation 
              purposes only. It tracks whether required questionnaires are present and current.
            </AlertDescription>
          </Alert>
          <Button onClick={() => setIsCreating(true)} className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            Create aHHQ Record
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Display existing aHHQ
  const getOwningRoleLabel = (role) => {
    return owningRoles?.[role.toUpperCase()]?.label || role;
  };

  return (
    <Card className={summary?.needsAttention ? 'border-amber-200' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="w-5 h-5 text-cyan-600" />
            aHHQ Status
          </CardTitle>
          <div className="flex items-center gap-2">
            <AHHQStatusBadge status={ahhq.status} size="small" />
            {ahhq.expiration_date && (
              <AHHQExpirationBadge 
                daysUntilExpiration={ahhq.days_until_expiration}
                isExpired={ahhq.is_expired}
                isExpiringSoon={ahhq.is_expiring_soon}
                size="small"
              />
            )}
          </div>
        </div>
        {summary?.riskDescription && (
          <CardDescription className={summary.needsAttention ? 'text-amber-600' : 'text-green-600'}>
            {summary.riskDescription}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick info */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <div>
              <div className="text-slate-500 text-xs">Last Completed</div>
              <div className="font-medium">
                {ahhq.last_completed_date 
                  ? new Date(ahhq.last_completed_date).toLocaleDateString()
                  : 'Not completed'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <div>
              <div className="text-slate-500 text-xs">Expires</div>
              <div className="font-medium">
                {ahhq.expiration_date 
                  ? new Date(ahhq.expiration_date).toLocaleDateString()
                  : 'N/A'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-slate-400" />
            <div>
              <div className="text-slate-500 text-xs">Owning Role</div>
              <div className="font-medium">{getOwningRoleLabel(ahhq.owning_role)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <div>
              <div className="text-slate-500 text-xs">Validity Period</div>
              <div className="font-medium">{ahhq.validity_period_days} days</div>
            </div>
          </div>
        </div>

        {/* Identified issues */}
        {ahhq.identified_issues && ahhq.identified_issues.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-slate-700">Identified Issues</div>
            <div className="flex flex-wrap gap-2">
              {ahhq.identified_issues.map((issue, idx) => (
                <Badge key={idx} variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {issues?.[issue]?.label || issue}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {ahhq.notes && (
          <Collapsible open={showDetails} onOpenChange={setShowDetails}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="text-slate-600 text-xs">Notes</span>
                {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-600">
                {ahhq.notes}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <Separator />

        {/* Actions */}
        <div className="flex gap-2">
          {ahhq.status !== 'complete' && (
            <Button 
              size="sm" 
              onClick={handleMarkComplete}
              disabled={completeMutation.isPending}
              className="flex-1"
            >
              <Check className="w-4 h-4 mr-2" />
              Mark Complete
            </Button>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsEditing(true)}
            className="flex-1"
          >
            <Edit2 className="w-4 h-4 mr-2" />
            Update
          </Button>
        </div>

        {/* Non-clinical notice */}
        <div className="text-xs text-slate-400 text-center pt-2">
          Operational documentation tracking only • Non-clinical
        </div>
      </CardContent>
    </Card>
  );
}
