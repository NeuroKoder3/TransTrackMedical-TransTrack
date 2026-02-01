/**
 * LabsPanel Component
 * 
 * Displays lab results for a patient with documentation status tracking.
 * 
 * IMPORTANT DISCLAIMER:
 * This feature is strictly NON-CLINICAL and NON-ALLOCATIVE.
 * Lab results are stored for DOCUMENTATION COMPLETENESS purposes only.
 * The system does NOT:
 * - Interpret lab values as normal/abnormal
 * - Provide clinical recommendations
 * - Make allocation-related decisions
 * - Display color-coded "bad" values
 * 
 * The only signals provided are OPERATIONAL/DOCUMENTATION signals:
 * - Lab is MISSING (required lab not documented)
 * - Lab is EXPIRED (lab exceeds configured max age)
 * - Lab is CURRENT (lab within acceptable documentation window)
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { 
  FlaskConical, 
  Plus, 
  Edit2, 
  Trash2,
  Clock,
  Calendar,
  Info,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertTriangle,
  FileX,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { LabDocStatusBadge, LabSourceBadge, LabCountBadge } from './LabStatusBadge';
import LabForm from './LabForm';
import api from '@/api/localClient';

export default function LabsPanel({ 
  patientId, 
  patientName,
  showAddButton = true,
}) {
  const queryClient = useQueryClient();
  
  const [showForm, setShowForm] = useState(false);
  const [editingLab, setEditingLab] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filterTest, setFilterTest] = useState('all');
  const [showHistory, setShowHistory] = useState(false);
  
  // Fetch labs for patient
  const { data: labs = [], isLoading, error } = useQuery({
    queryKey: ['labs', patientId],
    queryFn: () => api.labs.getByPatient(patientId),
    enabled: !!patientId,
  });
  
  // Fetch lab status (documentation signals only)
  const { data: labStatus } = useQuery({
    queryKey: ['labStatus', patientId],
    queryFn: () => api.labs.getPatientStatus(patientId),
    enabled: !!patientId,
  });
  
  // Create lab mutation
  const createMutation = useMutation({
    mutationFn: (data) => api.labs.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['labs', patientId]);
      queryClient.invalidateQueries(['labStatus', patientId]);
      setShowForm(false);
    },
  });
  
  // Update lab mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.labs.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['labs', patientId]);
      queryClient.invalidateQueries(['labStatus', patientId]);
      setEditingLab(null);
    },
  });
  
  // Delete lab mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => api.labs.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['labs', patientId]);
      queryClient.invalidateQueries(['labStatus', patientId]);
      setDeleteConfirm(null);
    },
  });
  
  const handleSave = async (data) => {
    if (editingLab) {
      await updateMutation.mutateAsync({ id: editingLab.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };
  
  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return format(new Date(dateStr), 'MMM d, yyyy');
    } catch {
      return dateStr;
    }
  };
  
  // Get unique test types for filter
  const testTypes = [...new Set(labs.map(l => l.test_code))].sort();
  
  // Filter labs by test type
  const filteredLabs = filterTest === 'all' 
    ? labs 
    : labs.filter(l => l.test_code === filterTest);
  
  // Group labs by test code and get latest for each
  const latestByTest = {};
  const historyByTest = {};
  
  for (const lab of labs) {
    if (!latestByTest[lab.test_code]) {
      latestByTest[lab.test_code] = lab;
      historyByTest[lab.test_code] = [];
    } else {
      historyByTest[lab.test_code].push(lab);
    }
  }
  
  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-500">
          Loading labs...
        </CardContent>
      </Card>
    );
  }
  
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Error loading labs: {error.message}</AlertDescription>
      </Alert>
    );
  }
  
  // Show form if adding or editing
  if (showForm || editingLab) {
    return (
      <LabForm
        patientId={patientId}
        lab={editingLab}
        onSave={handleSave}
        onCancel={() => {
          setShowForm(false);
          setEditingLab(null);
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
              <FlaskConical className="w-5 h-5 text-cyan-600" />
              Lab Results
            </CardTitle>
            {labStatus && (
              <LabCountBadge 
                current={labStatus.current || 0}
                expired={labStatus.expired || 0}
                missing={labStatus.missing || 0}
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
              Add Lab
            </Button>
          )}
        </div>
        <CardDescription className="text-xs">
          Documentation tracking only. Values are not clinically interpreted.
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        {/* Non-clinical disclaimer */}
        <Alert className="mb-4 bg-slate-50 border-slate-200">
          <Info className="h-4 w-4 text-slate-600" />
          <AlertDescription className="text-slate-600 text-xs">
            Lab results are stored for documentation completeness only. The system does NOT 
            interpret values, color-code abnormal results, or provide clinical recommendations.
          </AlertDescription>
        </Alert>
        
        {/* Documentation Status Summary */}
        {labStatus && (labStatus.missing > 0 || labStatus.expired > 0) && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">Documentation Gaps</p>
                <div className="mt-1 space-y-1">
                  {labStatus.missing > 0 && (
                    <p className="text-xs text-amber-700">
                      {labStatus.missing} required lab(s) not documented
                    </p>
                  )}
                  {labStatus.expired > 0 && (
                    <p className="text-xs text-amber-700">
                      {labStatus.expired} lab(s) exceed max age threshold
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Missing Labs List */}
        {labStatus?.missingLabs?.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-medium text-slate-700 mb-2">Missing Required Labs</p>
            <div className="flex flex-wrap gap-2">
              {labStatus.missingLabs.map((missing, idx) => (
                <Badge 
                  key={idx} 
                  variant="outline" 
                  className="bg-red-50 text-red-700 border-red-200"
                >
                  <FileX className="w-3 h-3 mr-1" />
                  {missing.test_name}
                </Badge>
              ))}
            </div>
          </div>
        )}
        
        {/* Filter */}
        {testTypes.length > 1 && (
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-slate-500" />
            <Select value={filterTest} onValueChange={setFilterTest}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by test" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tests</SelectItem>
                {testTypes.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        
        {/* Labs List */}
        {Object.keys(latestByTest).length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <FlaskConical className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p className="font-medium">No lab results recorded</p>
            <p className="text-sm">Add lab results to track documentation completeness</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {Object.entries(latestByTest)
                .filter(([code]) => filterTest === 'all' || code === filterTest)
                .map(([testCode, lab]) => {
                  const history = historyByTest[testCode] || [];
                  const statusInfo = labStatus?.labs?.find(l => l.test_code === testCode);
                  const isExpired = statusInfo?.status === 'EXPIRED';
                  
                  return (
                    <motion.div
                      key={testCode}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className={`border rounded-lg p-4 ${
                        isExpired ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* Header */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-slate-900">
                              {lab.test_name}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {lab.test_code}
                            </Badge>
                            {statusInfo && (
                              <LabDocStatusBadge status={statusInfo.status} size="sm" />
                            )}
                            <LabSourceBadge source={lab.source} size="sm" />
                          </div>
                          
                          {/* Value Display */}
                          <div className="flex items-baseline gap-2 mb-2">
                            <span className="text-2xl font-semibold text-slate-900">
                              {lab.value}
                            </span>
                            {lab.units && (
                              <span className="text-sm text-slate-500">{lab.units}</span>
                            )}
                            {lab.reference_range && (
                              <span className="text-xs text-slate-400">
                                (ref: {lab.reference_range})
                              </span>
                            )}
                          </div>
                          
                          {/* Dates */}
                          <div className="flex items-center gap-4 text-sm text-slate-600">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              <span>Collected: {formatDate(lab.collected_at)}</span>
                            </div>
                            {lab.resulted_at && (
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>Resulted: {formatDate(lab.resulted_at)}</span>
                              </div>
                            )}
                          </div>
                          
                          {/* Expiration Message */}
                          {statusInfo?.message && (
                            <p className="mt-2 text-xs text-amber-600">
                              {statusInfo.message}
                            </p>
                          )}
                          
                          {/* History */}
                          {history.length > 0 && (
                            <Collapsible 
                              open={showHistory}
                              onOpenChange={setShowHistory}
                            >
                              <CollapsibleTrigger className="flex items-center gap-1 text-sm text-slate-500 mt-3 hover:text-slate-700">
                                {showHistory ? (
                                  <ChevronUp className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                                <span>{history.length} previous result(s)</span>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="mt-2 pl-4 border-l-2 border-slate-200 space-y-2">
                                  {history.slice(0, 5).map((hist) => (
                                    <div key={hist.id} className="text-sm text-slate-600">
                                      <span className="font-medium">{hist.value}</span>
                                      {hist.units && <span> {hist.units}</span>}
                                      <span className="text-slate-400 ml-2">
                                        {formatDate(hist.collected_at)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                        </div>
                        
                        {/* Actions */}
                        <div className="flex items-center gap-1 ml-4">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingLab(lab)}
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteConfirm(lab)}
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
            </AnimatePresence>
          </div>
        )}
        
        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Lab Result</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this lab result? This action cannot be undone.
                The deletion will be recorded in the audit log.
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
