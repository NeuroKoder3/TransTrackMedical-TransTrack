-- =============================================================================
-- 007_clinical_detail.sql
-- Native relational tables for patient conditions, medications, and allergies.
--
-- Prior to this migration these resource types were imported from Epic and
-- other EHR sources but only stored as opaque JSON in fhir_resources. They
-- are now also materialised into structured rows so that:
--   - the inactivation risk engine can inspect active problem lists and
--     nephrotoxic / immunosuppressive medication lists
--   - CDS Hooks services can query conditions and allergies without parsing
--     JSONB blobs at query time
--   - OPTN export templates can reference structured clinical context
--
-- Sources: FHIR_R4 (Epic import, direct FHIR POST), HL7_V2, MANUAL entry.
-- All tables follow the same org-scoped, RLS-protected pattern as 002_clinical.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- patient_conditions
-- Materialised from FHIR R4 Condition resources. code/system follow SNOMED-CT
-- or ICD-10-CM as sent by the originating EHR. clinical_status mirrors the
-- FHIR valueset: active | recurrence | relapse | inactive | remission |
-- resolved. category mirrors: problem-list-item | encounter-diagnosis.
-- ---------------------------------------------------------------------------
CREATE TABLE patient_conditions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    code_system         TEXT,
    display             TEXT,
    clinical_status     TEXT,
    verification_status TEXT,
    category            TEXT,
    onset_date          DATE,
    abatement_date      DATE,
    notes               TEXT,
    source              TEXT NOT NULL DEFAULT 'MANUAL'
                        CHECK (source IN ('MANUAL', 'FHIR_R4', 'HL7_V2')),
    fhir_resource_id    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conditions_patient     ON patient_conditions(org_id, patient_id, onset_date DESC);
CREATE INDEX idx_conditions_code        ON patient_conditions(org_id, patient_id, code);
CREATE INDEX idx_conditions_status      ON patient_conditions(org_id, patient_id, clinical_status);

CREATE TRIGGER patient_conditions_updated BEFORE UPDATE ON patient_conditions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- patient_medications
-- Materialised from FHIR R4 MedicationRequest resources. medication_code /
-- code_system follow RxNorm (system urn:oid:2.16.840.1.113883.6.88) as
-- returned by Epic. status mirrors the FHIR MedicationRequest.status
-- valueset: active | on-hold | cancelled | completed | stopped | draft.
-- ---------------------------------------------------------------------------
CREATE TABLE patient_medications (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    medication_code   TEXT,
    code_system       TEXT,
    medication_name   TEXT NOT NULL,
    status            TEXT,
    intent            TEXT,
    dosage_text       TEXT,
    frequency         TEXT,
    route             TEXT,
    authored_on       DATE,
    prescriber        TEXT,
    notes             TEXT,
    source            TEXT NOT NULL DEFAULT 'MANUAL'
                      CHECK (source IN ('MANUAL', 'FHIR_R4', 'HL7_V2')),
    fhir_resource_id  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_medications_patient    ON patient_medications(org_id, patient_id, authored_on DESC);
CREATE INDEX idx_medications_name       ON patient_medications(org_id, patient_id, medication_name);
CREATE INDEX idx_medications_status     ON patient_medications(org_id, patient_id, status);

CREATE TRIGGER patient_medications_updated BEFORE UPDATE ON patient_medications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- patient_allergies
-- Materialised from FHIR R4 AllergyIntolerance resources. criticality mirrors
-- the FHIR valueset: low | high | unable-to-assess. allergy_type: allergy |
-- intolerance. category: food | medication | environment | biologic.
-- ---------------------------------------------------------------------------
CREATE TABLE patient_allergies (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    patient_id            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    code                  TEXT,
    code_system           TEXT,
    display               TEXT NOT NULL,
    allergy_type          TEXT,
    category              TEXT,
    criticality           TEXT,
    clinical_status       TEXT,
    verification_status   TEXT,
    reaction_description  TEXT,
    onset_date            DATE,
    notes                 TEXT,
    source                TEXT NOT NULL DEFAULT 'MANUAL'
                          CHECK (source IN ('MANUAL', 'FHIR_R4', 'HL7_V2')),
    fhir_resource_id      TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_allergies_patient      ON patient_allergies(org_id, patient_id);
CREATE INDEX idx_allergies_code         ON patient_allergies(org_id, patient_id, code);
CREATE INDEX idx_allergies_criticality  ON patient_allergies(org_id, patient_id, criticality);

CREATE TRIGGER patient_allergies_updated BEFORE UPDATE ON patient_allergies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security — same pattern as every other tenant table
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY['patient_conditions', 'patient_medications', 'patient_allergies'];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY %I ON %I USING (org_id = app_current_org_id()) '
            'WITH CHECK (org_id = app_current_org_id())',
            'tenant_isolation_' || tbl, tbl
        );
    END LOOP;
END
$$;

-- =============================================================================
-- 007_clinical_detail.sql complete
-- =============================================================================
