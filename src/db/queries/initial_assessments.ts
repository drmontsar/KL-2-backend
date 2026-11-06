import type { InitialAssessment, InitialAssessmentInput } from '../../contracts/initial_assessment';
import { z } from 'zod';
import { ActiveAdmissionSchema } from '../../contracts/common';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';

export function listRequiredInitialAssessments() {
  return db<z.infer<typeof ActiveAdmissionSchema>[]>`
    SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
    FROM clinical.admissions a JOIN clinical.patients p ON p.id = a.patient_id
    WHERE a.status = 'active' AND a.arrival_status = 'admitted'
      AND EXISTS (SELECT 1 FROM clinical.admission_checklist_items c
        WHERE c.admission_id = a.id AND c.code = 'doctor_assessment' AND c.status = 'pending')
      AND NOT EXISTS (SELECT 1 FROM clinical.initial_assessments ia WHERE ia.admission_id = a.id)
    ORDER BY a.arrived_at ASC, a.id ASC
  `.catch(rethrowDatabaseError);
}

export function getInitialAssessment(admissionId: string) {
  return db<InitialAssessment[]>`
    SELECT * FROM clinical.initial_assessments WHERE admission_id = ${admissionId}
  `.catch(rethrowDatabaseError);
}

export function signInitialAssessment(admissionId: string, doctorId: string, body: InitialAssessmentInput) {
  return db.begin(async (tx) => {
    const [admission] = await tx`
      SELECT id FROM clinical.admissions WHERE id = ${admissionId} AND status = 'active'
        AND arrival_status = 'admitted' FOR UPDATE
    `;
    if (!admission) return null;
    const [checklist] = await tx`
      SELECT id FROM clinical.admission_checklist_items
      WHERE admission_id = ${admissionId} AND code = 'doctor_assessment' AND status = 'pending' FOR UPDATE
    `;
    if (!checklist) return null;
    const [assessment] = await tx<InitialAssessment[]>`
      INSERT INTO clinical.initial_assessments
        (admission_id, chief_complaint, history, examination, clinical_impression, plan, assessed_by)
      VALUES (${admissionId}, ${body.chief_complaint}, ${body.history}, ${body.examination},
        ${body.clinical_impression}, ${body.plan}, ${doctorId}) RETURNING *
    `;
    await tx`
      UPDATE clinical.admission_checklist_items
      SET status = 'completed', completed_by = ${doctorId}, completed_at = now(),
        evidence = ${`Initial assessment ${assessment.id}`}
      WHERE id = ${checklist.id}
    `;
    await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${doctorId}, 'sign', 'clinical.initial_assessments', ${assessment.id}, ${tx.json(assessment)})
    `;
    return assessment;
  }).catch(rethrowDatabaseError);
}
