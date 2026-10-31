import { rethrowDatabaseError } from '../errors';
import { db } from '../index';

export async function listOverdueTasks(ids: string[], role: 'doctor' | 'nurse' | 'admin') {
  return db<
    {
      id: string;
      admission_id: string;
      patient_name: string;
      ward: string | null;
      bed: string | null;
      type:
        | 'observation'
        | 'task'
        | 'order'
        | 'alert'
        | 'nursing_task'
        | 'medication'
        | 'nursing_assessment';
      status: string;
      due_at: Date | null;
      priority: string;
    }[]
  >`
      WITH scoped AS (
        SELECT a.id, a.ward, a.bed, p.name AS patient_name
        FROM clinical.admissions a JOIN clinical.patients p ON p.id = a.patient_id
        WHERE a.id IN ${db(ids)} AND a.status = 'active'
      ), items AS (
        SELECT s.admission_id AS id, s.admission_id, 'observation'::text AS type,
          CASE WHEN s.next_due_at <= now() THEN 'overdue' ELSE 'due' END AS status,
          s.next_due_at AS due_at, 'routine'::text AS priority
        FROM clinical.observation_schedules s
        JOIN scoped a ON a.id = s.admission_id
        WHERE s.next_due_at <= now() + interval '30 minutes'
        UNION ALL
        SELECT t.id, t.admission_id, 'task',
          CASE WHEN t.due_at < now() THEN 'overdue' ELSE 'pending' END,
          t.due_at, o.priority
        FROM clinical.tasks t JOIN scoped a ON a.id = t.admission_id
        JOIN clinical.orders o ON o.id = t.order_id
        WHERE t.status = 'pending'
        UNION ALL
        SELECT o.id, o.admission_id, 'order', o.status, NULL::timestamptz, o.priority
        FROM clinical.orders o JOIN scoped a ON a.id = o.admission_id
        WHERE o.status = 'draft' AND ${role !== 'nurse'}
        UNION ALL
        SELECT al.id, al.admission_id, 'alert', al.status, al.created_at,
          CASE WHEN al.severity = 'warning' THEN 'stat' ELSE 'urgent' END
        FROM clinical.alerts al JOIN scoped a ON a.id = al.admission_id
        WHERE al.status = 'active'
        UNION ALL
        SELECT nt.id, nt.admission_id, 'nursing_task',
          CASE WHEN nt.due_at < now() THEN 'overdue' ELSE 'due' END,
          nt.due_at, 'routine'
        FROM clinical.nursing_recurring_tasks nt JOIN scoped a ON a.id = nt.admission_id
        WHERE ${role === 'nurse'} AND nt.status = 'active' AND nt.due_at <= now() + interval '1 hour'
        UNION ALL
        SELECT d.id, s.admission_id, 'medication',
          CASE WHEN d.due_at < now() THEN 'overdue' ELSE 'due' END,
          d.due_at, o.priority
        FROM clinical.medication_doses d JOIN clinical.medication_schedules s ON s.id = d.schedule_id
        JOIN clinical.orders o ON o.id = s.order_id JOIN scoped a ON a.id = s.admission_id
        WHERE ${role === 'nurse'} AND d.status = 'scheduled' AND s.active AND o.status = 'confirmed'
          AND d.due_at <= now() + interval '1 hour'
        UNION ALL
        SELECT a.id, a.id, 'nursing_assessment',
          CASE WHEN assessment.id IS NULL THEN 'missing' ELSE 'overdue' END,
          assessment.reassess_by, 'routine'
        FROM scoped a LEFT JOIN LATERAL (
          SELECT id, reassess_by FROM clinical.nursing_assessments WHERE admission_id = a.id ORDER BY assessed_at DESC LIMIT 1
        ) assessment ON true
        WHERE ${role === 'nurse'} AND (assessment.id IS NULL OR assessment.reassess_by <= now())
      )
      SELECT i.*, a.patient_name, a.ward, a.bed FROM items i JOIN scoped a ON a.id = i.admission_id
      ORDER BY CASE i.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
               i.due_at NULLS LAST, i.id
    `.catch(rethrowDatabaseError);
}
