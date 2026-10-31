import { z } from 'zod';
import {
  ActionBodyInput,
  Claim,
  ClaimQuery,
  CreateBodyInput,
  DepositBodyInput,
  DepositSchema,
  Event,
} from '../../contracts/claims';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { canAccessAdmission } from './access';
import type { User } from './users';

type Json = Parameters<(typeof db)['json']>[0];

export async function canAccessClaim(user: User, admissionId: string): Promise<boolean> {
  if (user.job_role === 'administrator') return true;
  if (user.job_role === 'billing_insurance') {
    const [row] =
      await db`SELECT a.id FROM clinical.admissions a JOIN staff.unit_memberships m ON m.unit_id = a.unit_id WHERE a.id = ${admissionId} AND m.user_id = ${user.id}`;
    return Boolean(row);
  }
  return user.role === 'doctor' && (await canAccessAdmission(user, admissionId));
}

export async function recordDeposit(body: DepositBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<z.infer<typeof DepositSchema>[]>`
        INSERT INTO finance.deposits (admission_id, amount, currency, reference, recorded_by)
        SELECT id, ${body.amount}::numeric, ${body.currency}, ${body.reference}, ${actor_user_id}
        FROM clinical.admissions WHERE id = ${body.admission_id} AND status = 'active' RETURNING *
      `;
      if (!row) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'record', 'finance.deposits', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function createClaim(body: CreateBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Claim[]>`
        INSERT INTO finance.claims (admission_id, coverage_id, currency, estimate, created_by)
        SELECT a.id, p.id, ${body.currency}, ${body.estimate}::numeric, ${actor_user_id}
        FROM clinical.admissions a JOIN clinical.patient_coverage p ON p.patient_id = a.patient_id
        WHERE a.id = ${body.admission_id} AND a.status = 'active' AND p.id = ${body.coverage_id} RETURNING *
      `;
      if (!row) return null;
      await tx`INSERT INTO finance.claim_events (claim_id, type, actor_id) VALUES (${row.id}, 'created', ${actor_user_id})`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'create', 'finance.claims', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function listClaims(user: User) {
  return db<Claim[]>`
    SELECT f.* FROM finance.claims f JOIN clinical.admissions a ON a.id = f.admission_id
    WHERE ${user.job_role === 'administrator'}
      OR (${user.job_role === 'billing_insurance'} AND EXISTS (SELECT 1 FROM staff.unit_memberships m WHERE m.user_id = ${user.id} AND m.unit_id = a.unit_id))
      OR (${user.role === 'doctor'} AND (a.assigned_doctor_id = ${user.id} OR EXISTS (SELECT 1 FROM clinical.staff_assignments sa WHERE sa.admission_id = a.id AND sa.user_id = ${user.id} AND sa.ends_at IS NULL)))
    ORDER BY f.updated_at DESC LIMIT 200
  `.catch(rethrowDatabaseError);
}

export async function getClaim(id: string) {
  return db<Claim[]>`SELECT * FROM finance.claims WHERE id = ${id}`.catch(rethrowDatabaseError);
}

export async function getClaimsClaimsQueries(id: string) {
  return db<
    ClaimQuery[]
  >`SELECT * FROM finance.claim_queries WHERE claim_id = ${id} ORDER BY raised_at DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function getClaimsClaimsEvents(id: string) {
  return db<
    Event[]
  >`SELECT * FROM finance.claim_events WHERE claim_id = ${id} ORDER BY created_at DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function applyClaimAction(id: string, body: ActionBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [claim] = await tx<
        Claim[]
      >`SELECT * FROM finance.claims WHERE id = ${id} AND revision = ${body.expected_revision} FOR UPDATE`;
      if (!claim) return null;
      if (
        (body.approved_limit !== undefined && body.action !== 'approve') ||
        ((body.current_usage !== undefined || body.estimate !== undefined) &&
          body.action !== 'update_costs')
      )
        return null;
      let status = claim.status;
      let finalApproved = claim.final_approved;
      let enhancement = claim.enhancement_pending;
      switch (body.action) {
        case 'send_preauthorization':
          if (claim.status !== 'draft') return null;
          status = 'preauthorization_sent';
          break;
        case 'raise_query':
          if (!['preauthorization_sent', 'approved'].includes(claim.status) || !body.note)
            return null;
          await tx`INSERT INTO finance.claim_queries (claim_id, question, raised_by) VALUES (${id}, ${body.note}, ${actor_user_id})`;
          status = 'query_raised';
          break;
        case 'reply_query': {
          if (claim.status !== 'query_raised' || !body.note) return null;
          const [query] =
            await tx`UPDATE finance.claim_queries SET reply = ${body.note}, replied_by = ${actor_user_id}, replied_at = now() WHERE claim_id = ${id} AND replied_at IS NULL RETURNING id`;
          if (!query) return null;
          status = 'preauthorization_sent';
          break;
        }
        case 'approve':
          if (
            claim.status !== 'preauthorization_sent' ||
            !body.approved_limit ||
            Number(body.approved_limit) <= 0
          )
            return null;
          status = 'approved';
          enhancement = false;
          break;
        case 'request_enhancement':
          if (claim.status !== 'approved' || claim.enhancement_pending || !body.note) return null;
          status = 'preauthorization_sent';
          enhancement = true;
          break;
        case 'update_costs':
          if (body.current_usage === undefined && body.estimate === undefined) return null;
          break;
        case 'bill_discharge': {
          if (claim.status !== 'approved') return null;
          const [plan] = await tx`
          SELECT p.id FROM clinical.discharge_plans p WHERE p.admission_id = ${claim.admission_id} AND p.status = 'approved'
            AND NOT EXISTS (
              SELECT 1 FROM clinical.discharge_tasks t WHERE t.plan_id = p.id
                AND t.code IN ('summary','pending_results','medication_reconciliation','nursing') AND t.status <> 'completed'
            )
        `;
          if (!plan) return null;
          status = 'discharge_billed';
          break;
        }
        case 'final_approve':
          if (claim.status !== 'discharge_billed' || claim.final_approved) return null;
          finalApproved = true;
          break;
      }
      const [updated] = await tx<Claim[]>`
      UPDATE finance.claims SET status = ${status}, approved_limit = COALESCE(${body.approved_limit ?? null}::numeric, approved_limit),
        current_usage = COALESCE(${body.current_usage ?? null}::numeric, current_usage), estimate = COALESCE(${body.estimate ?? null}::numeric, estimate),
        final_approved = ${finalApproved}, enhancement_pending = ${enhancement}, revision = revision + 1, updated_at = now()
      WHERE id = ${id} RETURNING *
    `;
      await tx`INSERT INTO finance.claim_events (claim_id, type, note, actor_id) VALUES (${id}, ${body.action}, ${body.note}, ${actor_user_id})`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, before, after) VALUES (${actor_user_id}, ${body.action}, 'finance.claims', ${id}, ${tx.json(claim as unknown as Json)}, ${tx.json(updated as unknown as Json)})`;
      return updated;
    })
    .catch(rethrowDatabaseError);
}
