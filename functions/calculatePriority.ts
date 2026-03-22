import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';
import {
  PRIORITY_SCORING,
  URGENCY_SCORES,
  BLOOD_TYPE_RARITY,
} from './lib/constants.ts';
import {
  isValidUUID,
  validatePatientMedicalScores,
} from './lib/validators.ts';
import { createLogger, generateRequestId, safeErrorResponse } from './lib/logger.ts';
import { createHIPAAAuditLog } from './lib/audit.ts';

const logger = createLogger('calculatePriority');

Deno.serve(async (req) => {
  const requestId = generateRequestId();

  try {
    const api = createClientFromRequest(req);

    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { patient_id } = body;

    if (!patient_id || !isValidUUID(patient_id)) {
      return Response.json(
        { error: 'Invalid or missing patient_id. Must be a valid UUID.' },
        { status: 400 }
      );
    }

    const patient = await api.entities.Patient.get(patient_id);

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Validate medical scores before using them in calculations
    const validation = validatePatientMedicalScores(patient);
    if (!validation.valid) {
      logger.warn('Patient has invalid medical score data', {
        patient_id,
        validation_errors: validation.errors,
        request_id: requestId,
      });

      await createHIPAAAuditLog(api, {
        action: 'CALCULATE',
        entityType: 'Patient',
        entityId: patient_id,
        patientName: `${patient.first_name} ${patient.last_name}`,
        details: `Priority calculation rejected: ${validation.errors.join('; ')}`,
        user: { email: user.email, role: user.role },
        outcome: 'FAILURE',
        errorMessage: validation.errors.join('; '),
        requestId,
      });

      return Response.json(
        { error: 'Patient has invalid medical data', validation_errors: validation.errors },
        { status: 422 }
      );
    }

    // Priority Scoring Algorithm
    let score = 0;

    // 1. Medical Urgency Weight (0-30 points)
    score += URGENCY_SCORES[patient.medical_urgency] || URGENCY_SCORES.medium;

    // 2. Time on Waitlist (0-25 points)
    if (patient.date_added_to_waitlist) {
      const daysOnList = Math.floor(
        (Date.now() - new Date(patient.date_added_to_waitlist).getTime()) / (1000 * 60 * 60 * 24)
      );
      score += Math.min(
        PRIORITY_SCORING.MAX_WAITTIME_POINTS,
        Math.floor(daysOnList / PRIORITY_SCORING.DAYS_PER_WAITTIME_POINT)
      );
    }

    // 3. Organ-Specific Scoring (0-25 points)
    if (patient.organ_needed === 'liver' && patient.meld_score) {
      const meldRange = 40 - 6; // MELD 6-40 maps to 0-25
      score += Math.min(
        PRIORITY_SCORING.MAX_ORGAN_SPECIFIC_POINTS,
        ((patient.meld_score - 6) / meldRange) * PRIORITY_SCORING.MAX_ORGAN_SPECIFIC_POINTS
      );
    } else if (patient.organ_needed === 'lung' && patient.las_score) {
      score += Math.min(
        PRIORITY_SCORING.MAX_ORGAN_SPECIFIC_POINTS,
        (patient.las_score / 100) * PRIORITY_SCORING.MAX_ORGAN_SPECIFIC_POINTS
      );
    } else if (patient.organ_needed === 'kidney') {
      if (patient.pra_percentage) {
        score += Math.min(15, (patient.pra_percentage / 100) * 15);
      }
      if (patient.cpra_percentage) {
        score += Math.min(10, (patient.cpra_percentage / 100) * 10);
      }
    } else {
      score += 10;
    }

    // 4. Recent Evaluation Bonus (0-10 points)
    if (patient.last_evaluation_date) {
      const daysSinceEval = Math.floor(
        (Date.now() - new Date(patient.last_evaluation_date).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceEval <= PRIORITY_SCORING.EVALUATION_RECENT_DAYS) {
        score += PRIORITY_SCORING.MAX_EVALUATION_POINTS;
      } else if (daysSinceEval <= PRIORITY_SCORING.EVALUATION_MODERATE_DAYS) {
        score += PRIORITY_SCORING.MAX_EVALUATION_POINTS / 2;
      }
    }

    // 5. Blood Type Rarity Modifier (0-10 points)
    score += BLOOD_TYPE_RARITY[patient.blood_type] || 0;

    // Normalize to 0-100 scale
    const normalizedScore = Math.min(
      PRIORITY_SCORING.MAX_TOTAL_SCORE,
      Math.max(PRIORITY_SCORING.MIN_TOTAL_SCORE, score)
    );

    const previousScore = patient.priority_score;

    // Update patient with new priority score
    await api.entities.Patient.update(patient_id, {
      priority_score: normalizedScore,
    });

    // HIPAA-compliant audit log
    await createHIPAAAuditLog(api, {
      action: 'CALCULATE',
      entityType: 'Patient',
      entityId: patient_id,
      patientName: `${patient.first_name} ${patient.last_name}`,
      details: `Priority score recalculated: ${normalizedScore.toFixed(1)}`,
      user: { email: user.email, role: user.role },
      outcome: 'SUCCESS',
      dataModified: {
        priority_score: [previousScore, normalizedScore],
      },
      requestId,
    });

    return Response.json({
      success: true,
      priority_score: normalizedScore,
      patient_id,
    });
  } catch (error) {
    logger.error('Priority calculation failed', error, { request_id: requestId });
    return safeErrorResponse(requestId, 'Priority calculation failed. Contact support.');
  }
});
