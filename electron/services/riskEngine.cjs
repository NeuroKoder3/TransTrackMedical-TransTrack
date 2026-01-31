/**
 * TransTrack - Operational Risk Intelligence Engine
 * 
 * Continuously evaluates transplant waitlist and workflows to surface
 * latent OPERATIONAL risks (not clinical risks).
 * 
 * Risk Categories:
 * - Documentation delays
 * - Expiring testing/evaluations
 * - Coordinator overload
 * - Status churn
 * - Fragile coordination handoffs
 */

const { getDatabase } = require('../database/init.cjs');
const readinessBarriers = require('./readinessBarriers.cjs');
const ahhqService = require('./ahhqService.cjs');

// Risk thresholds (configurable)
const RISK_THRESHOLDS = {
  // Days before evaluation expires to flag as at-risk
  EVALUATION_EXPIRY_WARNING_DAYS: 30,
  EVALUATION_EXPIRY_CRITICAL_DAYS: 14,
  
  // Status changes in last 30 days to flag as churn
  STATUS_CHURN_WARNING: 3,
  STATUS_CHURN_CRITICAL: 5,
  
  // Days without documentation update
  DOCUMENTATION_STALE_WARNING_DAYS: 60,
  DOCUMENTATION_STALE_CRITICAL_DAYS: 90,
  
  // Patients per coordinator threshold
  COORDINATOR_LOAD_WARNING: 25,
  COORDINATOR_LOAD_CRITICAL: 40,
  
  // Readiness window shrinking (days)
  READINESS_SHRINKING_THRESHOLD: 7,
};

// Risk levels
const RISK_LEVEL = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none',
};

/**
 * Main risk assessment for a single patient
 */
function assessPatientOperationalRisk(patient) {
  const risks = [];
  const now = new Date();
  
  // 1. Evaluation Expiry Risk
  if (patient.last_evaluation_date) {
    const evalDate = new Date(patient.last_evaluation_date);
    const daysSinceEval = Math.floor((now - evalDate) / (1000 * 60 * 60 * 24));
    const daysUntilExpiry = 365 - daysSinceEval; // Assume annual evaluations
    
    if (daysUntilExpiry <= RISK_THRESHOLDS.EVALUATION_EXPIRY_CRITICAL_DAYS) {
      risks.push({
        type: 'evaluation_expiring',
        level: RISK_LEVEL.CRITICAL,
        title: 'Evaluation Expiring Soon',
        description: `Patient evaluation expires in ${daysUntilExpiry} days`,
        daysRemaining: daysUntilExpiry,
        actionRequired: 'Schedule re-evaluation immediately',
      });
    } else if (daysUntilExpiry <= RISK_THRESHOLDS.EVALUATION_EXPIRY_WARNING_DAYS) {
      risks.push({
        type: 'evaluation_expiring',
        level: RISK_LEVEL.HIGH,
        title: 'Evaluation Expiring',
        description: `Patient evaluation expires in ${daysUntilExpiry} days`,
        daysRemaining: daysUntilExpiry,
        actionRequired: 'Schedule re-evaluation',
      });
    }
  } else {
    risks.push({
      type: 'no_evaluation',
      level: RISK_LEVEL.HIGH,
      title: 'No Evaluation on Record',
      description: 'Patient has no evaluation date recorded',
      actionRequired: 'Document evaluation date or schedule evaluation',
    });
  }
  
  // 2. Documentation Staleness Risk
  const lastUpdate = patient.updated_at ? new Date(patient.updated_at) : null;
  if (lastUpdate) {
    const daysSinceUpdate = Math.floor((now - lastUpdate) / (1000 * 60 * 60 * 24));
    
    if (daysSinceUpdate >= RISK_THRESHOLDS.DOCUMENTATION_STALE_CRITICAL_DAYS) {
      risks.push({
        type: 'documentation_stale',
        level: RISK_LEVEL.HIGH,
        title: 'Documentation Critically Outdated',
        description: `No updates in ${daysSinceUpdate} days`,
        daysSinceUpdate,
        actionRequired: 'Review and update patient documentation',
      });
    } else if (daysSinceUpdate >= RISK_THRESHOLDS.DOCUMENTATION_STALE_WARNING_DAYS) {
      risks.push({
        type: 'documentation_stale',
        level: RISK_LEVEL.MEDIUM,
        title: 'Documentation May Be Outdated',
        description: `No updates in ${daysSinceUpdate} days`,
        daysSinceUpdate,
        actionRequired: 'Consider reviewing patient documentation',
      });
    }
  }
  
  // 3. Incomplete Critical Data Risk
  const missingFields = [];
  if (!patient.blood_type) missingFields.push('Blood Type');
  if (!patient.hla_typing) missingFields.push('HLA Typing');
  if (!patient.date_added_to_waitlist) missingFields.push('Waitlist Date');
  if (!patient.medical_urgency) missingFields.push('Medical Urgency');
  
  if (missingFields.length > 0) {
    risks.push({
      type: 'incomplete_data',
      level: missingFields.length >= 3 ? RISK_LEVEL.HIGH : RISK_LEVEL.MEDIUM,
      title: 'Missing Critical Data',
      description: `Missing: ${missingFields.join(', ')}`,
      missingFields,
      actionRequired: 'Complete patient data entry',
    });
  }
  
  // 4. Inactivity Risk (for active patients)
  if (patient.waitlist_status === 'active') {
    // Check for factors that might lead to becoming inactive
    const inactivityRisks = [];
    
    if (patient.compliance_score && patient.compliance_score < 5) {
      inactivityRisks.push('Low compliance score');
    }
    if (patient.comorbidity_score && patient.comorbidity_score > 7) {
      inactivityRisks.push('High comorbidity burden');
    }
    
    if (inactivityRisks.length > 0) {
      risks.push({
        type: 'inactivity_risk',
        level: RISK_LEVEL.MEDIUM,
        title: 'Risk of Becoming Inactive',
        description: inactivityRisks.join('; '),
        factors: inactivityRisks,
        actionRequired: 'Monitor closely and address risk factors',
      });
    }
  }
  
  // 5. Readiness Barriers Risk (Non-Clinical)
  // NOTE: These are operational workflow barriers only, NOT clinical assessments
  try {
    const barrierSummary = readinessBarriers.getPatientBarrierSummary(patient.id);
    
    if (barrierSummary.totalOpen > 0) {
      let barrierRiskLevel = RISK_LEVEL.LOW;
      let title = 'Readiness Barrier';
      
      // Determine risk level based on barrier count and severity
      if (barrierSummary.byRiskLevel.high > 0) {
        barrierRiskLevel = RISK_LEVEL.HIGH;
        title = 'High-Risk Readiness Barriers';
      } else if (barrierSummary.totalOpen >= 3 || barrierSummary.byRiskLevel.moderate > 0) {
        barrierRiskLevel = RISK_LEVEL.MEDIUM;
        title = 'Multiple Readiness Barriers';
      }
      
      // Build description of barrier types
      const barrierTypes = barrierSummary.barriers.map(b => 
        readinessBarriers.BARRIER_TYPES[b.barrier_type]?.label || b.barrier_type
      );
      const uniqueTypes = [...new Set(barrierTypes)];
      
      risks.push({
        type: 'readiness_barriers',
        level: barrierRiskLevel,
        title: title,
        description: `${barrierSummary.totalOpen} open barrier(s): ${uniqueTypes.slice(0, 3).join(', ')}${uniqueTypes.length > 3 ? '...' : ''}`,
        barrierCount: barrierSummary.totalOpen,
        highRiskCount: barrierSummary.byRiskLevel.high,
        moderateRiskCount: barrierSummary.byRiskLevel.moderate,
        actionRequired: 'Review and resolve readiness barriers',
        isNonClinical: true, // Flag to indicate this is operational, not clinical
      });
    }
  } catch (e) {
    // Silently continue if barriers table doesn't exist yet
    console.log('Could not assess readiness barriers:', e.message);
  }
  
  // 6. Adult Health History Questionnaire (aHHQ) Status Risk
  // NOTE: This is OPERATIONAL DOCUMENTATION tracking only, NOT clinical assessment.
  // It tracks whether required health history questionnaires are present, complete, and current.
  try {
    const ahhqSummary = ahhqService.getPatientAHHQSummary(patient.id);
    
    if (ahhqSummary.needsAttention) {
      let ahhqRiskLevel = RISK_LEVEL.LOW;
      let title = 'aHHQ Status';
      
      if (!ahhqSummary.exists) {
        ahhqRiskLevel = RISK_LEVEL.HIGH;
        title = 'aHHQ Missing';
      } else if (ahhqSummary.riskLevel === 'high') {
        ahhqRiskLevel = RISK_LEVEL.HIGH;
        title = ahhqSummary.ahhq?.status === 'expired' ? 'aHHQ Expired' : 'aHHQ Incomplete';
      } else if (ahhqSummary.riskLevel === 'medium') {
        ahhqRiskLevel = RISK_LEVEL.MEDIUM;
        title = 'aHHQ Attention Needed';
      }
      
      risks.push({
        type: 'ahhq_status',
        level: ahhqRiskLevel,
        title: title,
        description: ahhqSummary.riskDescription,
        status: ahhqSummary.status,
        daysUntilExpiration: ahhqSummary.daysUntilExpiration,
        actionRequired: ahhqSummary.exists 
          ? 'Review and update aHHQ documentation'
          : 'Create aHHQ record for patient',
        isNonClinical: true, // Flag to indicate this is operational documentation, not clinical
        isDocumentationArtifact: true,
      });
    }
  } catch (e) {
    // Silently continue if aHHQ table doesn't exist yet
    console.log('Could not assess aHHQ status:', e.message);
  }
  
  // Calculate overall risk level
  let overallLevel = RISK_LEVEL.NONE;
  if (risks.some(r => r.level === RISK_LEVEL.CRITICAL)) {
    overallLevel = RISK_LEVEL.CRITICAL;
  } else if (risks.some(r => r.level === RISK_LEVEL.HIGH)) {
    overallLevel = RISK_LEVEL.HIGH;
  } else if (risks.some(r => r.level === RISK_LEVEL.MEDIUM)) {
    overallLevel = RISK_LEVEL.MEDIUM;
  } else if (risks.length > 0) {
    overallLevel = RISK_LEVEL.LOW;
  }
  
  return {
    patientId: patient.id,
    patientName: `${patient.first_name} ${patient.last_name}`,
    patientMRN: patient.patient_id,
    overallRiskLevel: overallLevel,
    riskCount: risks.length,
    risks,
    assessedAt: now.toISOString(),
  };
}

/**
 * Analyze waitlist segment for operational patterns
 */
function analyzeWaitlistSegment(patients, segmentName) {
  const analysis = {
    segmentName,
    totalPatients: patients.length,
    findings: [],
  };
  
  if (patients.length === 0) return analysis;
  
  // 1. Status Churn Analysis
  // (In a real system, this would query status change history)
  const activePatients = patients.filter(p => p.waitlist_status === 'active');
  const inactivePatients = patients.filter(p => p.waitlist_status !== 'active');
  const inactiveRate = (inactivePatients.length / patients.length) * 100;
  
  if (inactiveRate > 30) {
    analysis.findings.push({
      type: 'high_inactive_rate',
      level: RISK_LEVEL.HIGH,
      title: 'High Inactive Rate in Segment',
      description: `${inactiveRate.toFixed(1)}% of patients are inactive`,
      metric: inactiveRate,
      recommendation: 'Review segment for systemic issues',
    });
  }
  
  // 2. Readiness Window Analysis
  const now = new Date();
  const patientsNearEvalExpiry = patients.filter(p => {
    if (!p.last_evaluation_date) return true;
    const evalDate = new Date(p.last_evaluation_date);
    const daysSince = Math.floor((now - evalDate) / (1000 * 60 * 60 * 24));
    return (365 - daysSince) <= 30;
  });
  
  const expiryRate = (patientsNearEvalExpiry.length / patients.length) * 100;
  if (expiryRate > 20) {
    analysis.findings.push({
      type: 'shrinking_readiness',
      level: RISK_LEVEL.HIGH,
      title: 'Shrinking Readiness Windows',
      description: `${expiryRate.toFixed(1)}% of patients have evaluations expiring within 30 days`,
      patientsAffected: patientsNearEvalExpiry.length,
      recommendation: 'Prioritize re-evaluations for this segment',
    });
  }
  
  // 3. Documentation Gap Analysis
  const patientsWithStaleData = patients.filter(p => {
    if (!p.updated_at) return true;
    const updateDate = new Date(p.updated_at);
    const daysSince = Math.floor((now - updateDate) / (1000 * 60 * 60 * 24));
    return daysSince > 60;
  });
  
  const staleRate = (patientsWithStaleData.length / patients.length) * 100;
  if (staleRate > 25) {
    analysis.findings.push({
      type: 'documentation_gap',
      level: RISK_LEVEL.MEDIUM,
      title: 'Documentation Gaps Detected',
      description: `${staleRate.toFixed(1)}% of patients have outdated documentation`,
      patientsAffected: patientsWithStaleData.length,
      recommendation: 'Schedule documentation review for segment',
    });
  }
  
  // 4. Priority Distribution Analysis
  const priorityDistribution = {
    critical: patients.filter(p => (p.priority_score || 0) >= 80).length,
    high: patients.filter(p => (p.priority_score || 0) >= 60 && (p.priority_score || 0) < 80).length,
    medium: patients.filter(p => (p.priority_score || 0) >= 40 && (p.priority_score || 0) < 60).length,
    low: patients.filter(p => (p.priority_score || 0) < 40).length,
  };
  
  analysis.priorityDistribution = priorityDistribution;
  
  // Flag if too many critical patients
  const criticalRate = (priorityDistribution.critical / patients.length) * 100;
  if (criticalRate > 15) {
    analysis.findings.push({
      type: 'high_acuity_segment',
      level: RISK_LEVEL.HIGH,
      title: 'High Acuity Concentration',
      description: `${criticalRate.toFixed(1)}% of segment is critical priority`,
      recommendation: 'Review resource allocation for high-acuity care',
    });
  }
  
  return analysis;
}

/**
 * Generate full operational risk report
 */
async function generateOperationalRiskReport() {
  const db = getDatabase();
  
  const patients = db.prepare('SELECT * FROM patients WHERE waitlist_status = ?').all('active');
  
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalActivePatients: patients.length,
      criticalRiskPatients: 0,
      highRiskPatients: 0,
      mediumRiskPatients: 0,
      lowRiskPatients: 0,
      patientsWithBarriers: 0,
    },
    patientRisks: [],
    segmentAnalysis: [],
    barrierAnalysis: null,
    actionItems: [],
  };
  
  // Assess each patient
  for (const patient of patients) {
    const assessment = assessPatientOperationalRisk(patient);
    report.patientRisks.push(assessment);
    
    // Check if patient has readiness barriers
    if (assessment.risks.some(r => r.type === 'readiness_barriers')) {
      report.summary.patientsWithBarriers++;
    }
    
    // Update summary counts
    switch (assessment.overallRiskLevel) {
      case RISK_LEVEL.CRITICAL:
        report.summary.criticalRiskPatients++;
        break;
      case RISK_LEVEL.HIGH:
        report.summary.highRiskPatients++;
        break;
      case RISK_LEVEL.MEDIUM:
        report.summary.mediumRiskPatients++;
        break;
      case RISK_LEVEL.LOW:
        report.summary.lowRiskPatients++;
        break;
    }
  }
  
  // Analyze by organ type
  const organTypes = [...new Set(patients.map(p => p.organ_needed).filter(Boolean))];
  for (const organType of organTypes) {
    const segmentPatients = patients.filter(p => p.organ_needed === organType);
    const analysis = analyzeWaitlistSegment(segmentPatients, `Organ: ${organType}`);
    report.segmentAnalysis.push(analysis);
  }
  
  // Analyze by blood type
  const bloodTypes = [...new Set(patients.map(p => p.blood_type).filter(Boolean))];
  for (const bloodType of bloodTypes) {
    const segmentPatients = patients.filter(p => p.blood_type === bloodType);
    const analysis = analyzeWaitlistSegment(segmentPatients, `Blood Type: ${bloodType}`);
    report.segmentAnalysis.push(analysis);
  }
  
  // Add barrier analysis (Non-Clinical)
  try {
    const barrierDashboard = readinessBarriers.getBarriersDashboard();
    report.barrierAnalysis = {
      disclaimer: 'Readiness barriers are NON-CLINICAL operational tracking items only. They do not affect allocation decisions or replace UNOS/OPTN systems.',
      totalOpenBarriers: barrierDashboard.totalOpenBarriers,
      patientsWithBarriers: barrierDashboard.patientsWithBarriers,
      patientsWithBarriersPercentage: barrierDashboard.patientsWithBarriersPercentage,
      overdueBarriers: barrierDashboard.overdueBarriers,
      byType: barrierDashboard.byType,
      byRiskLevel: barrierDashboard.byRiskLevel,
      byOwningRole: barrierDashboard.byOwningRole,
      topBarrierPatients: barrierDashboard.topBarrierPatients,
    };
  } catch (e) {
    console.log('Could not generate barrier analysis:', e.message);
  }
  
  // Add aHHQ analysis (Non-Clinical Documentation Tracking)
  try {
    const ahhqDashboard = ahhqService.getAHHQDashboard();
    const patientsWithIssues = ahhqService.getPatientsWithAHHQIssues(10);
    
    report.ahhqAnalysis = {
      disclaimer: 'aHHQ tracking is NON-CLINICAL operational documentation only. It tracks whether required health history questionnaires are present, complete, and current. It does NOT store medical narratives, perform clinical interpretation, or affect allocation decisions.',
      totalPatients: ahhqDashboard.totalPatients,
      patientsWithAHHQ: ahhqDashboard.patientsWithAHHQ,
      patientsWithoutAHHQ: ahhqDashboard.patientsWithoutAHHQ,
      completeCount: ahhqDashboard.completeCount,
      incompleteCount: ahhqDashboard.incompleteCount,
      expiringCount: ahhqDashboard.expiringCount,
      expiredCount: ahhqDashboard.expiredCount,
      patientsNeedingAttention: ahhqDashboard.patientsNeedingAttention,
      patientsNeedingAttentionPercentage: ahhqDashboard.patientsNeedingAttentionPercentage,
      byStatus: ahhqDashboard.byStatus,
      byOwningRole: ahhqDashboard.byOwningRole,
      topPatientsWithIssues: patientsWithIssues,
    };
  } catch (e) {
    console.log('Could not generate aHHQ analysis:', e.message);
  }
  
  // Generate prioritized action items
  const criticalPatients = report.patientRisks
    .filter(r => r.overallRiskLevel === RISK_LEVEL.CRITICAL)
    .sort((a, b) => b.riskCount - a.riskCount);
  
  for (const patient of criticalPatients.slice(0, 10)) {
    for (const risk of patient.risks.filter(r => r.level === RISK_LEVEL.CRITICAL)) {
      report.actionItems.push({
        priority: 'URGENT',
        patient: patient.patientName,
        patientId: patient.patientId,
        issue: risk.title,
        action: risk.actionRequired,
        isNonClinical: risk.isNonClinical || false,
      });
    }
  }
  
  // Add high-risk barrier action items
  if (report.barrierAnalysis && report.barrierAnalysis.topBarrierPatients) {
    for (const patient of report.barrierAnalysis.topBarrierPatients.slice(0, 5)) {
      if (patient.highRiskCount > 0) {
        report.actionItems.push({
          priority: 'HIGH',
          patient: patient.patientName,
          patientId: patient.patientId,
          issue: `${patient.highRiskCount} high-risk readiness barrier(s)`,
          action: 'Review and resolve readiness barriers',
          isNonClinical: true,
        });
      }
    }
  }
  
  // Add segment-level action items
  for (const segment of report.segmentAnalysis) {
    for (const finding of segment.findings.filter(f => f.level === RISK_LEVEL.HIGH)) {
      report.actionItems.push({
        priority: 'HIGH',
        segment: segment.segmentName,
        issue: finding.title,
        action: finding.recommendation,
      });
    }
  }
  
  return report;
}

/**
 * Get risk dashboard summary
 */
async function getRiskDashboard() {
  const db = getDatabase();
  
  const patients = db.prepare('SELECT * FROM patients WHERE waitlist_status = ?').all('active');
  
  const now = new Date();
  
  // Quick metrics
  const metrics = {
    evaluationsExpiringSoon: 0,
    staleDocumentation: 0,
    incompleteRecords: 0,
    highChurnPatients: 0,
    patientsWithBarriers: 0,
    totalOpenBarriers: 0,
    // aHHQ metrics
    ahhqExpiring: 0,
    ahhqExpired: 0,
    ahhqIncomplete: 0,
    ahhqMissing: 0,
  };
  
  const atRiskPatients = [];
  
  // Get barrier dashboard for overall metrics
  let barrierDashboard = null;
  try {
    barrierDashboard = readinessBarriers.getBarriersDashboard();
    metrics.patientsWithBarriers = barrierDashboard.patientsWithBarriers;
    metrics.totalOpenBarriers = barrierDashboard.totalOpenBarriers;
  } catch (e) {
    console.log('Could not get barrier dashboard:', e.message);
  }
  
  // Get aHHQ dashboard for overall metrics
  let ahhqDashboard = null;
  try {
    ahhqDashboard = ahhqService.getAHHQDashboard();
    metrics.ahhqExpiring = ahhqDashboard.expiringCount;
    metrics.ahhqExpired = ahhqDashboard.expiredCount;
    metrics.ahhqIncomplete = ahhqDashboard.incompleteCount;
    metrics.ahhqMissing = ahhqDashboard.patientsWithoutAHHQ;
  } catch (e) {
    console.log('Could not get aHHQ dashboard:', e.message);
  }
  
  for (const patient of patients) {
    const risks = [];
    let barrierCount = 0;
    
    // Check evaluation expiry
    if (patient.last_evaluation_date) {
      const evalDate = new Date(patient.last_evaluation_date);
      const daysSince = Math.floor((now - evalDate) / (1000 * 60 * 60 * 24));
      if ((365 - daysSince) <= 30) {
        metrics.evaluationsExpiringSoon++;
        risks.push('Evaluation expiring');
      }
    }
    
    // Check documentation staleness
    if (patient.updated_at) {
      const updateDate = new Date(patient.updated_at);
      const daysSince = Math.floor((now - updateDate) / (1000 * 60 * 60 * 24));
      if (daysSince > 60) {
        metrics.staleDocumentation++;
        risks.push('Stale documentation');
      }
    }
    
    // Check incomplete records
    if (!patient.blood_type || !patient.hla_typing || !patient.medical_urgency) {
      metrics.incompleteRecords++;
      risks.push('Incomplete data');
    }
    
    // Check readiness barriers (non-clinical)
    try {
      const barrierSummary = readinessBarriers.getPatientBarrierSummary(patient.id);
      if (barrierSummary.totalOpen > 0) {
        barrierCount = barrierSummary.totalOpen;
        risks.push(`${barrierCount} readiness barrier(s)`);
      }
    } catch (e) {
      // Silently continue
    }
    
    if (risks.length > 0) {
      atRiskPatients.push({
        id: patient.id,
        name: `${patient.first_name} ${patient.last_name}`,
        mrn: patient.patient_id,
        risks,
        riskCount: risks.length,
        barrierCount,
      });
    }
  }
  
  // Sort by risk count
  atRiskPatients.sort((a, b) => b.riskCount - a.riskCount);
  
  return {
    metrics,
    totalActive: patients.length,
    atRiskCount: atRiskPatients.length,
    atRiskPercentage: patients.length > 0 ? ((atRiskPatients.length / patients.length) * 100).toFixed(1) : '0.0',
    topAtRiskPatients: atRiskPatients.slice(0, 10),
    barrierSummary: barrierDashboard ? {
      patientsWithBarriers: barrierDashboard.patientsWithBarriers,
      patientsWithBarriersPercentage: barrierDashboard.patientsWithBarriersPercentage,
      totalOpenBarriers: barrierDashboard.totalOpenBarriers,
      byRiskLevel: barrierDashboard.byRiskLevel,
      byType: barrierDashboard.byType,
    } : null,
    // aHHQ Summary (Non-Clinical Documentation Tracking)
    ahhqSummary: ahhqDashboard ? {
      disclaimer: 'aHHQ tracking is NON-CLINICAL operational documentation only. It does not store medical narratives, perform clinical interpretation, or affect allocation decisions.',
      totalPatients: ahhqDashboard.totalPatients,
      patientsWithAHHQ: ahhqDashboard.patientsWithAHHQ,
      patientsWithoutAHHQ: ahhqDashboard.patientsWithoutAHHQ,
      completeCount: ahhqDashboard.completeCount,
      incompleteCount: ahhqDashboard.incompleteCount,
      expiringCount: ahhqDashboard.expiringCount,
      expiredCount: ahhqDashboard.expiredCount,
      patientsNeedingAttention: ahhqDashboard.patientsNeedingAttention,
      patientsNeedingAttentionPercentage: ahhqDashboard.patientsNeedingAttentionPercentage,
      byStatus: ahhqDashboard.byStatus,
      byOwningRole: ahhqDashboard.byOwningRole,
      warningThresholdDays: ahhqDashboard.warningThresholdDays,
    } : null,
    generatedAt: now.toISOString(),
  };
}

module.exports = {
  RISK_THRESHOLDS,
  RISK_LEVEL,
  assessPatientOperationalRisk,
  analyzeWaitlistSegment,
  generateOperationalRiskReport,
  getRiskDashboard,
};
