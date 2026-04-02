/**
 * TransTrack - Automated Task Engine with Escalation
 * 
 * Generates operational tasks from risk signals, evaluation deadlines,
 * barrier status, and documentation gaps. Tasks escalate through configured
 * rules when not completed within their timeframe.
 * 
 * All calculations run locally on the encrypted SQLite database.
 */

const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('./logger.cjs');

function requireOrgId(orgId) {
  if (!orgId) throw new Error('Organization context required');
}

function createTask(orgId, taskData, createdBy) {
  requireOrgId(orgId);
  const db = getDatabase();
  const id = uuidv4();

  const record = {
    id,
    org_id: orgId,
    patient_id: taskData.patient_id || null,
    title: taskData.title,
    description: taskData.description || null,
    task_type: taskData.task_type || 'GENERAL',
    source: taskData.source || 'MANUAL',
    status: 'pending',
    priority: taskData.priority || 'normal',
    assigned_to: taskData.assigned_to || null,
    assigned_role: taskData.assigned_role || null,
    due_date: taskData.due_date || null,
    trigger_entity_type: taskData.trigger_entity_type || null,
    trigger_entity_id: taskData.trigger_entity_id || null,
    created_by: createdBy,
  };

  const fields = Object.keys(record);
  const placeholders = fields.map(() => '?').join(', ');
  db.prepare(`INSERT INTO tasks (${fields.join(', ')}) VALUES (${placeholders})`)
    .run(...Object.values(record));

  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function updateTask(orgId, taskId, updates, updatedBy) {
  requireOrgId(orgId);
  const db = getDatabase();

  const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?').get(taskId, orgId);
  if (!existing) throw new Error('Task not found');

  const allowed = ['status', 'priority', 'assigned_to', 'assigned_role', 'due_date', 'resolution_notes', 'title', 'description'];
  const filtered = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  if (filtered.status === 'completed') {
    filtered.completed_date = new Date().toISOString();
    filtered.completed_by = updatedBy;
  }

  filtered.updated_at = new Date().toISOString();
  filtered.updated_by = updatedBy;

  const sets = Object.keys(filtered).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE tasks SET ${sets} WHERE id = ? AND org_id = ?`)
    .run(...Object.values(filtered), taskId, orgId);

  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
}

function deleteTask(orgId, taskId) {
  requireOrgId(orgId);
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?').get(taskId, orgId);
  if (!existing) throw new Error('Task not found');
  db.prepare('DELETE FROM tasks WHERE id = ? AND org_id = ?').run(taskId, orgId);
  return { success: true };
}

function getTasksByPatient(orgId, patientId, includeCompleted = false) {
  requireOrgId(orgId);
  const db = getDatabase();
  const statusFilter = includeCompleted ? '' : "AND status NOT IN ('completed', 'cancelled')";
  return db.prepare(`
    SELECT * FROM tasks WHERE org_id = ? AND patient_id = ? ${statusFilter}
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, due_date ASC
  `).all(orgId, patientId);
}

function getAllTasks(orgId, filters = {}) {
  requireOrgId(orgId);
  const db = getDatabase();

  let query = 'SELECT t.*, p.first_name, p.last_name, p.patient_id as mrn FROM tasks t LEFT JOIN patients p ON t.patient_id = p.id AND p.org_id = t.org_id WHERE t.org_id = ?';
  const params = [orgId];

  if (filters.status) {
    query += ' AND t.status = ?';
    params.push(filters.status);
  }
  if (filters.task_type) {
    query += ' AND t.task_type = ?';
    params.push(filters.task_type);
  }
  if (filters.priority) {
    query += ' AND t.priority = ?';
    params.push(filters.priority);
  }
  if (filters.assigned_to) {
    query += ' AND t.assigned_to = ?';
    params.push(filters.assigned_to);
  }
  if (filters.source) {
    query += ' AND t.source = ?';
    params.push(filters.source);
  }

  query += ` ORDER BY 
    CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    CASE t.status WHEN 'overdue' THEN 0 WHEN 'escalated' THEN 1 WHEN 'pending' THEN 2 WHEN 'in_progress' THEN 3 ELSE 4 END,
    t.due_date ASC`;

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(parseInt(filters.limit, 10));
  }

  return db.prepare(query).all(...params);
}

function generateAutoTasks(orgId, createdBy) {
  requireOrgId(orgId);
  const db = getDatabase();
  const generated = [];

  const evalExpiring = db.prepare(`
    SELECT id, first_name, last_name, patient_id, last_evaluation_date FROM patients
    WHERE org_id = ? AND waitlist_status = 'active'
    AND last_evaluation_date IS NOT NULL
    AND datetime(last_evaluation_date, '+335 days') < datetime('now')
    AND datetime(last_evaluation_date, '+365 days') > datetime('now')
  `).all(orgId);

  for (const patient of evalExpiring) {
    const existingTask = db.prepare(`
      SELECT id FROM tasks WHERE org_id = ? AND patient_id = ? 
      AND task_type = 'EVALUATION_RENEWAL' AND status NOT IN ('completed', 'cancelled')
    `).get(orgId, patient.id);

    if (!existingTask) {
      const daysUntilExpiry = Math.ceil(
        (new Date(patient.last_evaluation_date).getTime() + 365 * 24 * 60 * 60 * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
      );
      const task = createTask(orgId, {
        patient_id: patient.id,
        title: `Evaluation renewal: ${patient.first_name} ${patient.last_name}`,
        description: `Evaluation expires in ${daysUntilExpiry} days (${patient.last_evaluation_date}). Schedule renewal appointment.`,
        task_type: 'EVALUATION_RENEWAL',
        source: 'AUTO_EVAL',
        priority: daysUntilExpiry <= 14 ? 'urgent' : 'high',
        assigned_role: 'coordinator',
        due_date: patient.last_evaluation_date ? new Date(new Date(patient.last_evaluation_date).getTime() + 350 * 24 * 60 * 60 * 1000).toISOString() : null,
        trigger_entity_type: 'Patient',
        trigger_entity_id: patient.id,
      }, createdBy || 'system');
      generated.push(task);
    }
  }

  const highBarriers = db.prepare(`
    SELECT rb.*, p.first_name, p.last_name FROM readiness_barriers rb
    JOIN patients p ON rb.patient_id = p.id AND p.org_id = rb.org_id
    WHERE rb.org_id = ? AND rb.status = 'open' AND rb.risk_level = 'high'
  `).all(orgId);

  for (const barrier of highBarriers) {
    const existingTask = db.prepare(`
      SELECT id FROM tasks WHERE org_id = ? AND trigger_entity_type = 'ReadinessBarrier' 
      AND trigger_entity_id = ? AND status NOT IN ('completed', 'cancelled')
    `).get(orgId, barrier.id);

    if (!existingTask) {
      const task = createTask(orgId, {
        patient_id: barrier.patient_id,
        title: `Resolve high-risk barrier: ${barrier.barrier_type.replace(/_/g, ' ')} - ${barrier.first_name} ${barrier.last_name}`,
        description: `High-risk readiness barrier identified on ${barrier.identified_date}. Barrier type: ${barrier.barrier_type}.`,
        task_type: 'BARRIER_RESOLUTION',
        source: 'AUTO_BARRIER',
        priority: 'high',
        assigned_role: barrier.owning_role,
        due_date: barrier.target_resolution_date,
        trigger_entity_type: 'ReadinessBarrier',
        trigger_entity_id: barrier.id,
      }, createdBy || 'system');
      generated.push(task);
    }
  }

  const stalePatients = db.prepare(`
    SELECT id, first_name, last_name, patient_id, updated_at FROM patients
    WHERE org_id = ? AND waitlist_status = 'active'
    AND updated_at < datetime('now', '-60 days')
  `).all(orgId);

  for (const patient of stalePatients) {
    const existingTask = db.prepare(`
      SELECT id FROM tasks WHERE org_id = ? AND patient_id = ? 
      AND task_type = 'DOCUMENTATION_UPDATE' AND status NOT IN ('completed', 'cancelled')
    `).get(orgId, patient.id);

    if (!existingTask) {
      const task = createTask(orgId, {
        patient_id: patient.id,
        title: `Documentation update needed: ${patient.first_name} ${patient.last_name}`,
        description: `Patient record has not been updated since ${patient.updated_at}. Review and update documentation.`,
        task_type: 'DOCUMENTATION_UPDATE',
        source: 'AUTO_RISK',
        priority: 'normal',
        assigned_role: 'coordinator',
        trigger_entity_type: 'Patient',
        trigger_entity_id: patient.id,
      }, createdBy || 'system');
      generated.push(task);
    }
  }

  logger.info('Auto-tasks generated', { orgId, count: generated.length });
  return { generated: generated.length, tasks: generated };
}

function processEscalations(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();

  const now = new Date();
  const overdueTasks = db.prepare(`
    SELECT * FROM tasks WHERE org_id = ? 
    AND status IN ('pending', 'in_progress') 
    AND due_date IS NOT NULL AND due_date < ?
  `).all(orgId, now.toISOString());

  const escalated = [];

  for (const task of overdueTasks) {
    db.prepare(`UPDATE tasks SET status = 'overdue', updated_at = ? WHERE id = ? AND org_id = ?`)
      .run(now.toISOString(), task.id, orgId);

    const rule = db.prepare(`
      SELECT * FROM task_escalation_rules 
      WHERE org_id = ? AND task_type = ? AND escalation_level = ? AND is_active = 1
      ORDER BY escalation_level ASC LIMIT 1
    `).get(orgId, task.task_type, task.escalation_level + 1);

    if (rule) {
      const hoursSinceDue = (now - new Date(task.due_date)) / (1000 * 60 * 60);
      if (hoursSinceDue >= rule.hours_before_escalation) {
        db.prepare(`
          UPDATE tasks SET escalation_level = ?, escalated_at = ?, 
          escalated_to = ?, status = 'escalated', updated_at = ?
          WHERE id = ? AND org_id = ?
        `).run(rule.escalation_level, now.toISOString(), rule.escalate_to_role, now.toISOString(), task.id, orgId);

        escalated.push({ taskId: task.id, level: rule.escalation_level, role: rule.escalate_to_role });
      }
    }
  }

  logger.info('Escalation processing complete', { orgId, overdue: overdueTasks.length, escalated: escalated.length });
  return { overdue: overdueTasks.length, escalated };
}

function getTaskDashboard(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();

  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) as escalated,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
      SUM(CASE WHEN priority = 'urgent' AND status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) as urgent_active,
      SUM(CASE WHEN source != 'MANUAL' THEN 1 ELSE 0 END) as auto_generated,
      SUM(CASE WHEN source = 'MANUAL' THEN 1 ELSE 0 END) as manual
    FROM tasks WHERE org_id = ?
  `).get(orgId);

  const byType = db.prepare(`
    SELECT task_type, COUNT(*) as count FROM tasks 
    WHERE org_id = ? AND status NOT IN ('completed', 'cancelled') 
    GROUP BY task_type
  `).all(orgId);

  const byAssignedRole = db.prepare(`
    SELECT assigned_role, COUNT(*) as count FROM tasks 
    WHERE org_id = ? AND status NOT IN ('completed', 'cancelled') AND assigned_role IS NOT NULL
    GROUP BY assigned_role
  `).all(orgId);

  const upcoming = db.prepare(`
    SELECT t.*, p.first_name, p.last_name, p.patient_id as mrn 
    FROM tasks t LEFT JOIN patients p ON t.patient_id = p.id AND p.org_id = t.org_id
    WHERE t.org_id = ? AND t.status NOT IN ('completed', 'cancelled')
    ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
             t.due_date ASC
    LIMIT 15
  `).all(orgId);

  const completionRate = (stats?.total || 0) > 0
    ? Math.round(((stats?.completed || 0) / stats.total) * 1000) / 10
    : 0;

  return {
    stats: {
      total: stats?.total || 0,
      pending: stats?.pending || 0,
      inProgress: stats?.in_progress || 0,
      completed: stats?.completed || 0,
      overdue: stats?.overdue || 0,
      escalated: stats?.escalated || 0,
      cancelled: stats?.cancelled || 0,
      urgentActive: stats?.urgent_active || 0,
      autoGenerated: stats?.auto_generated || 0,
      manual: stats?.manual || 0,
      completionRate,
    },
    byType: byType.reduce((acc, r) => { acc[r.task_type] = r.count; return acc; }, {}),
    byAssignedRole: byAssignedRole.reduce((acc, r) => { acc[r.assigned_role || 'unassigned'] = r.count; return acc; }, {}),
    upcomingTasks: upcoming.map(t => ({
      ...t,
      patientName: t.first_name ? `${t.first_name} ${t.last_name}` : null,
    })),
  };
}

function getEscalationRules(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  return db.prepare('SELECT * FROM task_escalation_rules WHERE org_id = ? ORDER BY task_type, escalation_level').all(orgId);
}

function saveEscalationRule(orgId, ruleData, createdBy) {
  requireOrgId(orgId);
  const db = getDatabase();
  const id = ruleData.id || uuidv4();

  const existing = ruleData.id ? db.prepare('SELECT id FROM task_escalation_rules WHERE id = ? AND org_id = ?').get(ruleData.id, orgId) : null;

  if (existing) {
    db.prepare(`
      UPDATE task_escalation_rules SET task_type = ?, escalation_level = ?, 
      hours_before_escalation = ?, escalate_to_role = ?, notification_message = ?,
      is_active = ?, updated_at = ? WHERE id = ? AND org_id = ?
    `).run(
      ruleData.task_type, ruleData.escalation_level, ruleData.hours_before_escalation,
      ruleData.escalate_to_role, ruleData.notification_message || null,
      ruleData.is_active !== undefined ? ruleData.is_active : 1,
      new Date().toISOString(), id, orgId
    );
  } else {
    db.prepare(`
      INSERT INTO task_escalation_rules (id, org_id, task_type, escalation_level, 
      hours_before_escalation, escalate_to_role, notification_message, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, ruleData.task_type, ruleData.escalation_level || 1,
      ruleData.hours_before_escalation || 168, ruleData.escalate_to_role,
      ruleData.notification_message || null, ruleData.is_active !== undefined ? ruleData.is_active : 1,
      createdBy
    );
  }

  return db.prepare('SELECT * FROM task_escalation_rules WHERE id = ?').get(id);
}

function deleteEscalationRule(orgId, ruleId) {
  requireOrgId(orgId);
  const db = getDatabase();
  db.prepare('DELETE FROM task_escalation_rules WHERE id = ? AND org_id = ?').run(ruleId, orgId);
  return { success: true };
}

module.exports = {
  createTask,
  updateTask,
  deleteTask,
  getTasksByPatient,
  getAllTasks,
  generateAutoTasks,
  processEscalations,
  getTaskDashboard,
  getEscalationRules,
  saveEscalationRule,
  deleteEscalationRule,
};
