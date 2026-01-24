import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const api = createClientFromRequest(req);
    
    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { donor_organ_id } = await req.json();

    // Get donor organ details
    const donor = await api.entities.DonorOrgan.get(donor_organ_id);
    
    if (!donor) {
      return Response.json({ error: 'Donor organ not found' }, { status: 404 });
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

    for (const patient of candidates) {
      // Check blood type compatibility
      const compatible = bloodCompatibility[donor.blood_type]?.includes(patient.blood_type) || false;
      
      if (!compatible) continue; // Skip incompatible blood types

      // Calculate HLA match score (simplified)
      let hlaScore = 0;
      if (donor.hla_typing && patient.hla_typing) {
        const donorHLA = donor.hla_typing.split(/[\s,;]+/);
        const patientHLA = patient.hla_typing.split(/[\s,;]+/);
        
        // Count matching antigens (simplified - in reality much more complex)
        const matches = donorHLA.filter(hla => patientHLA.includes(hla));
        hlaScore = (matches.length / 6) * 100; // Assume 6 key antigens
      } else {
        hlaScore = 50; // Default if HLA data not available
      }

      // Size compatibility check
      let sizeCompatible = true;
      if (donor.donor_weight_kg && patient.weight_kg) {
        const weightRatio = donor.donor_weight_kg / patient.weight_kg;
        // Acceptable range: 0.7 to 1.5
        sizeCompatible = weightRatio >= 0.7 && weightRatio <= 1.5;
      }

      // Calculate overall compatibility score
      let compatibilityScore = 0;
      
      // Priority score (40% weight)
      compatibilityScore += (patient.priority_score || 0) * 0.4;
      
      // HLA match (25% weight)
      compatibilityScore += hlaScore * 0.25;
      
      // Blood type perfect match bonus (15% weight)
      if (donor.blood_type === patient.blood_type) {
        compatibilityScore += 15;
      }
      
      // Size compatibility (10% weight)
      if (sizeCompatible) {
        compatibilityScore += 10;
      }
      
      // Time on waitlist (10% weight)
      if (patient.date_added_to_waitlist) {
        const daysOnList = Math.floor(
          (new Date() - new Date(patient.date_added_to_waitlist)) / (1000 * 60 * 60 * 24)
        );
        // Max 10 points for 365+ days
        compatibilityScore += Math.min(10, (daysOnList / 365) * 10);
      }

      matches.push({
        patient,
        compatibility_score: Math.min(100, compatibilityScore),
        blood_type_compatible: compatible,
        hla_match_score: hlaScore,
        size_compatible: sizeCompatible,
      });
    }

    // Sort by compatibility score (highest first)
    matches.sort((a, b) => b.compatibility_score - a.compatibility_score);

    // Assign priority ranks
    matches.forEach((match, index) => {
      match.priority_rank = index + 1;
    });

    // Create Match records for top candidates
    const createdMatches = [];
    for (const match of matches.slice(0, 10)) { // Top 10 matches
      const matchRecord = await api.entities.Match.create({
        donor_organ_id: donor.id,
        patient_id: match.patient.id,
        patient_name: `${match.patient.first_name} ${match.patient.last_name}`,
        compatibility_score: match.compatibility_score,
        blood_type_compatible: match.blood_type_compatible,
        hla_match_score: match.hla_match_score,
        size_compatible: match.size_compatible,
        match_status: 'potential',
        priority_rank: match.priority_rank
      });
      createdMatches.push(matchRecord);
    }

    // Create notifications for top 3 matches
    for (const match of matches.slice(0, 3)) {
      // Get all admin users to notify
      const allUsers = await api.asServiceRole.entities.User.list();
      const admins = allUsers.filter(u => u.role === 'admin');

      for (const admin of admins) {
        await api.entities.Notification.create({
          recipient_email: admin.email,
          title: 'New Donor Match Available',
          message: `High-priority match found: ${match.patient.first_name} ${match.patient.last_name} (${match.compatibility_score.toFixed(0)}% compatible) for ${donor.organ_type} from donor ${donor.donor_id}`,
          notification_type: 'donor_match',
          is_read: false,
          related_patient_id: match.patient.id,
          related_patient_name: `${match.patient.first_name} ${match.patient.last_name}`,
          priority_level: match.priority_rank === 1 ? 'critical' : 'high',
          action_url: `/DonorMatching?donor_id=${donor.id}`,
          metadata: { 
            donor_id: donor.id,
            patient_id: match.patient.id,
            compatibility_score: match.compatibility_score
          }
        });
      }
    }

    // Log the matching activity
    await api.entities.AuditLog.create({
      action: 'create',
      entity_type: 'DonorOrgan',
      entity_id: donor.id,
      details: `Matched donor ${donor.donor_id} with ${matches.length} potential recipients. Top match: ${matches[0]?.compatibility_score.toFixed(0)}% compatible`,
      user_email: user.email,
      user_role: user.role,
    });

    return Response.json({
      success: true,
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
        hla_match_score: m.hla_match_score,
        size_compatible: m.size_compatible,
        priority_rank: m.priority_rank,
        medical_urgency: m.patient.medical_urgency,
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