import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const api = createClientFromRequest(req);
    
    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { donor_organ_id, simulation_mode, hypothetical_donor } = await req.json();

    let donor;
    if (simulation_mode && hypothetical_donor) {
      // Use hypothetical donor for simulation
      donor = hypothetical_donor;
      donor.id = 'simulation';
    } else {
      // Get real donor organ details
      donor = await api.entities.DonorOrgan.get(donor_organ_id);
      
      if (!donor) {
        return Response.json({ error: 'Donor organ not found' }, { status: 404 });
      }
    }

    // Get all active patients waiting for this organ type
    const allPatients = await api.entities.Patient.list();
    const candidates = allPatients.filter(p => 
      p.waitlist_status === 'active' && 
      p.organ_needed === donor.organ_type
    );

    const matches = [];

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

    // Parse HLA typing for donor
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

    for (const patient of candidates) {
      // Check blood type compatibility
      const aboCompatible = bloodCompatibility[donor.blood_type]?.includes(patient.blood_type) || false;
      
      if (!aboCompatible) continue; // Skip incompatible blood types

      // Advanced HLA matching
      const patientHLA = parseHLA(patient.hla_typing);
      
      const hlaMatches = {
        A: donorHLA.A.filter(hla => patientHLA.A.includes(hla)).length,
        B: donorHLA.B.filter(hla => patientHLA.B.includes(hla)).length,
        DR: donorHLA.DR.filter(hla => patientHLA.DR.includes(hla)).length,
        DQ: donorHLA.DQ.filter(hla => patientHLA.DQ.includes(hla)).length
      };
      
      const totalHLAMatches = hlaMatches.A + hlaMatches.B + hlaMatches.DR;
      const maxPossibleMatches = 6; // 2 A + 2 B + 2 DR
      
      // HLA score (0-100)
      let hlaScore = (totalHLAMatches / maxPossibleMatches) * 100;
      
      // Bonus for DQ matches (newer understanding of importance)
      if (hlaMatches.DQ > 0) {
        hlaScore = Math.min(100, hlaScore + (hlaMatches.DQ * 5));
      }

      // Simulate crossmatch based on HLA compatibility and PRA
      let virtualCrossmatch = 'negative';
      if (patient.pra_percentage > 80 || patient.cpra_percentage > 80) {
        // High sensitization - higher risk of positive crossmatch
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

      // Skip if virtual crossmatch is positive
      if (virtualCrossmatch === 'positive') continue;

      // Size compatibility check
      let sizeCompatible = true;
      if (donor.donor_weight_kg && patient.weight_kg) {
        const weightRatio = donor.donor_weight_kg / patient.weight_kg;
        // Acceptable range: 0.7 to 1.5
        sizeCompatible = weightRatio >= 0.7 && weightRatio <= 1.5;
      }

      // Calculate overall compatibility score
      let compatibilityScore = 0;
      
      // Patient priority score (35% weight)
      compatibilityScore += (patient.priority_score || 0) * 0.35;
      
      // HLA match (30% weight) - increased importance
      compatibilityScore += hlaScore * 0.30;
      
      // Blood type perfect match bonus (10% weight)
      if (donor.blood_type === patient.blood_type) {
        compatibilityScore += 10;
      } else {
        compatibilityScore += 5; // Compatible but not identical
      }
      
      // Size compatibility (10% weight)
      if (sizeCompatible) {
        compatibilityScore += 10;
      } else {
        compatibilityScore += 3; // Still possible with size mismatch
      }
      
      // Time on waitlist (10% weight)
      if (patient.date_added_to_waitlist) {
        const daysOnList = Math.floor(
          (new Date() - new Date(patient.date_added_to_waitlist)) / (1000 * 60 * 60 * 24)
        );
        compatibilityScore += Math.min(10, (daysOnList / 365) * 10);
      }
      
      // Age compatibility (5% weight)
      if (donor.donor_age && patient.date_of_birth) {
        const patientAge = Math.floor(
          (new Date() - new Date(patient.date_of_birth)) / (1000 * 60 * 60 * 24 * 365.25)
        );
        const ageDiff = Math.abs(donor.donor_age - patientAge);
        // Prefer similar ages
        if (ageDiff <= 10) {
          compatibilityScore += 5;
        } else if (ageDiff <= 20) {
          compatibilityScore += 3;
        }
      }

      // Predict graft survival (simplified model)
      let predictedSurvival = 85; // base
      predictedSurvival += (totalHLAMatches / 6) * 10; // +10% for perfect HLA match
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

    // Sort by compatibility score (highest first)
    matches.sort((a, b) => b.compatibility_score - a.compatibility_score);

    // Assign priority ranks
    matches.forEach((match, index) => {
      match.priority_rank = index + 1;
    });

    // Create Match records for top candidates (only if not simulation)
    const createdMatches = [];
    if (!simulation_mode) {
      for (const match of matches.slice(0, 10)) {
        const matchRecord = await api.entities.Match.create({
          donor_organ_id: donor.id,
          patient_id: match.patient.id,
          patient_name: `${match.patient.first_name} ${match.patient.last_name}`,
          compatibility_score: match.compatibility_score,
          blood_type_compatible: match.blood_type_compatible,
          abo_compatible: match.abo_compatible,
          hla_match_score: match.hla_match_score,
          hla_a_match: match.hla_matches.A,
          hla_b_match: match.hla_matches.B,
          hla_dr_match: match.hla_matches.DR,
          hla_dq_match: match.hla_matches.DQ,
          size_compatible: match.size_compatible,
          match_status: 'potential',
          priority_rank: match.priority_rank,
          virtual_crossmatch_result: match.virtual_crossmatch,
          physical_crossmatch_result: 'not_performed',
          predicted_graft_survival: match.predicted_graft_survival,
        });
        createdMatches.push(matchRecord);
      }

      // Create notifications for top 3 matches
      for (const match of matches.slice(0, 3)) {
        const allUsers = await api.asServiceRole.entities.User.list();
        const admins = allUsers.filter(u => u.role === 'admin');

        for (const admin of admins) {
          await api.entities.Notification.create({
            recipient_email: admin.email,
            title: 'High-Compatibility Donor Match',
            message: `Excellent match: ${match.patient.first_name} ${match.patient.last_name} (${match.compatibility_score.toFixed(0)}% compatible, ${match.total_hla_matches}/6 HLA matches) for ${donor.organ_type} from donor ${donor.donor_id}`,
            notification_type: 'donor_match',
            is_read: false,
            related_patient_id: match.patient.id,
            related_patient_name: `${match.patient.first_name} ${match.patient.last_name}`,
            priority_level: match.priority_rank === 1 ? 'critical' : 'high',
            action_url: `/DonorMatching?donor_id=${donor.id}`,
            metadata: { 
              donor_id: donor.id,
              patient_id: match.patient.id,
              compatibility_score: match.compatibility_score,
              hla_matches: match.total_hla_matches
            }
          });
        }
      }

      // Log the matching activity
      await api.entities.AuditLog.create({
        action: 'create',
        entity_type: 'DonorOrgan',
        entity_id: donor.id,
        details: `Advanced matching for donor ${donor.donor_id}: ${matches.length} compatible recipients found. Top match: ${matches[0]?.compatibility_score.toFixed(0)}% (${matches[0]?.total_hla_matches}/6 HLA)`,
        user_email: user.email,
        user_role: user.role,
      });
    }

    return Response.json({
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
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});