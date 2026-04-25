-- =============================================================================
-- 002_clinical.sql
-- Clinical entities: patients, donor_organs, organ_offers, lab_results,
-- post-transplant follow-up, living donors, HL7 message log, FHIR resource cache.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- patients (waitlist + transplant recipients)
-- ---------------------------------------------------------------------------
CREATE TABLE patients (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    mrn                         TEXT,                       -- hospital MRN (PID-3.1)
    patient_id                  TEXT,                       -- legacy/business id
    first_name                  TEXT NOT NULL,
    last_name                   TEXT NOT NULL,
    middle_name                 TEXT,
    date_of_birth               DATE,
    sex                         TEXT,
    blood_type                  TEXT,
    organ_needed                TEXT,
    medical_urgency             TEXT NOT NULL DEFAULT 'medium',
    waitlist_status             TEXT NOT NULL DEFAULT 'active',
    date_added_to_waitlist      DATE,
    priority_score              NUMERIC(8,3) DEFAULT 0,
    priority_score_breakdown    JSONB,
    hla_typing                  JSONB,
    pra_percentage              NUMERIC(5,2),
    cpra_percentage             NUMERIC(5,2),
    meld_score                  INTEGER,
    las_score                   NUMERIC(6,2),
    functional_status           TEXT,
    prognosis_rating            TEXT,
    last_evaluation_date        DATE,
    comorbidity_score           INTEGER,
    previous_transplants        INTEGER NOT NULL DEFAULT 0,
    compliance_score            INTEGER,
    weight_kg                   NUMERIC(6,2),
    height_cm                   NUMERIC(6,2),
    phone                       TEXT,
    email                       CITEXT,
    address                     JSONB,
    emergency_contact_name      TEXT,
    emergency_contact_phone     TEXT,
    diagnosis                   TEXT,
    comorbidities               TEXT,
    medications                 JSONB,
    donor_preferences           JSONB,
    psychological_clearance     BOOLEAN NOT NULL DEFAULT TRUE,
    support_system_rating       TEXT,
    document_urls               JSONB,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                  UUID,
    updated_by                  UUID,
    UNIQUE(org_id, patient_id),
    UNIQUE(org_id, mrn)
);

CREATE INDEX idx_patients_org ON patients(org_id);
CREATE INDEX idx_patients_mrn ON patients(org_id, mrn);
CREATE INDEX idx_patients_blood ON patients(org_id, blood_type);
CREATE INDEX idx_patients_organ ON patients(org_id, organ_needed);
CREATE INDEX idx_patients_status ON patients(org_id, waitlist_status);
CREATE INDEX idx_patients_priority ON patients(org_id, priority_score DESC);

CREATE TRIGGER patients_updated BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- donor_organs
-- ---------------------------------------------------------------------------
CREATE TABLE donor_organs (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    donor_id                 TEXT,
    organ_type               TEXT NOT NULL,
    blood_type               TEXT NOT NULL,
    hla_typing               JSONB,
    donor_age                INTEGER,
    donor_weight_kg          NUMERIC(6,2),
    donor_height_cm          NUMERIC(6,2),
    cause_of_death           TEXT,
    cold_ischemia_time_hours NUMERIC(5,2),
    organ_condition          TEXT,
    organ_quality            TEXT,
    organ_status             TEXT NOT NULL DEFAULT 'available',
    recovery_date            TIMESTAMPTZ,
    procurement_date         TIMESTAMPTZ,
    recovery_hospital        TEXT,
    location                 TEXT,
    expiration_date          TIMESTAMPTZ,
    kdpi                     NUMERIC(5,2),
    notes                    TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               UUID,
    updated_by               UUID,
    UNIQUE(org_id, donor_id)
);

CREATE INDEX idx_donor_organs_org ON donor_organs(org_id);
CREATE INDEX idx_donor_organs_status ON donor_organs(org_id, organ_status);

CREATE TRIGGER donor_organs_updated BEFORE UPDATE ON donor_organs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- organ_offers (state machine: OFFERED → ACCEPTED|DECLINED → IMPLANTED|EXPIRED)
-- ---------------------------------------------------------------------------
CREATE TABLE organ_offers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    donor_organ_id      UUID REFERENCES donor_organs(id),
    patient_id          UUID REFERENCES patients(id),
    optn_match_id       TEXT,
    offer_status        TEXT NOT NULL DEFAULT 'OFFERED'
                        CHECK (offer_status IN ('OFFERED','ACCEPTED','DECLINED','EXPIRED','IMPLANTED','BACKUP')),
    sequence_number     INTEGER,
    offered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    response_due_at     TIMESTAMPTZ,
    responded_at        TIMESTAMPTZ,
    response_user_id    UUID REFERENCES users(id),
    decline_code        TEXT,
    decline_reason      TEXT,
    implanted_at        TIMESTAMPTZ,
    cold_ischemia_hours NUMERIC(5,2),
    notes               TEXT,
    state_history       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_offers_org ON organ_offers(org_id, offer_status);
CREATE INDEX idx_offers_patient ON organ_offers(org_id, patient_id);
CREATE INDEX idx_offers_donor ON organ_offers(org_id, donor_organ_id);

CREATE TRIGGER organ_offers_updated BEFORE UPDATE ON organ_offers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- lab_results (operational tracking; values stored as text to prevent
-- silent clinical interpretation)
-- ---------------------------------------------------------------------------
CREATE TABLE lab_results (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    test_code         TEXT NOT NULL,
    test_name         TEXT NOT NULL,
    value             TEXT NOT NULL,
    units             TEXT,
    reference_range   TEXT,
    abnormal_flag     TEXT,
    result_status     TEXT,
    collected_at      TIMESTAMPTZ NOT NULL,
    resulted_at       TIMESTAMPTZ,
    source            TEXT NOT NULL DEFAULT 'MANUAL'
                      CHECK (source IN ('MANUAL','HL7_V2','FHIR_R4','CSV_IMPORT')),
    source_message_id UUID,
    ordering_service  TEXT,
    entered_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        UUID
);

CREATE INDEX idx_labs_org ON lab_results(org_id);
CREATE INDEX idx_labs_patient ON lab_results(org_id, patient_id, collected_at DESC);
CREATE INDEX idx_labs_test ON lab_results(org_id, patient_id, test_code, collected_at DESC);

CREATE TRIGGER lab_results_updated BEFORE UPDATE ON lab_results
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- post_transplant_followups
-- ---------------------------------------------------------------------------
CREATE TABLE post_transplant_followups (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    patient_id               UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    transplant_date          DATE NOT NULL,
    organ_transplanted       TEXT NOT NULL,
    followup_due_date        DATE NOT NULL,
    followup_completed_date  DATE,
    followup_window_label    TEXT,                          -- '6_MONTH', '1_YEAR', etc.
    status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','completed','overdue','missed','waived')),
    serum_creatinine         NUMERIC(6,3),
    egfr                     NUMERIC(6,2),
    rejection_episode        BOOLEAN,
    rejection_grade          TEXT,
    immunosuppression_regimen TEXT,
    graft_function           TEXT,
    notes                    TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               UUID,
    updated_by               UUID
);

CREATE INDEX idx_posttx_patient ON post_transplant_followups(org_id, patient_id, followup_due_date);
CREATE INDEX idx_posttx_status ON post_transplant_followups(org_id, status, followup_due_date);

CREATE TRIGGER posttx_updated BEFORE UPDATE ON post_transplant_followups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- living_donors
-- ---------------------------------------------------------------------------
CREATE TABLE living_donors (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    candidate_first_name        TEXT NOT NULL,
    candidate_last_name         TEXT NOT NULL,
    date_of_birth               DATE,
    blood_type                  TEXT,
    relationship_to_recipient   TEXT,
    intended_recipient_id       UUID REFERENCES patients(id),
    organ_intended              TEXT NOT NULL,
    workflow_status             TEXT NOT NULL DEFAULT 'INQUIRY'
                                CHECK (workflow_status IN (
                                  'INQUIRY','SCREENING','EVALUATION','PSYCH_CLEARANCE',
                                  'IDA_REVIEW','APPROVED','DECLINED','WITHDRAWN','DONATED'
                                )),
    independent_advocate_id     UUID REFERENCES users(id),
    advocate_clearance_date     DATE,
    psych_clearance_date        DATE,
    medical_clearance_date      DATE,
    decline_reason              TEXT,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                  UUID,
    updated_by                  UUID
);

CREATE INDEX idx_living_donors_org ON living_donors(org_id, workflow_status);

CREATE TRIGGER living_donors_updated BEFORE UPDATE ON living_donors
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- hl7_messages (raw + parsed; one row per inbound or outbound message)
-- ---------------------------------------------------------------------------
CREATE TABLE hl7_messages (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id               UUID REFERENCES organizations(id),
    direction            TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    transport            TEXT NOT NULL CHECK (transport IN ('mllp','file','rest')),
    sending_app          TEXT,
    sending_facility     TEXT,
    receiving_app        TEXT,
    receiving_facility   TEXT,
    message_type         TEXT,
    trigger_event        TEXT,
    message_control_id   TEXT,
    raw_message          TEXT NOT NULL,
    parsed               JSONB,
    ack_code             TEXT,
    ack_message          TEXT,
    processed_status     TEXT NOT NULL DEFAULT 'received'
                         CHECK (processed_status IN ('received','accepted','rejected','error','deferred')),
    error_details        TEXT,
    peer_address         INET,
    peer_cert_subject    TEXT,
    received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at         TIMESTAMPTZ
);

CREATE INDEX idx_hl7_org ON hl7_messages(org_id, received_at DESC);
CREATE INDEX idx_hl7_status ON hl7_messages(processed_status);
CREATE INDEX idx_hl7_msgctrl ON hl7_messages(message_control_id);

-- ---------------------------------------------------------------------------
-- fhir_resources (storage for FHIR R4 resources we host; minimal cache for
-- inbound writes and cross-resource read coherence)
-- ---------------------------------------------------------------------------
CREATE TABLE fhir_resources (
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    resource_type     TEXT NOT NULL,
    resource_id       TEXT NOT NULL,
    version_id        INTEGER NOT NULL DEFAULT 1,
    last_updated      TIMESTAMPTZ NOT NULL DEFAULT now(),
    body              JSONB NOT NULL,
    deleted           BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (org_id, resource_type, resource_id)
);

CREATE INDEX idx_fhir_type_updated ON fhir_resources(org_id, resource_type, last_updated DESC);

-- ---------------------------------------------------------------------------
-- mfa_challenges (short-lived; TOTP step-up after password)
-- ---------------------------------------------------------------------------
CREATE TABLE mfa_challenges (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfa_challenges_user ON mfa_challenges(user_id, expires_at DESC);
