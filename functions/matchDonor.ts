import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';
import {
  MATCHING,
  BLOOD_COMPATIBILITY,
  PRIORITY_SCORING,
} from './lib/constants.ts';
import {
  isValidUUID,
  validateHLATyping,
  parseHLATyping,
  calculateHLAMatchScore,
  sanitizePatientName,
} from './lib/validators.ts';
import { createLogger, generateRequestId, safeErrorResponse } from './lib/logger.ts';
import { createHIPAAAuditLog } from './lib/audit.ts';

const logger = createLogger('matchDonor');

Deno.serve(async (req) => {
  const requestId = generateRequestId();

  try {
    const api = createClientFromRequest(req);

    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { donor_organ_id } = body;

    if (!donor_organ_id || !isValidUUID(donor_organ_id)) {
      return Response.json(
        { error: 'Invalid or missing donor_organ_id. Must be a valid UUID.' },
        { status: 400 }
      );
    }

    // Get donor organ details
    const donor = await api.entities.DonorOrgan.get(donor_organ_id);

    if (!donor) {
      return Response.json({ error: 'Donor organ not found' }, { status: 404 });
    }

    // Parse and validate donor HLA once (cached for all patient comparisons)
    const donorHLAValidation = validateHLATyping(donor.hla_typing);
    if (donor.hla_typing && !donorHLAValidation.valid) {
      logger.warn('Donor has invalid HLA typing', {
        donor_id: donor.id,
        errors: donorHLAValidation.errors,
        request_id: requestId,
      });
    }
    const donorHLAAntigens = donorHLAValidation.valid ? donorHLAValidation.antigens : [];

    // Filter active patients for this organ type to reduce data loaded
    let candidates;
    try {
      const allPatients = await api.entities.Patient.list();
      candidates = allPatients.filter(
        (p: Record<string, unknown>) =>
          p.waitlist_status === 'active' && p.organ_needed === donor.organ_type
      );
    } catch (fetchError) {
      logger.error('Failed to fetch patient list', fetchError, { request_id: requestId });
      return safeErrorResponse(requestId, 'Failed to retrieve patient data.');
    }

    const matchResults: Array<Record<string, unknown>> = [];

    for (const patient of candidates) {
      // Check blood type compatibility
      const compatible =
        BLOOD_COMPATIBILITY[donor.blood_type]?.includes(patient.blood_type) || false;

      if (!compatible) continue;

      // Calculate HLA match score using validated/cached antigens
      const patientHLAAntigens = parseHLATyping(patient.hla_typing);
      const hlaScore = calculateHLAMatchScore(donorHLAAntigens, patientHLAAntigens);

      // Size compatibility check
      let sizeCompatible = true;
      if (donor.donor_weight_kg && patient.weight_kg) {
        const weightRatio = donor.donor_weight_kg / patient.weight_kg;
        sizeCompatible =
          weightRatio >= MATCHING.WEIGHT_RATIO_MIN && weightRatio <= MATCHING.WEIGHT_RATIO_MAX;
      }

      // Calculate overall compatibility score
      let compatibilityScore = 0;

      // Priority score (40% weight)
      compatibilityScore += (patient.priority_score || 0) * MATCHING.WEIGHT_PRIORITY;

      // HLA match (25% weight)
      compatibilityScore += hlaScore * MATCHING.WEIGHT_HLA;

      // Blood type perfect match bonus (15% weight)
      if (donor.blood_type === patient.blood_type) {
        compatibilityScore += MATCHING.WEIGHT_BLOOD_TYPE * 100;
      }

      // Size compatibility (10% weight)
      if (sizeCompatible) {
        compatibilityScore += MATCHING.WEIGHT_SIZE * 100;
      }

      // Time on waitlist (10% weight)
      if (patient.date_added_to_waitlist) {
        const daysOnList = Math.floor(
          (Date.now() - new Date(patient.date_added_to_waitlist).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        compatibilityScore += Math.min(
          MATCHING.WEIGHT_WAITTIME * 100,
          (daysOnList / PRIORITY_SCORING.MAX_WAITTIME_DAYS) * MATCHING.WEIGHT_WAITTIME * 100
        );
      }

      matchResults.push({
        patient,
        compatibility_score: Math.min(100, compatibilityScore),
        blood_type_compatible: compatible,
        hla_match_score: hlaScore,
        size_compatible: sizeCompatible,
      });
    }

    // Sort by compatibility score (highest first)
    matchResults.sort(
      (a, b) => (b.compatibility_score as number) - (a.compatibility_score as number)
    );

    // Assign priority ranks
    matchResults.forEach((match, index) => {
      match.priority_rank = index + 1;
    });

    // Create Match records for top candidates with freshness check
    const createdMatches: unknown[] = [];
    for (const match of matchResults.slice(0, MATCHING.MAX_MATCHES_TO_CREATE)) {
      const patient = match.patient as Record<string, unknown>;

      // Re-check patient status before creating match (race condition mitigation)
      try {
        const freshPatient = await api.entities.Patient.get(patient.id as string);
        if (!freshPatient || freshPatient.waitlist_status !== 'active') {
          logger.info('Skipping match - patient no longer active', {
            patient_id: patient.id,
            request_id: requestId,
          });
          continue;
        }
      } catch {
        logger.warn('Could not re-verify patient status, skipping', {
          patient_id: patient.id,
          request_id: requestId,
        });
        continue;
      }

      const sanitizedName = sanitizePatientName(patient.first_name, patient.last_name);
      const matchRecord = await api.entities.Match.create({
        donor_organ_id: donor.id,
        patient_id: patient.id,
        patient_name: sanitizedName,
        compatibility_score: match.compatibility_score,
        blood_type_compatible: match.blood_type_compatible,
        hla_match_score: match.hla_match_score,
        size_compatible: match.size_compatible,
        match_status: 'potential',
        priority_rank: match.priority_rank,
      });
      createdMatches.push(matchRecord);
    }

    // Create notifications for top matches (sanitized)
    for (const match of matchResults.slice(0, MATCHING.TOP_PRIORITY_NOTIFICATIONS)) {
      const patient = match.patient as Record<string, unknown>;
      const sanitizedName = sanitizePatientName(patient.first_name, patient.last_name);
      const safeScore = Math.round(match.compatibility_score as number);

      const allUsers = await api.asServiceRole.entities.User.list();
      const admins = (allUsers as Array<Record<string, unknown>>).filter(
        (u) => u.role === 'admin'
      );

      for (const admin of admins) {
        await api.entities.Notification.create({
          recipient_email: admin.email,
          title: 'New Donor Match Available',
          message: `High-priority match found: ${sanitizedName} (${safeScore}% compatible) for ${donor.organ_type}`,
          notification_type: 'donor_match',
          is_read: false,
          related_patient_id: patient.id,
          related_patient_name: sanitizedName,
          priority_level: match.priority_rank === 1 ? 'critical' : 'high',
          action_url: `/DonorMatching?donor_id=${donor.id}`,
          metadata: {
            donor_id: donor.id,
            patient_id: patient.id,
            compatibility_score: match.compatibility_score,
          },
        });
      }
    }

    // HIPAA-compliant audit log
    await createHIPAAAuditLog(api, {
      action: 'MATCH',
      entityType: 'DonorOrgan',
      entityId: donor.id,
      details: `Matched donor ${donor.donor_id} with ${matchResults.length} potential recipients. Top match: ${matchResults[0]?.compatibility_score ? (matchResults[0].compatibility_score as number).toFixed(0) : 'N/A'}% compatible`,
      user: { email: user.email, role: user.role },
      outcome: 'SUCCESS',
      accessJustification: 'Donor-patient matching algorithm execution',
      requestId,
    });

    return Response.json({
      success: true,
      donor,
      matches: matchResults.map((m) => {
        const p = m.patient as Record<string, unknown>;
        return {
          patient_id: p.id,
          patient_name: sanitizePatientName(p.first_name, p.last_name),
          patient_id_mrn: p.patient_id,
          blood_type: p.blood_type,
          organ_needed: p.organ_needed,
          priority_score: p.priority_score,
          compatibility_score: m.compatibility_score,
          blood_type_compatible: m.blood_type_compatible,
          hla_match_score: m.hla_match_score,
          size_compatible: m.size_compatible,
          priority_rank: m.priority_rank,
          medical_urgency: p.medical_urgency,
          days_on_waitlist: p.date_added_to_waitlist
            ? Math.floor(
                (Date.now() - new Date(p.date_added_to_waitlist as string).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            : 0,
        };
      }),
      total_matches: matchResults.length,
      matches_created: createdMatches.length,
    });
  } catch (error) {
    logger.error('Donor matching failed', error, { request_id: requestId });
    return safeErrorResponse(requestId, 'Donor matching failed. Contact support.');
  }
});
