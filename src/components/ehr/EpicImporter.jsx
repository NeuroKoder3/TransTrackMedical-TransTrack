import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  CloudDownload,
  CheckCircle,
  AlertCircle,
  Activity,
  Pill,
  ShieldAlert,
  ClipboardList,
  Loader2,
} from 'lucide-react';
import { api, apiMode } from '@/api/apiClient';

const DEFAULT_TEST_PATIENT = 'erXuFYUfucBZaryVksYEcMg3'; // Camila Maria Lopez

/**
 * Epic on FHIR — "Import from Epic" panel.
 *
 * Verified end-to-end against Epic's developer sandbox via SMART Backend
 * Services (JWT-bearer assertion). Pulls demographics + labs + problems +
 * medications + allergies for one Epic Patient ID and persists them as a
 * native TransTrack patient row plus FHIR resources (org-scoped).
 */
export default function EpicImporter({ onImportComplete }) {
  const [patientId, setPatientId] = useState(DEFAULT_TEST_PATIENT);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.integrations.epic.status();
        if (!cancelled) setStatus(s);
      } catch (e) {
        if (!cancelled) setStatusError(e.message || 'Failed to load status');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.integrations.epic.import({
        epicPatientId: patientId.trim(),
      });
      setResult(r);
      if (onImportComplete) onImportComplete(r);
    } catch (e) {
      setError(e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const enabled = status?.enabled === true;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CloudDownload className="w-5 h-5 text-blue-600" />
              Import from Epic on FHIR
            </span>
            <div className="flex items-center gap-2">
              {apiMode === 'remote' && status && (
                <Badge
                  variant={enabled ? 'default' : 'outline'}
                  className={
                    enabled
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'border-amber-300 text-amber-700 bg-amber-50'
                  }
                >
                  {enabled ? 'Server-fetch enabled' : 'Server-fetch not configured'}
                </Badge>
              )}
              {apiMode === 'local' && (
                <Badge variant="outline" className="border-slate-300 text-slate-700">
                  Local mode
                </Badge>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-700">
          <p>
            Pull a patient straight from Epic's FHIR API into TransTrack. Uses
            SMART on FHIR <strong>Backend Services</strong> (RS384 JWT-bearer
            assertion against Epic's token endpoint). On success the patient
            appears as a native TransTrack record and their lab observations,
            problem-list conditions, medication requests, and allergies are
            stored as FHIR R4 resources scoped to your organisation.
          </p>

          {apiMode === 'local' && (
            <Alert className="bg-slate-50 border-slate-200">
              <AlertCircle className="w-4 h-4 text-slate-500" />
              <AlertDescription>
                Epic on FHIR import requires the API server. Configure
                {' '}<code>VITE_TRANSTRACK_API_URL</code> at build time, or{' '}
                <code>window.transtrackConfig.apiBaseUrl</code> at runtime, to
                enable this panel.
              </AlertDescription>
            </Alert>
          )}

          {statusError && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{statusError}</AlertDescription>
            </Alert>
          )}

          {apiMode === 'remote' && status && !enabled && (
            <Alert className="bg-amber-50 border-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-900">
                The server has no Epic credentials configured. Set{' '}
                <code>EPIC_SANDBOX_CLIENT_ID</code> and{' '}
                <code>EPIC_PRIVATE_KEY_FILE</code> in the server environment, or
                paste a pre-fetched bundle via the API to import without
                server-side credentials.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <Label htmlFor="epic-patient-id">Epic Patient ID</Label>
              <Input
                id="epic-patient-id"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="erXuFYUfucBZaryVksYEcMg3"
                disabled={importing || !enabled}
              />
              <p className="mt-1 text-xs text-slate-500">
                Default is Epic's sandbox test patient{' '}
                <em>Camila Maria Lopez</em>.
              </p>
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleImport}
                disabled={importing || !enabled || !patientId.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <CloudDownload className="w-4 h-4 mr-2" />
                    Import from Epic
                  </>
                )}
              </Button>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                <strong>Import failed:</strong> {error}
              </AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert className="bg-emerald-50 border-emerald-200">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <AlertDescription>
                <div className="space-y-2 text-emerald-900">
                  <div>
                    <strong>
                      {result.created ? 'Created' : 'Updated'}{' '}
                      TransTrack patient
                    </strong>{' '}
                    {result.patient?.last_name}, {result.patient?.first_name}{' '}
                    <span className="text-emerald-700">
                      (MRN {result.patient?.mrn} / id{' '}
                      <code>{result.patient?.id}</code>)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <ResultStat
                      icon={<Activity className="w-3.5 h-3.5" />}
                      label="Lab observations"
                      value={result.stored?.observations}
                    />
                    <ResultStat
                      icon={<ClipboardList className="w-3.5 h-3.5" />}
                      label="Problems"
                      value={result.stored?.conditions}
                    />
                    <ResultStat
                      icon={<Pill className="w-3.5 h-3.5" />}
                      label="Medication requests"
                      value={result.stored?.medicationRequests}
                    />
                    <ResultStat
                      icon={<ShieldAlert className="w-3.5 h-3.5" />}
                      label="Allergies"
                      value={result.stored?.allergies}
                    />
                  </div>
                  {result.scopeGranted && (
                    <div className="text-xs text-emerald-700">
                      <strong>Granted scope:</strong>{' '}
                      <code className="break-all">{result.scopeGranted}</code>
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <ol className="list-decimal list-inside space-y-1">
            <li>
              The TransTrack server signs an RS384 JWT assertion using its Epic
              private key (public half registered as a JWKS in Epic's developer
              portal).
            </li>
            <li>
              The assertion is exchanged for a SMART Backend Services access
              token at Epic's <code>/oauth2/token</code> endpoint (grant{' '}
              <code>client_credentials</code>, system-level scopes).
            </li>
            <li>
              TransTrack pulls the Epic FHIR{' '}
              <code>Patient</code>, <code>Observation</code> (laboratory),{' '}
              <code>Condition</code> (problem-list-item),{' '}
              <code>MedicationRequest</code>, and{' '}
              <code>AllergyIntolerance</code> resources for the requested
              Patient ID.
            </li>
            <li>
              The Patient is upserted into the native{' '}
              <code>patients</code> table (keyed on MRN within your org); the
              FHIR resources are stored in <code>fhir_resources</code>{' '}
              namespaced as <code>epic-&lt;id&gt;</code>; one audit log entry
              records the import.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function ResultStat({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2 bg-white/60 border border-emerald-200 rounded px-2 py-1">
      <span className="text-emerald-600">{icon}</span>
      <span className="text-emerald-900">
        <strong>{value ?? 0}</strong>{' '}
        <span className="text-emerald-700">{label}</span>
      </span>
    </div>
  );
}
