import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const api = createClientFromRequest(req);
    
    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id } = await req.json();

    const patient = await api.entities.Patient.get(patient_id);

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Get active priority weights configuration
    const allWeights = await api.entities.PriorityWeights.filter({ is_active: true });
    const weights = allWeights.length > 0 ? allWeights[0] : {
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
      // Score increases with time, max 100 at 730 days (2 years)
      timeScore = Math.min(100, (daysOnList / 730) * 100);
      
      // Bonus for very long waits (>3 years)
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
      // MELD score (6-40) maps to 0-100
      organScore = ((patient.meld_score - 6) / 34) * 100;
      breakdown.components.organ_specific = {
        type: 'MELD',
        score: patient.meld_score,
        normalized: organScore
      };
    } else if (patient.organ_needed === 'lung' && patient.las_score) {
      // LAS score (0-100) maps directly
      organScore = patient.las_score;
      breakdown.components.organ_specific = {
        type: 'LAS',
        score: patient.las_score,
        normalized: organScore
      };
    } else if (patient.organ_needed === 'kidney') {
      // For kidney, consider PRA/CPRA
      let kidneyScore = 50; // base
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
      // Default based on urgency
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
      
      // Base score: recent evaluation is good
      if (daysSinceEval <= 90) {
        evaluationScore = 100;
      } else {
        // Apply exponential decay
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
    
    // Comorbidity penalty
    let comorbidityPenalty = 0;
    if (patient.comorbidity_score) {
      comorbidityPenalty = (patient.comorbidity_score / 10) * 10; // Max -10 points
      breakdown.components.comorbidity_adjustment = {
        score: patient.comorbidity_score,
        penalty: -comorbidityPenalty
      };
    }
    
    // Previous transplant adjustment
    let previousTransplantAdjustment = 0;
    if (patient.previous_transplants > 0) {
      // Slight penalty for re-transplants due to complexity
      previousTransplantAdjustment = -5 * patient.previous_transplants;
      breakdown.components.previous_transplants = {
        count: patient.previous_transplants,
        adjustment: previousTransplantAdjustment
      };
    }
    
    // Compliance bonus
    let complianceBonus = 0;
    if (patient.compliance_score) {
      complianceBonus = (patient.compliance_score / 10) * 5; // Max +5 points
      breakdown.components.compliance_bonus = {
        score: patient.compliance_score,
        bonus: complianceBonus
      };
    }

    // Calculate weighted scores
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

    // Calculate final score
    let finalScore = Object.values(breakdown.weighted_scores).reduce((sum, val) => sum + val, 0);
    
    // Apply adjustments
    finalScore = finalScore - comorbidityPenalty + previousTransplantAdjustment + complianceBonus;
    finalScore = Math.min(100, Math.max(0, finalScore));

    breakdown.total = finalScore;
    breakdown.weights_used = weights;
    breakdown.adjustments = {
      comorbidity_penalty: -comorbidityPenalty,
      previous_transplant_adjustment: previousTransplantAdjustment,
      compliance_bonus: complianceBonus
    };

    // Update patient with new priority score and breakdown
    await api.entities.Patient.update(patient_id, {
      priority_score: finalScore,
      priority_score_breakdown: breakdown
    });

    // Log the calculation
    await api.entities.AuditLog.create({
      action: 'update',
      entity_type: 'Patient',
      entity_id: patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      details: `Advanced priority score calculated: ${finalScore.toFixed(1)} (Medical: ${breakdown.weighted_scores.medical_urgency.toFixed(1)}, Time: ${breakdown.weighted_scores.time_on_waitlist.toFixed(1)}, Organ: ${breakdown.weighted_scores.organ_specific.toFixed(1)})`,
      user_email: user.email,
      user_role: user.role,
    });

    return Response.json({
      success: true,
      priority_score: finalScore,
      breakdown,
      patient_id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});