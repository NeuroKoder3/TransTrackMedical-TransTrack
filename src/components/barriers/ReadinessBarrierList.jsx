/**
 * ReadinessBarrierList Component
 * 
 * Displays a list of readiness barriers for a patient with actions.
 * 
 * IMPORTANT DISCLAIMER:
 * Readiness barriers are NON-CLINICAL, NON-ALLOCATIVE, and designed for
 * operational workflow visibility only. They do NOT perform allocation decisions,
 * listing authority functions, or replace UNOS/OPTN systems.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AlertTriangle, 
  Plus, 
  Edit2, 
  CheckCircle, 
  Trash2, 
  Clock,
  Calendar,
  User,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BarrierStatusBadge, BarrierRiskBadge, BarrierCountBadge } from './BarrierStatusBadge';
import ReadinessBarrierForm from './ReadinessBarrierForm';
import api from '@/api/localClient';

export default function ReadinessBarrierList({ 
  patientId, 
  patientName,
  showAddButton = true,
  compact = false,
}) {
  const queryClient = useQueryClient();
  
  const [showForm, setShowForm] = useState(false);
  const [editingBarrier, setEditingBarrier] = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  
  // Fetch barrier types for labels
  const { data: barrierTypes = {} } = useQuery({
    queryKey: ['barrierTypes'],
    queryFn: () => api.barriers.getTypes(),
  });
  
  const { data: owningRoles = {} } = useQuery({
    queryKey: ['barrierOwningRoles'],
    queryFn: () => api.barriers.getOwningRoles(),
  });
  
  // Fetch barriers
  const { data: barriers = [], isLoading, error } = useQuery({
    queryKey: ['barriers', patientId, showResolved],
    queryFn: () => api.barriers.getByPatient(patientId, showResolved),
    enabled: !!patientId,
  });
  
  // Fetch summary
  const { data: summary } = useQuery({
    queryKey: ['barrierSummary', patientId],
    queryFn: () => api.barriers.getPatientSummary(patientId),
    enabled: !!patientId,
  });
  
  // Create barrier mutation
  const createMutation = useMutation({
    mutationFn: (data) => api.barriers.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['barriers', patientId]);
      queryClient.invalidateQueries(['barrierSummary', patientId]);
      setShowForm(false);
    },
  });
  
  // Update barrier mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.barriers.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['barriers', patientId]);
      queryClient.invalidateQueries(['barrierSummary', patientId]);
      setEditingBarrier(null);
    },
  });
  
  // Resolve barrier mutation
  const resolveMutation = useMutation({
    mutationFn: (id) => api.barriers.resolve(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['barriers', patientId]);
      queryClient.invalidateQueries(['barrierSummary', patientId]);
    },
  });
  
  // Delete barrier mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => api.barriers.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['barriers', patientId]);
      queryClient.invalidateQueries(['barrierSummary', patientId]);
      setDeleteConfirm(null);
    },
  });
  
  const handleSave = async (data) => {
    if (editingBarrier) {
      await updateMutation.mutateAsync({ id: editingBarrier.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };
  
  const getBarrierTypeLabel = (type) => {
    return barrierTypes[type]?.label || type;
  };
  
  const getOwningRoleLabel = (role) => {
    const roleKey = Object.keys(owningRoles).find(
      k => owningRoles[k].value === role
    );
    return roleKey ? owningRoles[roleKey].label : role;
  };
  
  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString();
  };
  
  const isOverdue = (barrier) => {
    if (!barrier.target_resolution_date || barrier.status === 'resolved') return false;
    return new Date(barrier.target_resolution_date) < new Date();
  };
  
  // Separate active and resolved barriers
  const activeBarriers = barriers.filter(b => b.status !== 'resolved');
  const resolvedBarriers = barriers.filter(b => b.status === 'resolved');
  
  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-500">
          Loading barriers...
        </CardContent>
      </Card>
    );
  }
  
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Error loading barriers: {error.message}</AlertDescription>
      </Alert>
    );
  }
  
  // Show form if adding or editing
  if (showForm || editingBarrier) {
    return (
      <ReadinessBarrierForm
        patientId={patientId}
        barrier={editingBarrier}
        onSave={handleSave}
        onCancel={() => {
          setShowForm(false);
          setEditingBarrier(null);
        }}
      />
    );
  }
  
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Readiness Barriers
            </CardTitle>
            {summary && (
              <BarrierCountBadge 
                count={summary.totalOpen} 
                highRiskCount={summary.byRiskLevel?.high || 0}
                size="sm"
              />
            )}
          </div>
          {showAddButton && (
            <Button 
              size="sm" 
              onClick={() => setShowForm(true)}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Barrier
            </Button>
          )}
        </div>
        <CardDescription className="text-xs">
          Non-clinical operational tracking only. Does not affect allocation.
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        {/* Non-clinical disclaimer */}
        <Alert className="mb-4 bg-slate-50 border-slate-200">
          <Info className="h-4 w-4 text-slate-600" />
          <AlertDescription className="text-slate-600 text-xs">
            This feature tracks operational workflow items only. It is non-clinical, 
            non-allocative, and does not replace UNOS/OPTN systems.
          </AlertDescription>
        </Alert>
        
        {/* Active Barriers */}
        {activeBarriers.length === 0 ? (
          <div className="text-center py-6 text-slate-500">
            <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-400" />
            <p className="font-medium">No open readiness barriers</p>
            <p className="text-sm">Patient has no pending operational barriers</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {activeBarriers.map((barrier) => (
                <motion.div
                  key={barrier.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`border rounded-lg p-4 ${
                    isOverdue(barrier) ? 'border-red-300 bg-red-50' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium">
                          {getBarrierTypeLabel(barrier.barrier_type)}
                        </span>
                        <BarrierStatusBadge status={barrier.status} size="sm" />
                        <BarrierRiskBadge riskLevel={barrier.risk_level} size="sm" />
                        {isOverdue(barrier) && (
                          <span className="text-xs text-red-600 font-medium">OVERDUE</span>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-slate-600">
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          <span>{getOwningRoleLabel(barrier.owning_role)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>Added: {formatDate(barrier.identified_date)}</span>
                        </div>
                        {barrier.target_resolution_date && (
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            <span>Target: {formatDate(barrier.target_resolution_date)}</span>
                          </div>
                        )}
                      </div>
                      
                      {barrier.notes && (
                        <Collapsible open={expandedId === barrier.id} onOpenChange={() => 
                          setExpandedId(expandedId === barrier.id ? null : barrier.id)
                        }>
                          <CollapsibleTrigger className="flex items-center gap-1 text-sm text-slate-500 mt-2 hover:text-slate-700">
                            {expandedId === barrier.id ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                            <span>Notes</span>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <p className="text-sm text-slate-600 mt-2 p-2 bg-slate-50 rounded">
                              {barrier.notes}
                            </p>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-1 ml-4">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingBarrier(barrier)}
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-green-600 hover:text-green-700 hover:bg-green-50"
                        onClick={() => resolveMutation.mutate(barrier.id)}
                        disabled={resolveMutation.isPending}
                        title="Mark Resolved"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
        
        {/* Resolved Barriers Toggle */}
        {(resolvedBarriers.length > 0 || showResolved) && (
          <div className="mt-4 pt-4 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowResolved(!showResolved)}
              className="text-slate-600"
            >
              {showResolved ? (
                <>
                  <ChevronUp className="w-4 h-4 mr-1" />
                  Hide Resolved ({resolvedBarriers.length})
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4 mr-1" />
                  Show Resolved ({resolvedBarriers.length})
                </>
              )}
            </Button>
            
            {showResolved && resolvedBarriers.length > 0 && (
              <div className="mt-3 space-y-2">
                {resolvedBarriers.map((barrier) => (
                  <div 
                    key={barrier.id}
                    className="border border-slate-100 bg-slate-50 rounded-lg p-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600">
                          {getBarrierTypeLabel(barrier.barrier_type)}
                        </span>
                        <BarrierStatusBadge status="resolved" size="sm" />
                      </div>
                      <span className="text-xs text-slate-500">
                        Resolved: {formatDate(barrier.resolved_date)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Barrier</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this barrier? Consider marking it as resolved instead 
                for audit trail purposes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700"
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
