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

    // Priority Scoring Algorithm
    let score = 0;

    // 1. Medical Urgency Weight (0-30 points)
    const urgencyScores = {
      critical: 30,
      high: 20,
      medium: 10,
      low: 5,
    };
    score += urgencyScores[patient.medical_urgency] || 10;

    // 2. Time on Waitlist (0-25 points)
    if (patient.date_added_to_waitlist) {
      const daysOnList = Math.floor(
        (new Date() - new Date(patient.date_added_to_waitlist)) / (1000 * 60 * 60 * 24)
      );
      // Give points based on waiting time (max 25 points at 365+ days)
      score += Math.min(25, Math.floor(daysOnList / 14.6));
    }

    // 3. Organ-Specific Scoring (0-25 points)
    if (patient.organ_needed === 'liver' && patient.meld_score) {
      // MELD score (6-40) maps to 0-25 points
      score += Math.min(25, ((patient.meld_score - 6) / 34) * 25);
    } else if (patient.organ_needed === 'lung' && patient.las_score) {
      // LAS score (0-100) maps to 0-25 points
      score += Math.min(25, (patient.las_score / 100) * 25);
    } else if (patient.organ_needed === 'kidney') {
      // For kidney, consider PRA percentage
      if (patient.pra_percentage) {
        score += Math.min(15, (patient.pra_percentage / 100) * 15);
      }
      if (patient.cpra_percentage) {
        score += Math.min(10, (patient.cpra_percentage / 100) * 10);
      }
    } else {
      // Default score for other organs based on urgency
      score += 10;
    }

    // 4. Recent Evaluation Bonus (0-10 points)
    if (patient.last_evaluation_date) {
      const daysSinceEval = Math.floor(
        (new Date() - new Date(patient.last_evaluation_date)) / (1000 * 60 * 60 * 24)
      );
      // Recent evaluation is good (within 90 days = full points)
      if (daysSinceEval <= 90) {
        score += 10;
      } else if (daysSinceEval <= 180) {
        score += 5;
      }
    }

    // 5. Blood Type Rarity Modifier (0-10 points)
    const bloodTypeRarity = {
      'AB-': 10,
      'B-': 8,
      'A-': 6,
      'O-': 5,
      'AB+': 4,
      'B+': 3,
      'A+': 2,
      'O+': 1,
    };
    score += bloodTypeRarity[patient.blood_type] || 0;

    // Normalize to 0-100 scale
    const normalizedScore = Math.min(100, Math.max(0, score));

    // Update patient with new priority score
    await api.entities.Patient.update(patient_id, {
      priority_score: normalizedScore,
    });

    // Log the calculation
    await api.entities.AuditLog.create({
      action: 'update',
      entity_type: 'Patient',
      entity_id: patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      details: `Priority score recalculated: ${normalizedScore.toFixed(1)}`,
      user_email: user.email,
      user_role: user.role,
    });

    return Response.json({
      success: true,
      priority_score: normalizedScore,
      patient_id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});