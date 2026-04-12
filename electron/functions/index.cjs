// Business logic functions (priority calc, donor matching, FHIR, etc.)

const { v4: uuidv4 } = require('uuid');

async function calculatePriorityAdvanced(params, context) {
  const { db, currentUser, logAudit } = context;
  const { patient_id } = params;
  
  const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND org_id = ?').get(patient_id, currentUser.org_id);
  
  if (!patient) {
    throw new Error('Patient not found');
  }
  
  const weights = db.prepare('SELECT * FROM priority_weights WHERE is_active = 1').get() || {
    medical_urgency_weight: 30,
    time_on_waitlist_weight: 25,
    organ_specific_score_weight: 25,
    evaluation_recency_weight: 10,
    blood_type_rarity_weight: 10,
    evaluation_decay_rate: 0.5,
  };
  
  const breakdown = {
    components: {},
    raw_scores: {},
    weighted_scores: {},
    total: 0
  };
  
  // 1. Medical Urgency Score
  const urgencyScores = {
    critical: 100,
    high: 75,
    medium: 50,
    low: 25,
  };
  const urgencyRaw = urgencyScores[patient.medical_urgency] || 50;
  
  // Factor in functional status
  const functionalStatusMultiplier = {
    critical: 1.2,
    fully_dependent: 1.1,
    partially_dependent: 1.0,
    independent: 0.95,
  };
  const functionalAdjustment = functionalStatusMultiplier[patient.functional_status] || 1.0;
  
  // Factor in prognosis
  const prognosisMultiplier = {
    critical: 1.3,
    poor: 1.15,
    fair: 1.0,
    good: 0.95,
    excellent: 0.9,
  };
  const prognosisAdjustment = prognosisMultiplier[patient.prognosis_rating] || 1.0;
  
  const urgencyScore = urgencyRaw * functionalAdjustment * prognosisAdjustment;
  breakdown.raw_scores.medical_urgency = urgencyScore;
  breakdown.components.medical_urgency = {
    base: urgencyRaw,
    functional_adjustment: functionalAdjustment,
    prognosis_adjustment: prognosisAdjustment,
    final: urgencyScore
  };
  
  // 2. Time on Waitlist Score
  let timeScore = 0;
  if (patient.date_added_to_waitlist) {
    const daysOnList = Math.floor(
      (new Date() - new Date(patient.date_added_to_waitlist)) / (1000 * 60 * 60 * 24)
    );
    timeScore = Math.min(100, (daysOnList / 730) * 100);
    
    if (daysOnList > 1095) {
      timeScore = Math.min(100, timeScore + 10);
    }
    
    breakdown.components.time_on_waitlist = {
      days: daysOnList,
      base_score: timeScore,
      long_wait_bonus: daysOnList > 1095 ? 10 : 0
    };
  }
  breakdown.raw_scores.time_on_waitlist = timeScore;
  
  // 3. Organ-Specific Scoring
  let organScore = 0;
  if (patient.organ_needed === 'liver' && patient.meld_score) {
    organScore = ((patient.meld_score - 6) / 34) * 100;
    breakdown.components.organ_specific = {
      type: 'MELD',
      score: patient.meld_score,
      normalized: organScore
    };
  } else if (patient.organ_needed === 'lung' && patient.las_score) {
    organScore = patient.las_score;
    breakdown.components.organ_specific = {
      type: 'LAS',
      score: patient.las_score,
      normalized: organScore
    };
  } else if (patient.organ_needed === 'kidney') {
    let kidneyScore = 50;
    if (patient.pra_percentage) {
      kidneyScore += (patient.pra_percentage / 100) * 30;
    }
    if (patient.cpra_percentage) {
      kidneyScore += (patient.cpra_percentage / 100) * 20;
    }
    organScore = Math.min(100, kidneyScore);
    breakdown.components.organ_specific = {
      type: 'Kidney (PRA/CPRA)',
      pra: patient.pra_percentage,
      cpra: patient.cpra_percentage,
      normalized: organScore
    };
  } else {
    organScore = urgencyRaw * 0.6;
    breakdown.components.organ_specific = {
      type: 'Default (based on urgency)',
      normalized: organScore
    };
  }
  breakdown.raw_scores.organ_specific = organScore;
  
  // 4. Evaluation Recency with Time Decay
  let evaluationScore = 0;
  if (patient.last_evaluation_date) {
    const daysSinceEval = Math.floor(
      (new Date() - new Date(patient.last_evaluation_date)) / (1000 * 60 * 60 * 24)
    );
    
    if (daysSinceEval <= 90) {
      evaluationScore = 100;
    } else {
      const periods = Math.floor(daysSinceEval / 90);
      const decayRate = weights.evaluation_decay_rate || 0.5;
      evaluationScore = 100 * Math.pow(1 - decayRate, periods);
    }
    
    breakdown.components.evaluation_recency = {
      days_since_eval: daysSinceEval,
      decay_periods: Math.floor(daysSinceEval / 90),
      decay_rate: weights.evaluation_decay_rate,
      score: evaluationScore
    };
  } else {
    evaluationScore = 0;
    breakdown.components.evaluation_recency = {
      status: 'No evaluation on record',
      score: 0
    };
  }
  breakdown.raw_scores.evaluation_recency = evaluationScore;
  
  // 5. Blood Type Rarity Score
  const bloodTypeRarity = {
    'AB-': 100,
    'B-': 85,
    'A-': 70,
    'O-': 60,
    'AB+': 50,
    'B+': 40,
    'A+': 30,
    'O+': 20,
  };
  const bloodScore = bloodTypeRarity[patient.blood_type] || 40;
  breakdown.raw_scores.blood_type_rarity = bloodScore;
  breakdown.components.blood_type_rarity = {
    blood_type: patient.blood_type,
    rarity_score: bloodScore
  };
  
  // 6. Additional Factors
  let comorbidityPenalty = 0;
  if (patient.comorbidity_score) {
    comorbidityPenalty = (patient.comorbidity_score / 10) * 10;
    breakdown.components.comorbidity_adjustment = {
      score: patient.comorbidity_score,
      penalty: -comorbidityPenalty
    };
  }
  
  let previousTransplantAdjustment = 0;
  if (patient.previous_transplants > 0) {
    previousTransplantAdjustment = -5 * patient.previous_transplants;
    breakdown.components.previous_transplants = {
      count: patient.previous_transplants,
      adjustment: previousTransplantAdjustment
    };
  }
  
  let complianceBonus = 0;
  if (patient.compliance_score) {
    complianceBonus = (patient.compliance_score / 10) * 5;
    breakdown.components.compliance_bonus = {
      score: patient.compliance_score,
      bonus: complianceBonus
    };
  }
  
  breakdown.weighted_scores.medical_urgency = 
    (breakdown.raw_scores.medical_urgency / 100) * weights.medical_urgency_weight;
  breakdown.weighted_scores.time_on_waitlist = 
    (breakdown.raw_scores.time_on_waitlist / 100) * weights.time_on_waitlist_weight;
  breakdown.weighted_scores.organ_specific = 
    (breakdown.raw_scores.organ_specific / 100) * weights.organ_specific_score_weight;
  breakdown.weighted_scores.evaluation_recency = 
    (breakdown.raw_scores.evaluation_recency / 100) * weights.evaluation_recency_weight;
  breakdown.weighted_scores.blood_type_rarity = 
    (breakdown.raw_scores.blood_type_rarity / 100) * weights.blood_type_rarity_weight;
  
  let finalScore = Object.values(breakdown.weighted_scores).reduce((sum, val) => sum + val, 0);
  finalScore = finalScore - comorbidityPenalty + previousTransplantAdjustment + complianceBonus;
  finalScore = Math.min(100, Math.max(0, finalScore));
  
  breakdown.total = finalScore;
  breakdown.weights_used = weights;
  breakdown.adjustments = {
    comorbidity_penalty: -comorbidityPenalty,
    previous_transplant_adjustment: previousTransplantAdjustment,
    compliance_bonus: complianceBonus
  };
  
  // Update patient with new priority score
  db.prepare(`
    UPDATE patients SET priority_score = ?, priority_score_breakdown = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(finalScore, JSON.stringify(breakdown), patient_id);
  
  logAudit(
    'update',
    'Patient',
    patient_id,
    `${patient.first_name} ${patient.last_name}`,
    `Advanced priority score calculated: ${finalScore.toFixed(1)}`,
    currentUser.email,
    currentUser.role
  );
  
  return {
    success: true,
    priority_score: finalScore,
    breakdown,
    patient_id,
  };
}

async function matchDonorAdvanced(params, context) {
  const { db, currentUser, logAudit } = context;
  const { donor_organ_id, simulation_mode, hypothetical_donor } = params;
  
  let donor;
  if (simulation_mode && hypothetical_donor) {
    donor = hypothetical_donor;
    donor.id = 'simulation';
  } else {
    donor = db.prepare('SELECT * FROM donor_organs WHERE id = ? AND org_id = ?').get(donor_organ_id, currentUser.org_id);
    if (!donor) {
      throw new Error('Donor organ not found');
    }
  }
  
  // Get all active patients waiting for this organ type
  const candidates = db.prepare(`
    SELECT * FROM patients 
    WHERE waitlist_status = 'active' AND organ_needed = ? AND org_id = ?
  `).all(donor.organ_type, currentUser.org_id);
  
  const matches = [];
  
  // TODO: pull this into a shared config — duplicated in frontend
  // Blood type compatibility matrix
  const bloodCompatibility = {
    'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
    'O+': ['O+', 'A+', 'B+', 'AB+'],
    'A-': ['A-', 'A+', 'AB-', 'AB+'],
    'A+': ['A+', 'AB+'],
    'B-': ['B-', 'B+', 'AB-', 'AB+'],
    'B+': ['B+', 'AB+'],
    'AB-': ['AB-', 'AB+'],
    'AB+': ['AB+']
  };
  
  // XXX: naive string parsing — consider using a proper HLA nomenclature lib
  // Parse HLA typing
  const parseHLA = (hlaString) => {
    if (!hlaString) return { A: [], B: [], DR: [], DQ: [] };
    
    const parts = hlaString.split(/[\s,;]+/).map(s => s.trim());
    const result = { A: [], B: [], DR: [], DQ: [] };
    
    parts.forEach(part => {
      if (part.startsWith('A')) result.A.push(part);
      else if (part.startsWith('B') && !part.startsWith('DR')) result.B.push(part);
      else if (part.startsWith('DR')) result.DR.push(part);
      else if (part.startsWith('DQ')) result.DQ.push(part);
    });
    
    return result;
  };
  
  const donorHLA = parseHLA(donor.hla_typing);
  const donorHasHLA = donorHLA.A.length + donorHLA.B.length + donorHLA.DR.length > 0;
  
  for (const patient of candidates) {
    const aboCompatible = bloodCompatibility[donor.blood_type]?.includes(patient.blood_type) || false;
    
    if (!aboCompatible) continue;
    
    const patientHLA = parseHLA(patient.hla_typing);
    const patientHasHLA = patientHLA.A.length + patientHLA.B.length + patientHLA.DR.length > 0;

    let hlaScore;
    const hlaMatches = { A: 0, B: 0, DR: 0, DQ: 0 };

    if (!donorHasHLA || !patientHasHLA) {
      hlaScore = 50;
    } else {
      hlaMatches.A = donorHLA.A.filter(hla => patientHLA.A.includes(hla)).length;
      hlaMatches.B = donorHLA.B.filter(hla => patientHLA.B.includes(hla)).length;
      hlaMatches.DR = donorHLA.DR.filter(hla => patientHLA.DR.includes(hla)).length;
      hlaMatches.DQ = donorHLA.DQ.filter(hla => patientHLA.DQ.includes(hla)).length;

      const totalMatches = hlaMatches.A + hlaMatches.B + hlaMatches.DR;
      const maxPossibleMatches = 6;
      hlaScore = (totalMatches / maxPossibleMatches) * 100;

      if (hlaMatches.DQ > 0) {
        hlaScore = Math.min(100, hlaScore + (hlaMatches.DQ * 5));
      }
    }

    const totalHLAMatches = hlaMatches.A + hlaMatches.B + hlaMatches.DR;
    
    let virtualCrossmatch = 'negative';
    if (!donorHasHLA || !patientHasHLA) {
      virtualCrossmatch = 'pending';
    } else if (patient.pra_percentage > 80 || patient.cpra_percentage > 80) {
      if (totalHLAMatches < 4) {
        virtualCrossmatch = 'positive';
      } else {
        virtualCrossmatch = 'pending';
      }
    } else if (totalHLAMatches >= 5) {
      virtualCrossmatch = 'negative';
    } else {
      virtualCrossmatch = 'pending';
    }
    
    if (virtualCrossmatch === 'positive') continue;
    
    let sizeCompatible = true;
    if (donor.donor_weight_kg && patient.weight_kg) {
      const weightRatio = donor.donor_weight_kg / patient.weight_kg;
      sizeCompatible = weightRatio >= 0.7 && weightRatio <= 1.5;
    }
    
    let compatibilityScore = 0;
    compatibilityScore += (patient.priority_score || 0) * 0.35;
    compatibilityScore += hlaScore * 0.30;
    
    if (donor.blood_type === patient.blood_type) {
      compatibilityScore += 10;
    } else {
      compatibilityScore += 5;
    }
    
    if (sizeCompatible) {
      compatibilityScore += 10;
    } else {
      compatibilityScore += 3;
    }
    
    if (patient.date_added_to_waitlist) {
      const daysOnList = Math.floor(
        (new Date() - new Date(patient.date_added_to_waitlist)) / (1000 * 60 * 60 * 24)
      );
      compatibilityScore += Math.min(10, (daysOnList / 365) * 10);
    }
    
    if (donor.donor_age && patient.date_of_birth) {
      const patientAge = Math.floor(
        (new Date() - new Date(patient.date_of_birth)) / (1000 * 60 * 60 * 24 * 365.25)
      );
      const ageDiff = Math.abs(donor.donor_age - patientAge);
      if (ageDiff <= 10) {
        compatibilityScore += 5;
      } else if (ageDiff <= 20) {
        compatibilityScore += 3;
      }
    }
    
    // FIXME: survival model is overly simplistic, need real Cox regression data
    let predictedSurvival = 85;
    predictedSurvival += (totalHLAMatches / 6) * 10;
    if (donor.blood_type === patient.blood_type) predictedSurvival += 3;
    if (patient.previous_transplants > 0) predictedSurvival -= (patient.previous_transplants * 5);
    if (patient.comorbidity_score) predictedSurvival -= (patient.comorbidity_score * 2);
    predictedSurvival = Math.min(98, Math.max(60, predictedSurvival));
    
    matches.push({
      patient,
      compatibility_score: Math.min(100, compatibilityScore),
      blood_type_compatible: aboCompatible,
      abo_compatible: aboCompatible,
      hla_match_score: hlaScore,
      hla_matches: hlaMatches,
      total_hla_matches: totalHLAMatches,
      size_compatible: sizeCompatible,
      virtual_crossmatch: virtualCrossmatch,
      predicted_graft_survival: predictedSurvival,
    });
  }
  
  matches.sort((a, b) => b.compatibility_score - a.compatibility_score);
  
  matches.forEach((match, index) => {
    match.priority_rank = index + 1;
  });
  
  const createdMatches = [];
  if (!simulation_mode) {
    for (const match of matches.slice(0, 10)) {
      const matchId = uuidv4();
      db.prepare(`
        INSERT INTO matches (
          id, donor_organ_id, patient_id, patient_name, compatibility_score,
          blood_type_compatible, abo_compatible, hla_match_score,
          hla_a_match, hla_b_match, hla_dr_match, hla_dq_match,
          size_compatible, match_status, priority_rank,
          virtual_crossmatch_result, physical_crossmatch_result, predicted_graft_survival,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        matchId, donor.id, match.patient.id,
        `${match.patient.first_name} ${match.patient.last_name}`,
        match.compatibility_score, match.blood_type_compatible ? 1 : 0,
        match.abo_compatible ? 1 : 0, match.hla_match_score,
        match.hla_matches.A, match.hla_matches.B, match.hla_matches.DR, match.hla_matches.DQ,
        match.size_compatible ? 1 : 0, 'potential', match.priority_rank,
        match.virtual_crossmatch, 'not_performed', match.predicted_graft_survival,
        currentUser.email
      );
      createdMatches.push({ id: matchId, ...match });
    }
    
    // Create notifications for top 3 matches
    const admins = db.prepare("SELECT * FROM users WHERE role = 'admin' AND org_id = ?").all(currentUser.org_id);
    for (const match of matches.slice(0, 3)) {
      for (const admin of admins) {
        const notifId = uuidv4();
        db.prepare(`
          INSERT INTO notifications (
            id, recipient_email, title, message, notification_type,
            is_read, related_patient_id, related_patient_name, priority_level,
            action_url, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          notifId, admin.email, 'High-Compatibility Donor Match',
          `Excellent match: ${match.patient.first_name} ${match.patient.last_name} (${match.compatibility_score.toFixed(0)}% compatible, ${match.total_hla_matches}/6 HLA matches) for ${donor.organ_type}`,
          'donor_match', 0, match.patient.id,
          `${match.patient.first_name} ${match.patient.last_name}`,
          match.priority_rank === 1 ? 'critical' : 'high',
          `/DonorMatching?donor_id=${donor.id}`,
          JSON.stringify({ donor_id: donor.id, patient_id: match.patient.id })
        );
      }
    }
    
    logAudit(
      'create',
      'DonorOrgan',
      donor.id,
      null,
      `Advanced matching: ${matches.length} compatible recipients found`,
      currentUser.email,
      currentUser.role
    );
  }
  
  return {
    success: true,
    simulation_mode: simulation_mode || false,
    donor,
    matches: matches.map(m => ({
      patient_id: m.patient.id,
      patient_name: `${m.patient.first_name} ${m.patient.last_name}`,
      patient_id_mrn: m.patient.patient_id,
      blood_type: m.patient.blood_type,
      organ_needed: m.patient.organ_needed,
      priority_score: m.patient.priority_score,
      compatibility_score: m.compatibility_score,
      blood_type_compatible: m.blood_type_compatible,
      abo_compatible: m.abo_compatible,
      hla_match_score: m.hla_match_score,
      hla_matches: m.hla_matches,
      total_hla_matches: m.total_hla_matches,
      size_compatible: m.size_compatible,
      priority_rank: m.priority_rank,
      medical_urgency: m.patient.medical_urgency,
      virtual_crossmatch: m.virtual_crossmatch,
      predicted_graft_survival: m.predicted_graft_survival,
      days_on_waitlist: m.patient.date_added_to_waitlist 
        ? Math.floor((new Date() - new Date(m.patient.date_added_to_waitlist)) / (1000 * 60 * 60 * 24))
        : 0
    })),
    total_matches: matches.length,
    matches_created: createdMatches.length
  };
}

async function checkNotificationRules(params, context) {
  const { db, currentUser, logAudit } = context;
  const { patient_id, event_type, old_data } = params;
  
  const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND org_id = ?').get(patient_id, currentUser.org_id);
  if (!patient) {
    throw new Error('Patient not found');
  }
  
  const rules = db.prepare('SELECT * FROM notification_rules WHERE is_active = 1').all();
  const triggeredNotifications = [];
  
  for (const rule of rules) {
    let conditions;
    try {
      conditions = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions;
    } catch (e) {
      continue;
    }
    
    if (rule.trigger_event !== event_type) continue;
    
    let shouldTrigger = true;
    
    if (conditions) {
      if (conditions.urgency_change && old_data) {
        const urgencyLevels = { low: 1, medium: 2, high: 3, critical: 4 };
        const oldLevel = urgencyLevels[old_data.medical_urgency] || 0;
        const newLevel = urgencyLevels[patient.medical_urgency] || 0;
        shouldTrigger = newLevel > oldLevel;
      }
      
      if (conditions.priority_threshold) {
        shouldTrigger = shouldTrigger && (patient.priority_score >= conditions.priority_threshold);
      }
      
      if (conditions.status_change && old_data) {
        shouldTrigger = shouldTrigger && (patient.waitlist_status !== old_data.waitlist_status);
      }
    }
    
    if (shouldTrigger) {
      const admins = db.prepare("SELECT * FROM users WHERE role = 'admin' AND org_id = ?").all(currentUser.org_id);
      
      for (const admin of admins) {
        let template;
        try {
          template = typeof rule.notification_template === 'string' 
            ? JSON.parse(rule.notification_template) 
            : rule.notification_template;
        } catch (e) {
          template = { title: rule.rule_name, message: rule.description };
        }
        
        const title = (template?.title || rule.rule_name)
          .replace('{patient_name}', `${patient.first_name} ${patient.last_name}`)
          .replace('{urgency}', patient.medical_urgency);
        
        const message = (template?.message || rule.description)
          .replace('{patient_name}', `${patient.first_name} ${patient.last_name}`)
          .replace('{urgency}', patient.medical_urgency)
          .replace('{priority_score}', patient.priority_score?.toFixed(1) || 'N/A');
        
        const notifId = uuidv4();
        db.prepare(`
          INSERT INTO notifications (
            id, recipient_email, title, message, notification_type,
            is_read, related_patient_id, related_patient_name, priority_level, action_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          notifId, admin.email, title, message, 'rule_triggered',
          0, patient.id, `${patient.first_name} ${patient.last_name}`,
          rule.priority_level, `/PatientDetails/${patient.id}`
        );
        
        triggeredNotifications.push({ id: notifId, rule: rule.rule_name, recipient: admin.email });
      }
    }
  }
  
  return {
    success: true,
    notifications_created: triggeredNotifications.length,
    notifications: triggeredNotifications
  };
}

async function exportWaitlist(params, context) {
  const { db, currentUser, logAudit } = context;
  const { format, filters } = params;
  
  let query = 'SELECT * FROM patients WHERE org_id = ? AND waitlist_status = ?';
  const queryParams = [currentUser.org_id, filters?.status || 'active'];
  
  if (filters?.organ_type) {
    query += ' AND organ_needed = ?';
    queryParams.push(filters.organ_type);
  }
  
  query += ' ORDER BY priority_score DESC';
  
  const patients = db.prepare(query).all(...queryParams);
  
  logAudit(
    'export',
    'Patient',
    null,
    null,
    `Waitlist exported: ${patients.length} patients, format: ${format}`,
    currentUser.email,
    currentUser.role
  );
  
  return {
    success: true,
    data: patients,
    count: patients.length,
    format
  };
}

async function importFHIRData(params, context) {
  const { db, currentUser, logAudit } = context;
  const { fhir_data, integration_id } = params;
  
  const importId = uuidv4();
  let recordsImported = 0;
  let recordsFailed = 0;
  const errors = [];
  
  try {
    const bundle = typeof fhir_data === 'string' ? JSON.parse(fhir_data) : fhir_data;
    
    if (bundle.resourceType !== 'Bundle') {
      throw new Error('Invalid FHIR data: Expected Bundle resource');
    }
    
    for (const entry of bundle.entry || []) {
      try {
        const resource = entry.resource;
        
        if (resource.resourceType === 'Patient') {
          const patientId = uuidv4();
          const name = resource.name?.[0] || {};
          
          db.prepare(`
            INSERT INTO patients (id, patient_id, first_name, last_name, date_of_birth, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            patientId,
            resource.identifier?.[0]?.value || `FHIR-${Date.now()}`,
            name.given?.[0] || 'Unknown',
            name.family || 'Unknown',
            resource.birthDate,
            currentUser.email
          );
          
          recordsImported++;
        }
      } catch (err) {
        recordsFailed++;
        errors.push({ entry: entry.fullUrl, error: err.message });
      }
    }
    
    db.prepare(`
      INSERT INTO ehr_imports (id, integration_id, import_type, status, records_imported, records_failed, error_details, created_by, completed_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      importId, integration_id, 'fhir', 'completed',
      recordsImported, recordsFailed, JSON.stringify(errors), currentUser.email
    );
    
    logAudit(
      'import',
      'EHRImport',
      importId,
      null,
      `FHIR import: ${recordsImported} imported, ${recordsFailed} failed`,
      currentUser.email,
      currentUser.role
    );
    
  } catch (err) {
    db.prepare(`
      INSERT INTO ehr_imports (id, integration_id, import_type, status, records_imported, records_failed, error_details, created_by, completed_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      importId, integration_id, 'fhir', 'failed',
      recordsImported, recordsFailed, JSON.stringify([{ error: err.message }]), currentUser.email
    );
    
    throw err;
  }
  
  return {
    success: true,
    import_id: importId,
    records_imported: recordsImported,
    records_failed: recordsFailed,
    errors,
    results: {
      processed: recordsImported + recordsFailed,
      created: recordsImported,
      updated: 0,
      failed: recordsFailed,
      errors
    }
  };
}

async function validateFHIRData(params, context) {
  const { db } = context;
  const { fhir_data } = params;
  
  const errors = [];
  const warnings = [];
  
  try {
    const bundle = typeof fhir_data === 'string' ? JSON.parse(fhir_data) : fhir_data;
    
    if (bundle.resourceType !== 'Bundle') {
      errors.push({ field: 'resourceType', message: 'Expected Bundle resource' });
      return { valid: false, errors, warnings };
    }
    
    if (!bundle.entry || bundle.entry.length === 0) {
      warnings.push({ message: 'Bundle contains no entries' });
    }
    
    const rules = db.prepare('SELECT * FROM ehr_validation_rules WHERE is_active = 1').all();
    
    for (const entry of bundle.entry || []) {
      const resource = entry.resource;
      
      if (resource.resourceType === 'Patient') {
        if (!resource.name || resource.name.length === 0) {
          errors.push({ resource: entry.fullUrl, field: 'name', message: 'Patient name is required' });
        }
        
        if (!resource.birthDate) {
          warnings.push({ resource: entry.fullUrl, field: 'birthDate', message: 'Birth date is recommended' });
        }
      }
    }
    
  } catch (err) {
    errors.push({ field: 'fhir_data', message: `Invalid JSON: ${err.message}` });
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

async function logError(params, context) {
  const { logAudit, currentUser } = context;
  const { message, stack, componentStack } = params;
  try {
    logAudit(
      'client_error', 'System', null, null,
      JSON.stringify({ message, stack: (stack || '').substring(0, 500), componentStack: (componentStack || '').substring(0, 500) }),
      currentUser?.email || 'unknown', currentUser?.role || 'unknown'
    );
  } catch {
    // Best effort - don't let error logging cause more errors
  }
  return { logged: true };
}

async function exportToFHIR(params, context) {
  const { db, currentUser, logAudit } = context;
  const { patient_id, resource_types } = params;

  if (!patient_id) {
    throw new Error('Missing required parameter: patient_id');
  }

  const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND org_id = ?').get(patient_id, currentUser.org_id);
  if (!patient) {
    throw new Error('Patient not found');
  }

  const fhirBundle = {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    meta: {
      lastUpdated: new Date().toISOString(),
      source: 'TransTrack'
    },
    entry: [],
  };

  // Patient resource
  const fhirPatient = {
    resourceType: 'Patient',
    id: patient.id,
    identifier: [
      {
        system: 'https://transtrack.app/patient-id',
        value: patient.patient_id
      }
    ],
    name: [
      {
        use: 'official',
        family: patient.last_name,
        given: [patient.first_name]
      }
    ],
    telecom: [
      ...(patient.phone ? [{ system: 'phone', value: patient.phone, use: 'home' }] : []),
      ...(patient.email ? [{ system: 'email', value: patient.email }] : [])
    ],
    birthDate: patient.date_of_birth,
    contact: patient.emergency_contact_name ? [
      {
        relationship: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0131',
                code: 'C',
                display: 'Emergency Contact'
              }
            ]
          }
        ],
        name: { text: patient.emergency_contact_name },
        telecom: patient.emergency_contact_phone
          ? [{ system: 'phone', value: patient.emergency_contact_phone }]
          : []
      }
    ] : []
  };

  fhirBundle.entry.push({
    fullUrl: `Patient/${patient.id}`,
    resource: fhirPatient
  });

  // Observation resources
  if (!resource_types || resource_types.includes('Observation')) {
    if (patient.blood_type) {
      fhirBundle.entry.push({
        fullUrl: `Observation/${patient.id}-bloodtype`,
        resource: {
          resourceType: 'Observation',
          id: `${patient.id}-bloodtype`,
          status: 'final',
          category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }] }],
          code: {
            coding: [{ system: 'http://loinc.org', code: '883-9', display: 'ABO group [Type] in Blood' }],
            text: 'Blood Type'
          },
          subject: { reference: `Patient/${patient.id}` },
          effectiveDateTime: patient.last_evaluation_date || new Date().toISOString(),
          valueCodeableConcept: {
            coding: [{ system: 'http://snomed.info/sct', code: patient.blood_type, display: patient.blood_type }],
            text: patient.blood_type
          }
        }
      });
    }

    if (patient.meld_score) {
      fhirBundle.entry.push({
        fullUrl: `Observation/${patient.id}-meld`,
        resource: {
          resourceType: 'Observation',
          id: `${patient.id}-meld`,
          status: 'final',
          category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'survey', display: 'Survey' }] }],
          code: {
            coding: [{ system: 'http://loinc.org', code: '88374-7', display: 'MELD score' }],
            text: 'MELD Score'
          },
          subject: { reference: `Patient/${patient.id}` },
          effectiveDateTime: patient.last_evaluation_date || new Date().toISOString(),
          valueInteger: Math.round(patient.meld_score)
        }
      });
    }

    if (patient.las_score) {
      fhirBundle.entry.push({
        fullUrl: `Observation/${patient.id}-las`,
        resource: {
          resourceType: 'Observation',
          id: `${patient.id}-las`,
          status: 'final',
          code: { text: 'Lung Allocation Score' },
          subject: { reference: `Patient/${patient.id}` },
          effectiveDateTime: patient.last_evaluation_date || new Date().toISOString(),
          valueQuantity: { value: patient.las_score, unit: 'score' }
        }
      });
    }

    if (patient.priority_score !== undefined && patient.priority_score !== null) {
      let breakdownNote = '';
      if (patient.priority_score_breakdown) {
        try {
          const bd = typeof patient.priority_score_breakdown === 'string'
            ? JSON.parse(patient.priority_score_breakdown)
            : patient.priority_score_breakdown;
          breakdownNote = `Breakdown: Medical Urgency=${bd.weighted_scores?.medical_urgency?.toFixed(1) || 'N/A'}, Time=${bd.weighted_scores?.time_on_waitlist?.toFixed(1) || 'N/A'}, Organ Score=${bd.weighted_scores?.organ_specific?.toFixed(1) || 'N/A'}`;
        } catch { breakdownNote = ''; }
      }

      fhirBundle.entry.push({
        fullUrl: `Observation/${patient.id}-priority`,
        resource: {
          resourceType: 'Observation',
          id: `${patient.id}-priority`,
          status: 'final',
          category: [{ coding: [{ system: 'https://transtrack.app/observation-category', code: 'transplant-priority', display: 'Transplant Priority' }] }],
          code: { text: 'Transplant Priority Score' },
          subject: { reference: `Patient/${patient.id}` },
          effectiveDateTime: patient.updated_at || new Date().toISOString(),
          valueQuantity: {
            value: patient.priority_score,
            unit: 'score',
            system: 'https://transtrack.app/priority-score',
            code: 'priority-score'
          },
          ...(breakdownNote ? { note: [{ text: breakdownNote }] } : {})
        }
      });
    }

    if (patient.hla_typing) {
      fhirBundle.entry.push({
        fullUrl: `Observation/${patient.id}-hla`,
        resource: {
          resourceType: 'Observation',
          id: `${patient.id}-hla`,
          status: 'final',
          code: { text: 'HLA Typing' },
          subject: { reference: `Patient/${patient.id}` },
          effectiveDateTime: patient.last_evaluation_date || new Date().toISOString(),
          valueString: patient.hla_typing
        }
      });
    }

    if (patient.weight_kg) {
      fhirBundle.entry.push({
        fullUrl: `Observation/${patient.id}-weight`,
        resource: {
          resourceType: 'Observation',
          id: `${patient.id}-weight`,
          status: 'final',
          code: {
            coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body weight' }],
            text: 'Body Weight'
          },
          subject: { reference: `Patient/${patient.id}` },
          valueQuantity: { value: patient.weight_kg, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' }
        }
      });
    }

    if (patient.height_cm) {
      fhirBundle.entry.push({
        fullUrl: `Observation/${patient.id}-height`,
        resource: {
          resourceType: 'Observation',
          id: `${patient.id}-height`,
          status: 'final',
          code: {
            coding: [{ system: 'http://loinc.org', code: '8302-2', display: 'Body height' }],
            text: 'Body Height'
          },
          subject: { reference: `Patient/${patient.id}` },
          valueQuantity: { value: patient.height_cm, unit: 'cm', system: 'http://unitsofmeasure.org', code: 'cm' }
        }
      });
    }
  }

  // Condition resources
  if (!resource_types || resource_types.includes('Condition')) {
    if (patient.diagnosis) {
      fhirBundle.entry.push({
        fullUrl: `Condition/${patient.id}-diagnosis`,
        resource: {
          resourceType: 'Condition',
          id: `${patient.id}-diagnosis`,
          clinicalStatus: {
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
              code: patient.waitlist_status === 'transplanted' ? 'resolved' : 'active',
              display: patient.waitlist_status === 'transplanted' ? 'Resolved' : 'Active'
            }]
          },
          verificationStatus: {
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
              code: 'confirmed',
              display: 'Confirmed'
            }]
          },
          category: [{
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/condition-category',
              code: 'encounter-diagnosis',
              display: 'Encounter Diagnosis'
            }]
          }],
          code: { text: patient.diagnosis },
          subject: { reference: `Patient/${patient.id}` },
          recordedDate: patient.created_at
        }
      });
    }

    fhirBundle.entry.push({
      fullUrl: `Condition/${patient.id}-waitlist`,
      resource: {
        resourceType: 'Condition',
        id: `${patient.id}-waitlist`,
        clinicalStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: patient.waitlist_status === 'active' ? 'active' : 'inactive',
            display: patient.waitlist_status === 'active' ? 'Active' : 'Inactive'
          }]
        },
        category: [{
          coding: [{
            system: 'https://transtrack.app/condition-category',
            code: 'transplant-waitlist',
            display: 'Transplant Waitlist'
          }]
        }],
        code: {
          text: `${patient.organ_needed} Transplant Waitlist - ${patient.waitlist_status}`
        },
        subject: { reference: `Patient/${patient.id}` },
        onsetDateTime: patient.date_added_to_waitlist,
        note: [{
          text: `Medical Urgency: ${patient.medical_urgency}, Priority Score: ${patient.priority_score?.toFixed(1) || 'N/A'}`
        }]
      }
    });
  }

  logAudit(
    'export',
    'Patient',
    patient_id,
    `${patient.first_name} ${patient.last_name}`,
    `FHIR R4 Bundle exported: ${fhirBundle.entry.length} resources`,
    currentUser.email,
    currentUser.role
  );

  return {
    success: true,
    data: {
      fhir_bundle: fhirBundle,
      resource_count: fhirBundle.entry.length
    }
  };
}

async function pushToEHR(params, context) {
  const { db, currentUser, logAudit } = context;
  const { patient_id, integration_id, fields_to_sync } = params;

  if (!patient_id) throw new Error('Missing required parameter: patient_id');
  if (!integration_id) throw new Error('Missing required parameter: integration_id');

  const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND org_id = ?').get(patient_id, currentUser.org_id);
  if (!patient) throw new Error('Patient not found');

  const integration = db.prepare('SELECT * FROM ehr_integrations WHERE id = ? AND org_id = ?').get(integration_id, currentUser.org_id);
  if (!integration) throw new Error('EHR integration not found');

  if (!integration.enable_bidirectional_sync) {
    throw new Error('Bidirectional sync not enabled for this integration');
  }

  const startTime = Date.now();
  const syncedFields = [];
  const errors = [];

  // Generate FHIR bundle via exportToFHIR
  const exportResult = await exportToFHIR({ patient_id, resource_types: ['Patient', 'Observation', 'Condition'] }, context);
  const fhirBundle = exportResult.data.fhir_bundle;

  const fieldsToSync = fields_to_sync || (
    integration.sync_fields_to_ehr
      ? (typeof integration.sync_fields_to_ehr === 'string' ? JSON.parse(integration.sync_fields_to_ehr) : integration.sync_fields_to_ehr)
      : []
  );

  if (fieldsToSync.length === 0) {
    throw new Error('No fields configured for sync');
  }

  const endpointUrl = integration.endpoint_url || integration.base_url;
  if (!endpointUrl) {
    throw new Error('No endpoint URL configured for this integration');
  }

  // Prepare auth headers
  const authHeaders = {
    'Content-Type': 'application/fhir+json',
    'Accept': 'application/fhir+json'
  };

  if (integration.api_key_encrypted) {
    if (integration.auth_type === 'basic_auth') {
      authHeaders['Authorization'] = `Basic ${integration.api_key_encrypted}`;
    } else {
      authHeaders['Authorization'] = `Bearer ${integration.api_key_encrypted}`;
    }
  }

  let ehrResponse;
  try {
    const pushResponse = await fetch(endpointUrl, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(fhirBundle),
      signal: AbortSignal.timeout(30000),
    });

    ehrResponse = {
      status: pushResponse.status,
      statusText: pushResponse.statusText,
      body: await pushResponse.text()
    };

    if (!pushResponse.ok) {
      errors.push(`EHR system returned ${pushResponse.status}: ${pushResponse.statusText}`);
    } else {
      syncedFields.push(...fieldsToSync);

      // Update integration export stats
      const totalExports = (integration.total_exports || 0) + 1;
      db.prepare(`
        UPDATE ehr_integrations SET total_exports = ?, last_export_date = datetime('now'), updated_at = datetime('now') WHERE id = ?
      `).run(totalExports, integration.id);
    }
  } catch (fetchError) {
    errors.push(`Network error: ${fetchError.message}`);
    ehrResponse = { error: fetchError.message };
  }

  const syncDuration = Date.now() - startTime;

  // Log to ehr_sync_logs
  const syncLogId = uuidv4();
  const orgId = currentUser.org_id || 'SYSTEM';
  db.prepare(`
    INSERT INTO ehr_sync_logs (
      id, org_id, integration_id, sync_direction, patient_id, patient_name,
      fhir_resource_type, fields_synced, status, error_message, ehr_response,
      triggered_by, sync_duration_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    syncLogId, orgId, integration.id, 'outbound', patient.id,
    `${patient.first_name} ${patient.last_name}`,
    'Bundle', JSON.stringify(syncedFields),
    errors.length === 0 ? 'success' : 'failed',
    errors.join('; ') || null,
    JSON.stringify(ehrResponse), 'manual', syncDuration
  );

  logAudit(
    'update',
    'Patient',
    patient.id,
    `${patient.first_name} ${patient.last_name}`,
    `Data pushed to EHR ${integration.integration_name || integration.name}: ${syncedFields.length} fields synced`,
    currentUser.email,
    currentUser.role
  );

  return {
    success: errors.length === 0,
    data: {
      success: errors.length === 0,
      synced_fields: syncedFields,
      errors,
      sync_log_id: syncLogId,
      ehr_response: ehrResponse
    }
  };
}

async function fhirWebhook(params, context) {
  const { db, currentUser, logAudit } = context;
  const { payload, webhook_secret } = params;

  if (!payload || !payload.resourceType) {
    throw new Error('Invalid FHIR resource: missing resourceType');
  }

  const results = {
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: []
  };

  if (payload.resourceType === 'Bundle') {
    const entries = payload.entry || [];

    for (const entry of entries) {
      if (entry.resource?.resourceType === 'Patient') {
        results.processed++;

        try {
          const fhirPatient = entry.resource;
          const patientIdValue = fhirPatient.identifier?.[0]?.value || `FHIR-${Date.now()}`;
          const firstName = fhirPatient.name?.[0]?.given?.[0] || 'Unknown';
          const lastName = fhirPatient.name?.[0]?.family || 'Unknown';
          const dob = fhirPatient.birthDate || null;
          const phone = fhirPatient.telecom?.find(t => t.system === 'phone')?.value || null;
          const email = fhirPatient.telecom?.find(t => t.system === 'email')?.value || null;

          const orgId = currentUser.org_id || 'SYSTEM';
          const existing = db.prepare('SELECT * FROM patients WHERE patient_id = ? AND org_id = ?').all(patientIdValue, orgId);

          if (existing.length > 0) {
            db.prepare(`
              UPDATE patients SET first_name = ?, last_name = ?, date_of_birth = ?,
                phone = COALESCE(?, phone), email = COALESCE(?, email), updated_at = datetime('now')
              WHERE id = ?
            `).run(firstName, lastName, dob, phone, email, existing[0].id);
            results.updated++;
          } else {
            const newId = uuidv4();
            db.prepare(`
              INSERT INTO patients (id, org_id, patient_id, first_name, last_name, date_of_birth, phone, email, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(newId, orgId, patientIdValue, firstName, lastName, dob, phone, email, currentUser.email);
            results.created++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push({ patient: entry.fullUrl, error: error.message });
        }
      }
    }
  }

  logAudit(
    'import',
    'FHIRWebhook',
    null,
    null,
    `FHIR webhook processed: ${results.created} created, ${results.updated} updated, ${results.failed} failed`,
    currentUser.email,
    currentUser.role
  );

  return {
    success: true,
    data: {
      message: 'FHIR webhook processed',
      results
    }
  };
}

module.exports = {
  calculatePriorityAdvanced,
  calculatePriority: calculatePriorityAdvanced,
  matchDonorAdvanced,
  matchDonor: matchDonorAdvanced,
  checkNotificationRules,
  exportWaitlist,
  importFHIRData,
  validateFHIRData,
  logError,
  exportToFHIR,
  pushToEHR,
  fhirWebhook
};
