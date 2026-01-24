import React, { useState } from 'react';
import { api } from '@/api/apiClient';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileDown, FileText, Table } from 'lucide-react';
import FilterBar from '../components/waitlist/FilterBar';

export default function Reports() {
  const [filters, setFilters] = useState({
    search: '',
    organ: 'all',
    bloodType: 'all',
    status: 'active',
    priority: 'all',
  });
  const [exportFormat, setExportFormat] = useState('pdf');
  const [exporting, setExporting] = useState(false);

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.entities.Patient.list('-priority_score', 1000),
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

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await api.functions.invoke('exportWaitlist', {
        filters,
        format: exportFormat,
      });

      const blob = new Blob([response.data], {
        type: exportFormat === 'pdf' ? 'application/pdf' : 'text/csv',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `waitlist-export-${new Date().toISOString().split('T')[0]}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Export error:', error);
    } finally {
      setExporting(false);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Reports & Export</h1>
          <p className="text-slate-600 mt-1">Generate and download waitlist reports</p>
        </div>

        <FilterBar
          filters={filters}
          setFilters={setFilters}
          onReset={handleResetFilters}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base">Export Format</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">
                    <div className="flex items-center">
                      <FileText className="w-4 h-4 mr-2" />
                      PDF Report
                    </div>
                  </SelectItem>
                  <SelectItem value="csv">
                    <div className="flex items-center">
                      <Table className="w-4 h-4 mr-2" />
                      CSV Spreadsheet
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base">Patients Included</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-600">{filteredPatients.length}</div>
              <p className="text-sm text-slate-600 mt-1">Based on current filters</p>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base">Export Action</CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleExport}
                disabled={exporting || filteredPatients.length === 0}
                className="w-full bg-cyan-600 hover:bg-cyan-700"
              >
                <FileDown className="w-4 h-4 mr-2" />
                {exporting ? 'Generating...' : `Export ${exportFormat.toUpperCase()}`}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Export Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-slate-700 mb-2">Report Contents:</h3>
                <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
                  <li>Patient identification (ID, Name)</li>
                  <li>Blood type and organ needed</li>
                  <li>Priority scores and medical urgency</li>
                  <li>Waitlist status and duration</li>
                  <li>Last evaluation dates</li>
                  {exportFormat === 'pdf' && <li>Visual priority indicators</li>}
                </ul>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-900">
                  <strong>Privacy Notice:</strong> Exported reports contain protected health information (PHI). 
                  Handle according to HIPAA regulations and your facility's data security policies.
                </p>
              </div>

              {filteredPatients.length === 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <p className="text-sm text-slate-600 text-center">
                    No patients match the current filters. Adjust filters to include patients in the export.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}