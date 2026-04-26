'use strict';

/**
 * Extended HL7 v2 segment parsers.
 *
 * The base parser in electron/services/hl7v2.cjs only knows MSH/PID/PV1/OBR/OBX.
 * This module adds extraction logic for the segments needed by the message
 * types we now accept (ADT extensions, ORM, OMP, RDE, RDS, MDM, SIU, BAR/DFT,
 * MFN). Output structure is normalised to JSON-friendly shapes that the
 * ingest service can persist directly.
 *
 * IMPORTANT: HL7 v2 field positions are 1-based in the spec but 0-based after
 * the segment-name has been split off. We follow the same convention as the
 * base parser: fields[i] corresponds to <SEG>-(i+1).
 */

function pickFirst(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return pickFirst(value[0]);
  return value;
}
function pickAt(field, idx) {
  if (field === null || field === undefined) return null;
  if (!Array.isArray(field)) return idx === 0 ? field : null;
  return field[idx] !== undefined ? field[idx] : null;
}
function flatString(field) {
  const v = pickFirst(field);
  return v == null ? null : String(v);
}

// ---------------------------------------------------------------------------
// EVN — event type (used in ADT, BAR, DFT, MDM)
// ---------------------------------------------------------------------------
function parseEVN(seg) {
  const f = seg.fields;
  return {
    event_type_code: pickFirst(f[0]),
    recorded_at: flatString(f[1]),
    planned_event_at: flatString(f[2]),
    event_reason_code: pickFirst(f[3]),
    operator_id: pickFirst(f[4]),
    event_occurred: flatString(f[5]),
  };
}

// ---------------------------------------------------------------------------
// PV2 — visit info supplemental
// ---------------------------------------------------------------------------
function parsePV2(seg) {
  const f = seg.fields;
  return {
    prior_pending_location: pickFirst(f[0]),
    accommodation_code: pickAt(f[1], 0),
    admit_reason: pickAt(f[2], 1) || pickAt(f[2], 0),
    transfer_reason: pickAt(f[3], 1) || pickAt(f[3], 0),
    expected_admit_dt: flatString(f[6]),
    expected_discharge_dt: flatString(f[7]),
    visit_protection_indicator: pickFirst(f[21]),
  };
}

// ---------------------------------------------------------------------------
// AL1 — allergy info  /  IAM — patient adverse reaction info (A60)
// ---------------------------------------------------------------------------
function parseAL1(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    allergen_type: pickFirst(f[1]),
    allergen_code: pickAt(f[2], 0),
    allergen_text: pickAt(f[2], 1),
    severity: pickFirst(f[3]),
    reaction: pickFirst(f[4]),
    onset_date: flatString(f[5]),
  };
}
function parseIAM(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    allergen_type: pickFirst(f[1]),
    allergen_code: pickAt(f[2], 0),
    allergen_text: pickAt(f[2], 1),
    severity: pickFirst(f[3]),
    reaction: pickFirst(f[4]),
    identification_date: flatString(f[5]),
    sensitivity_to_causative: pickFirst(f[8]),
    statused_by: pickFirst(f[14]),
  };
}

// ---------------------------------------------------------------------------
// DG1 — diagnosis
// ---------------------------------------------------------------------------
function parseDG1(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    diagnosis_coding_method: pickFirst(f[1]),
    diagnosis_code: pickAt(f[2], 0),
    diagnosis_description: pickAt(f[2], 1),
    diagnosis_date: flatString(f[4]),
    diagnosis_type: pickFirst(f[5]),
    diagnosis_priority: pickFirst(f[14]),
  };
}

// ---------------------------------------------------------------------------
// PR1 — procedures
// ---------------------------------------------------------------------------
function parsePR1(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    procedure_coding_method: pickFirst(f[1]),
    procedure_code: pickAt(f[2], 0),
    procedure_description: pickAt(f[2], 1),
    procedure_date: flatString(f[4]),
    procedure_type: pickFirst(f[5]),
  };
}

// ---------------------------------------------------------------------------
// NK1 — next of kin
// ---------------------------------------------------------------------------
function parseNK1(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    name: {
      family: pickAt(f[1], 0),
      given: pickAt(f[1], 1),
    },
    relationship: pickAt(f[2], 1) || pickAt(f[2], 0),
    address: pickAt(f[3], 0),
    phone: pickAt(f[4], 0),
  };
}

// ---------------------------------------------------------------------------
// GT1 — guarantor
// ---------------------------------------------------------------------------
function parseGT1(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    guarantor_id: pickAt(f[1], 0),
    name: {
      family: pickAt(f[2], 0),
      given: pickAt(f[2], 1),
    },
    address: pickAt(f[4], 0),
    phone: pickAt(f[5], 0),
    employer: pickAt(f[10], 0),
  };
}

// ---------------------------------------------------------------------------
// IN1 — insurance
// ---------------------------------------------------------------------------
function parseIN1(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    insurance_plan_id: pickAt(f[1], 0),
    insurance_plan_name: pickAt(f[1], 1),
    insurance_company_id: pickAt(f[2], 0),
    insurance_company_name: pickAt(f[3], 0),
    group_number: pickFirst(f[7]),
    group_name: pickFirst(f[8]),
    policy_number: pickFirst(f[35]),
    policy_holder_name: {
      family: pickAt(f[15], 0),
      given: pickAt(f[15], 1),
    },
  };
}

// ---------------------------------------------------------------------------
// MRG — merge information (A40)
// ---------------------------------------------------------------------------
function parseMRG(seg) {
  const f = seg.fields;
  return {
    prior_patient_identifier_list: pickFirst(f[0]),
    prior_patient_account_number: pickFirst(f[2]),
    prior_visit_number: pickFirst(f[4]),
    prior_alternate_visit_id: pickFirst(f[5]),
  };
}

// ---------------------------------------------------------------------------
// ORC — common order
// ---------------------------------------------------------------------------
function parseORC(seg) {
  const f = seg.fields;
  return {
    order_control: pickFirst(f[0]),
    placer_order_number: pickAt(f[1], 0),
    filler_order_number: pickAt(f[2], 0),
    placer_group_number: pickAt(f[3], 0),
    order_status: pickFirst(f[4]),
    response_flag: pickFirst(f[5]),
    quantity_timing: pickAt(f[6], 0),
    parent_order: pickAt(f[7], 0),
    transaction_dt: flatString(f[8]),
    entered_by: pickAt(f[9], 1),
    verified_by: pickAt(f[10], 1),
    ordering_provider: pickAt(f[11], 1),
    enterer_location: pickAt(f[12], 0),
    callback_phone: pickAt(f[13], 0),
    order_effective_dt: flatString(f[14]),
  };
}

// ---------------------------------------------------------------------------
// RXO — pharmacy order  / RXE — encoded order  / RXD — dispense / RXR — route
// ---------------------------------------------------------------------------
function parseRXO(seg) {
  const f = seg.fields;
  return {
    requested_give_code: pickAt(f[0], 0),
    requested_give_name: pickAt(f[0], 1),
    requested_give_amount_min: pickFirst(f[1]),
    requested_give_amount_max: pickFirst(f[2]),
    requested_give_units: pickAt(f[3], 0),
    requested_dosage_form: pickAt(f[4], 0),
    provider_pharmacy_instr: pickFirst(f[5]),
    provider_admin_instr: pickFirst(f[6]),
    deliver_to_location: pickFirst(f[7]),
    requested_giver_strength: pickFirst(f[10]),
    requested_giver_strength_units: pickAt(f[11], 0),
  };
}
function parseRXE(seg) {
  const f = seg.fields;
  return {
    quantity_timing: pickFirst(f[0]),
    give_code: pickAt(f[1], 0),
    give_name: pickAt(f[1], 1),
    give_amount: pickFirst(f[2]),
    give_amount_max: pickFirst(f[3]),
    give_units: pickAt(f[4], 0),
    give_dosage_form: pickAt(f[5], 0),
    provider_admin_instr: pickFirst(f[6]),
    deliver_to_location: pickFirst(f[7]),
    substitution_status: pickFirst(f[8]),
    rx_number: pickFirst(f[14]),
    refills_remaining: pickFirst(f[15]),
    pharmacist_treatment_supplier: pickAt(f[12], 1),
  };
}
function parseRXD(seg) {
  const f = seg.fields;
  return {
    dispense_sub_id: pickFirst(f[0]),
    dispense_give_code: pickAt(f[1], 0),
    dispense_give_name: pickAt(f[1], 1),
    date_time_dispensed: flatString(f[2]),
    actual_dispense_amount: pickFirst(f[3]),
    actual_dispense_units: pickAt(f[4], 0),
    prescription_number: pickFirst(f[6]),
  };
}
function parseRXR(seg) {
  const f = seg.fields;
  return {
    route_code: pickAt(f[0], 0),
    route_text: pickAt(f[0], 1),
    administration_site: pickAt(f[1], 0),
    administration_device: pickAt(f[2], 0),
    administration_method: pickAt(f[3], 0),
  };
}

// ---------------------------------------------------------------------------
// FT1 — financial transaction
// ---------------------------------------------------------------------------
function parseFT1(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    transaction_id: pickFirst(f[1]),
    transaction_dt: flatString(f[3]),
    transaction_posting_dt: flatString(f[4]),
    transaction_type: pickFirst(f[5]),
    transaction_code: pickAt(f[6], 0),
    transaction_description: pickAt(f[6], 1),
    transaction_amount: pickFirst(f[9]),
    transaction_quantity: pickFirst(f[10]),
    department_code: pickAt(f[12], 0),
    insurance_plan: pickAt(f[13], 0),
    diagnosis_code: pickAt(f[18], 0),
    performed_by: pickAt(f[19], 1),
    ordered_by: pickAt(f[20], 1),
  };
}

// ---------------------------------------------------------------------------
// SCH — scheduling activity (SIU)
// ---------------------------------------------------------------------------
function parseSCH(seg) {
  const f = seg.fields;
  return {
    placer_appointment_id: pickAt(f[0], 0),
    filler_appointment_id: pickAt(f[1], 0),
    occurrence_number: pickFirst(f[2]),
    appointment_reason: pickAt(f[5], 1) || pickAt(f[5], 0),
    appointment_type: pickAt(f[6], 1) || pickAt(f[6], 0),
    duration_minutes: pickFirst(f[8]),
    requested_start_dt: pickAt(f[10], 3) || flatString(f[10]),
    appointment_timing_quantity: pickFirst(f[10]),
    placer_contact_person: pickAt(f[11], 1),
    placer_contact_phone: pickAt(f[12], 0),
    filler_contact_person: pickAt(f[15], 1),
    filling_status: pickFirst(f[24]),
  };
}
function parseAIS(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    universal_service_code: pickAt(f[2], 0),
    universal_service_name: pickAt(f[2], 1),
    start_dt: flatString(f[3]),
    duration: pickFirst(f[4]),
    duration_units: pickAt(f[5], 0),
  };
}
function parseAIG(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    resource_id: pickAt(f[2], 0),
    resource_name: pickAt(f[2], 1),
    resource_role: pickAt(f[3], 0),
    start_dt: flatString(f[5]),
  };
}
function parseAIL(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    location_resource_id: pickAt(f[2], 0),
    location_type: pickAt(f[3], 0),
    start_dt: flatString(f[5]),
  };
}
function parseAIP(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    personnel_resource_id: pickAt(f[2], 0),
    personnel_name: pickAt(f[2], 1),
    role: pickAt(f[3], 0),
    start_dt: flatString(f[5]),
  };
}

// ---------------------------------------------------------------------------
// TXA — transcription document header (MDM)
// ---------------------------------------------------------------------------
function parseTXA(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    document_type: pickFirst(f[1]),
    document_content_presentation: pickFirst(f[2]),
    activity_dt: flatString(f[3]),
    primary_activity_provider: pickAt(f[4], 1),
    origination_dt: flatString(f[5]),
    transcription_dt: flatString(f[6]),
    edit_dt: flatString(f[7]),
    document_completion_status: pickFirst(f[16]),
    document_confidentiality_status: pickFirst(f[17]),
    document_availability_status: pickFirst(f[18]),
    unique_document_number: pickFirst(f[11]),
    parent_document_number: pickFirst(f[12]),
  };
}

// ---------------------------------------------------------------------------
// MFI / MFE / STF / LOC / CM0 — master files
// ---------------------------------------------------------------------------
function parseMFI(seg) {
  const f = seg.fields;
  return {
    master_file_identifier: pickAt(f[0], 0),
    master_file_application_identifier: pickAt(f[1], 0),
    file_level_event_code: pickFirst(f[2]),
    entered_dt: flatString(f[3]),
    effective_dt: flatString(f[4]),
    response_level_code: pickFirst(f[5]),
  };
}
function parseMFE(seg) {
  const f = seg.fields;
  return {
    record_level_event_code: pickFirst(f[0]),
    mfn_control_id: pickFirst(f[1]),
    effective_dt: flatString(f[2]),
    primary_key_value: pickFirst(f[3]),
  };
}
function parseSTF(seg) {
  const f = seg.fields;
  return {
    primary_key_value: pickAt(f[0], 0),
    staff_id_code: pickAt(f[1], 0),
    staff_name: {
      family: pickAt(f[2], 0),
      given: pickAt(f[2], 1),
    },
    staff_type: pickFirst(f[3]),
    sex: pickFirst(f[4]),
    birth_dt: flatString(f[5]),
    active_inactive_flag: pickFirst(f[6]),
    department: pickAt(f[7], 0),
  };
}
function parseLOC(seg) {
  const f = seg.fields;
  return {
    primary_key_value: pickAt(f[0], 0),
    location_description: pickFirst(f[1]),
    location_type: pickFirst(f[2]),
    organization_name: pickFirst(f[3]),
    location_address: pickAt(f[4], 0),
    location_phone: pickAt(f[5], 0),
  };
}
function parseCM0(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    sponsor_study_id: pickAt(f[1], 0),
    alternate_study_id: pickAt(f[2], 0),
    title_of_study: pickFirst(f[3]),
    chairman_of_study: pickAt(f[4], 1),
    last_irb_approval_dt: flatString(f[5]),
    total_accrual_to_date: pickFirst(f[6]),
    last_accrual_dt: flatString(f[7]),
    contact_for_study: pickAt(f[8], 1),
    contact_phone_number: pickAt(f[9], 0),
    contact_address: pickAt(f[10], 0),
  };
}

// ---------------------------------------------------------------------------
// NTE — notes and comments
// ---------------------------------------------------------------------------
function parseNTE(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    source: pickFirst(f[1]),
    comment: pickFirst(f[2]),
  };
}

// ---------------------------------------------------------------------------
// SPM — specimen
// ---------------------------------------------------------------------------
function parseSPM(seg) {
  const f = seg.fields;
  return {
    set_id: pickFirst(f[0]),
    specimen_id: pickAt(f[1], 0),
    specimen_parent_ids: pickFirst(f[2]),
    specimen_type: pickAt(f[3], 1) || pickAt(f[3], 0),
    specimen_collection_dt: flatString(f[16]),
    specimen_received_dt: flatString(f[17]),
  };
}

const SEGMENT_PARSERS = {
  EVN: parseEVN,
  PV2: parsePV2,
  AL1: parseAL1,
  IAM: parseIAM,
  DG1: parseDG1,
  PR1: parsePR1,
  NK1: parseNK1,
  GT1: parseGT1,
  IN1: parseIN1,
  MRG: parseMRG,
  ORC: parseORC,
  RXO: parseRXO,
  RXE: parseRXE,
  RXD: parseRXD,
  RXR: parseRXR,
  FT1: parseFT1,
  SCH: parseSCH,
  AIS: parseAIS,
  AIG: parseAIG,
  AIL: parseAIL,
  AIP: parseAIP,
  TXA: parseTXA,
  MFI: parseMFI,
  MFE: parseMFE,
  STF: parseSTF,
  LOC: parseLOC,
  CM0: parseCM0,
  NTE: parseNTE,
  SPM: parseSPM,
};

/**
 * Given an array of parsed-but-name-only segments (the second pass to the
 * base parser), extract every segment we know about into a flat structure.
 * Multi-occurring segments are returned as arrays.
 */
function extractAll(segments) {
  const out = {};
  for (const seg of segments) {
    const parser = SEGMENT_PARSERS[seg.name];
    if (!parser) continue;
    const value = parser(seg);
    if (out[seg.name]) {
      if (Array.isArray(out[seg.name])) out[seg.name].push(value);
      else out[seg.name] = [out[seg.name], value];
    } else {
      out[seg.name] = value;
    }
  }
  return out;
}

module.exports = {
  SEGMENT_PARSERS,
  extractAll,
};
