import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const api = createClientFromRequest(req);
    
    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, event_type, old_data } = await req.json();

    // Get the updated patient data
    const patient = await api.entities.Patient.get(patient_id);
    
    // Get all active notification rules
    const rules = await api.entities.NotificationRule.filter({ is_active: true });

    const triggeredNotifications = [];

    for (const rule of rules) {
      let shouldTrigger = false;
      let message = '';

      const conditions = rule.trigger_conditions || {};

      switch (rule.rule_type) {
        case 'priority_threshold':
          if (patient.priority_score >= (conditions.priority_score || 80)) {
            if (!conditions.organ_type || patient.organ_needed === conditions.organ_type) {
              shouldTrigger = true;
              message = `${patient.first_name} ${patient.last_name} has reached critical priority score of ${patient.priority_score.toFixed(0)}`;
            }
          }
          break;

        case 'status_change':
          if (event_type === 'update' && old_data && old_data.waitlist_status !== patient.waitlist_status) {
            if (!conditions.status_to || patient.waitlist_status === conditions.status_to) {
              shouldTrigger = true;
              message = `${patient.first_name} ${patient.last_name} status changed from ${old_data.waitlist_status} to ${patient.waitlist_status}`;
            }
          }
          break;

        case 'evaluation_overdue':
          if (patient.last_evaluation_date) {
            const daysSinceEval = Math.floor(
              (new Date() - new Date(patient.last_evaluation_date)) / (1000 * 60 * 60 * 24)
            );
            const threshold = conditions.days_threshold || 90;
            if (daysSinceEval >= threshold) {
              shouldTrigger = true;
              message = `${patient.first_name} ${patient.last_name} evaluation is ${daysSinceEval} days overdue (threshold: ${threshold} days)`;
            }
          }
          break;

        case 'time_on_waitlist':
          if (patient.date_added_to_waitlist) {
            const daysOnList = Math.floor(
              (new Date() - new Date(patient.date_added_to_waitlist)) / (1000 * 60 * 60 * 24)
            );
            const threshold = conditions.days_threshold || 365;
            if (daysOnList >= threshold) {
              shouldTrigger = true;
              message = `${patient.first_name} ${patient.last_name} has been on waitlist for ${daysOnList} days`;
            }
          }
          break;

        case 'score_change':
          if (event_type === 'update' && old_data && old_data.priority_score) {
            const scoreChange = patient.priority_score - old_data.priority_score;
            if (Math.abs(scoreChange) >= 10) {
              shouldTrigger = true;
              message = `${patient.first_name} ${patient.last_name} priority score changed by ${scoreChange > 0 ? '+' : ''}${scoreChange.toFixed(0)} points`;
            }
          }
          break;

        case 'new_patient':
          if (event_type === 'create') {
            shouldTrigger = true;
            message = `New patient added: ${patient.first_name} ${patient.last_name} (${patient.organ_needed})`;
          }
          break;
      }

      if (shouldTrigger) {
        // Use custom message template if provided
        const finalMessage = rule.message_template || message;

        // Determine priority level
        let priorityLevel = 'medium';
        if (rule.rule_type === 'priority_threshold' || patient.medical_urgency === 'critical') {
          priorityLevel = 'critical';
        } else if (patient.medical_urgency === 'high') {
          priorityLevel = 'high';
        }

        // Get users to notify
        const allUsers = await api.asServiceRole.entities.User.list();
        const usersToNotify = allUsers.filter(u => 
          rule.notify_roles.includes(u.role)
        );

        for (const notifyUser of usersToNotify) {
          // Create in-app notification
          if (rule.notification_channels.includes('in_app')) {
            const notification = await api.entities.Notification.create({
              recipient_email: notifyUser.email,
              title: rule.rule_name,
              message: finalMessage,
              notification_type: rule.rule_type === 'priority_threshold' ? 'priority_alert' : 
                                 rule.rule_type === 'status_change' ? 'status_change' : 'system',
              is_read: false,
              related_patient_id: patient.id,
              related_patient_name: `${patient.first_name} ${patient.last_name}`,
              priority_level: priorityLevel,
              action_url: `/PatientDetails?id=${patient.id}`,
              metadata: { rule_id: rule.id, patient_id: patient.id }
            });

            triggeredNotifications.push(notification);
          }

          // Send email notification
          if (rule.notification_channels.includes('email')) {
            try {
              await api.integrations.Core.SendEmail({
                from_name: 'TransTrack Notifications',
                to: notifyUser.email,
                subject: `${rule.rule_name} - ${patient.first_name} ${patient.last_name}`,
                body: `
                  <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #334155;">
                      <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; border-radius: 8px;">
                        <div style="background: linear-gradient(135deg, #0891b2 0%, #0e7490 100%); padding: 20px; border-radius: 8px 8px 0 0;">
                          <h2 style="color: white; margin: 0;">TransTrack Alert</h2>
                        </div>
                        <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
                          <h3 style="color: #0891b2; margin-top: 0;">${rule.rule_name}</h3>
                          <p style="font-size: 16px; margin: 20px 0;">${finalMessage}</p>
                          <div style="background-color: #f1f5f9; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <strong>Patient:</strong> ${patient.first_name} ${patient.last_name}<br>
                            <strong>Patient ID:</strong> ${patient.patient_id}<br>
                            <strong>Organ:</strong> ${patient.organ_needed}<br>
                            <strong>Priority Score:</strong> ${patient.priority_score?.toFixed(0) || 'N/A'}<br>
                            <strong>Status:</strong> ${patient.waitlist_status}
                          </div>
                          <p style="margin-top: 30px; font-size: 14px; color: #64748b;">
                            Log in to TransTrack to view full patient details and take action.
                          </p>
                        </div>
                      </div>
                    </body>
                  </html>
                `
              });
            } catch (emailError) {
              console.error('Email notification failed:', emailError);
            }
          }
        }
      }
    }

    return Response.json({
      success: true,
      notifications_created: triggeredNotifications.length,
      notifications: triggeredNotifications
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});