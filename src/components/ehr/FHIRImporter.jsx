import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileJson, CheckCircle, AlertCircle, Database } from 'lucide-react';
import { api } from '@/api/apiClient';

export default function FHIRImporter({ onImportComplete }) {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [autoCreate, setAutoCreate] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [sourceSystem, setSourceSystem] = useState('');

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleImport = async () => {
    if (!file) {
      alert('Please select a FHIR file');
      return;
    }

    setImporting(true);
    setResult(null);

    try {
      // Read file content
      const fileContent = await file.text();
      const fhirBundle = JSON.parse(fileContent);

      // Validate FHIR structure
      if (!fhirBundle.resourceType || fhirBundle.resourceType !== 'Bundle') {
        throw new Error('Invalid FHIR file. Expected a FHIR Bundle resource.');
      }

      // Call import function
      const response = await api.functions.invoke('importFHIRData', {
        fhir_bundle: fhirBundle,
        source_system: sourceSystem || 'Manual Upload',
        auto_create: autoCreate,
        auto_update: autoUpdate,
      });

      setResult(response.data.results);
      
      if (onImportComplete) {
        onImportComplete(response.data.results);
      }
    } catch (error) {
      setResult({
        processed: 0,
        created: 0,
        updated: 0,
        failed: 1,
        errors: [{ error: error.message }]
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-blue-600" />
            <span>FHIR Data Import</span>
          </CardTitle>
          <p className="text-sm text-slate-600 mt-2">
            Import patient data from FHIR R4 compliant EHR systems
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload FHIR Bundle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Source EHR System (Optional)</Label>
            <Input
              value={sourceSystem}
              onChange={(e) => setSourceSystem(e.target.value)}
              placeholder="e.g., Epic, Cerner, Meditech"
              className="mt-1"
            />
          </div>

          <div>
            <Label>Select FHIR JSON File</Label>
            <div className="mt-2">
              <input
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
                id="fhir-file-upload"
              />
              <label htmlFor="fhir-file-upload">
                <Button variant="outline" asChild className="w-full cursor-pointer">
                  <span>
                    <Upload className="w-4 h-4 mr-2" />
                    {file ? file.name : 'Choose FHIR Bundle File'}
                  </span>
                </Button>
              </label>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <Label>Automatically Create New Patients</Label>
                <p className="text-xs text-slate-500">Create records for patients not in system</p>
              </div>
              <Switch
                checked={autoCreate}
                onCheckedChange={setAutoCreate}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Automatically Update Existing Patients</Label>
                <p className="text-xs text-slate-500">Update records that already exist</p>
              </div>
              <Switch
                checked={autoUpdate}
                onCheckedChange={setAutoUpdate}
              />
            </div>
          </div>

          <Button
            onClick={handleImport}
            disabled={!file || importing}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            <FileJson className="w-4 h-4 mr-2" />
            {importing ? 'Importing...' : 'Import FHIR Data'}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className={`border-2 ${
          result.failed === 0 ? 'border-green-200 bg-green-50' : 
          result.created + result.updated > 0 ? 'border-amber-200 bg-amber-50' :
          'border-red-200 bg-red-50'
        }`}>
          <CardHeader>
            <CardTitle className="text-base flex items-center space-x-2">
              {result.failed === 0 ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-600" />
              )}
              <span>Import Results</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-900">{result.processed}</div>
                <div className="text-xs text-slate-600">Processed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{result.created}</div>
                <div className="text-xs text-slate-600">Created</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{result.updated}</div>
                <div className="text-xs text-slate-600">Updated</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{result.failed}</div>
                <div className="text-xs text-slate-600">Failed</div>
              </div>
            </div>

            {result.errors && result.errors.length > 0 && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-medium mb-2">Errors encountered:</div>
                  <ul className="text-xs space-y-1">
                    {result.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>
                        {err.patient_id}: {err.reason || err.error}
                      </li>
                    ))}
                    {result.errors.length > 5 && (
                      <li className="italic">... and {result.errors.length - 5} more</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-base">FHIR Resource Support</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-slate-600 space-y-2">
            <p><strong>Supported FHIR R4 Resources:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Patient - Demographics, identifiers, contact info</li>
              <li>Observation - Labs (blood type, HLA typing, MELD, weight, height)</li>
              <li>Condition - Diagnoses and comorbidities</li>
              <li>MedicationStatement - Current medications</li>
            </ul>
            <p className="mt-4"><strong>Required Data Mapping:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Patient.identifier → patient_id</li>
              <li>Patient.name → first_name, last_name</li>
              <li>Observation (LOINC 883-9) → blood_type</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Alert className="bg-blue-50 border-blue-200">
        <Database className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          <strong>HIPAA Compliance:</strong> All imported data is encrypted at rest and in transit. 
          Audit logs track all import activities. Ensure your EHR system is authorized to share 
          this data under applicable regulations.
        </AlertDescription>
      </Alert>
    </div>
  );
}