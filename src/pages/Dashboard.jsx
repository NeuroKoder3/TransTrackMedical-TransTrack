import React, { useState, useEffect } from 'react';
import { api } from '@/api/apiClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, Activity, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import FilterBar from '../components/waitlist/FilterBar';
import PatientCard from '../components/patients/PatientCard';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const [filters, setFilters] = useState({
    search: '',
    organ: 'all',
    bloodType: 'all',
    status: 'active',
    priority: 'all',
  });

  const [calculating, setCalculating] = useState(false);

  const { data: patients = [], isLoading, refetch } = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.entities.Patient.list('-priority_score', 500),
  });

  const handleResetFilters = () => {
    setFilters({
      search: '',
      organ: 'all',
      bloodType: 'all',
      status: 'active',
      priority: 'all',
    });
  };

  const handleRecalculatePriorities = async () => {
    setCalculating(true);
    try {
      const activePatients = patients.filter(p => p.waitlist_status === 'active');
      
      for (const patient of activePatients) {
        await api.functions.invoke('calculatePriorityAdvanced', { patient_id: patient.id });
      }
      
      await refetch();
    } catch (error) {
      console.error('Priority calculation error:', error);
    } finally {
      setCalculating(false);
    }
  };

  const filteredPatients = patients.filter(patient => {
    if (filters.search) {
      const search = filters.search.toLowerCase();
      const matchesSearch = 
        patient.first_name?.toLowerCase().includes(search) ||
        patient.last_name?.toLowerCase().includes(search) ||
        patient.patient_id?.toLowerCase().includes(search);
      if (!matchesSearch) return false;
    }

    if (filters.organ !== 'all' && patient.organ_needed !== filters.organ) return false;
    if (filters.bloodType !== 'all' && patient.blood_type !== filters.bloodType) return false;
    if (filters.status !== 'all' && patient.waitlist_status !== filters.status) return false;
    
    if (filters.priority !== 'all') {
      const score = patient.priority_score || 0;
      if (filters.priority === 'critical' && score < 80) return false;
      if (filters.priority === 'high' && (score < 60 || score >= 80)) return false;
      if (filters.priority === 'medium' && (score < 40 || score >= 60)) return false;
      if (filters.priority === 'low' && score >= 40) return false;
    }

    return true;
  });

  const stats = {
    total: patients.length,
    active: patients.filter(p => p.waitlist_status === 'active').length,
    critical: patients.filter(p => (p.priority_score || 0) >= 80).length,
    transplanted: patients.filter(p => p.waitlist_status === 'transplanted').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Waitlist Dashboard</h1>
            <p className="text-slate-600 mt-1">Real-time transplant prioritization</p>
          </div>
          <Button
            onClick={handleRecalculatePriorities}
            disabled={calculating}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${calculating ? 'animate-spin' : ''}`} />
            {calculating ? 'Recalculating...' : 'Recalculate Priorities'}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center">
                <Users className="w-4 h-4 mr-2" />
                Total Patients
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{stats.total}</div>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-green-700 flex items-center">
                <Activity className="w-4 h-4 mr-2" />
                Active on List
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-900">{stats.active}</div>
            </CardContent>
          </Card>

          <Card className="border-red-200 bg-red-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-red-700 flex items-center">
                <AlertCircle className="w-4 h-4 mr-2" />
                Critical Priority
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-900">{stats.critical}</div>
            </CardContent>
          </Card>

          <Card className="border-blue-200 bg-blue-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-blue-700 flex items-center">
                <CheckCircle className="w-4 h-4 mr-2" />
                Transplanted
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-900">{stats.transplanted}</div>
            </CardContent>
          </Card>
        </div>

        <FilterBar
          filters={filters}
          setFilters={setFilters}
          onReset={handleResetFilters}
        />

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-600" />
          </div>
        ) : filteredPatients.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="w-16 h-16 text-slate-300 mb-4" />
              <p className="text-slate-600 text-lg">No patients match the current filters</p>
            </CardContent>
          </Card>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-slate-600">
                Showing {filteredPatients.length} patient{filteredPatients.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPatients.map((patient, index) => (
                <motion.div
                  key={patient.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <PatientCard patient={patient} />
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}