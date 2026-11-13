import { z } from 'zod';
import { hasPermission } from '../../authorization';
import { validValue } from '../../clinical/forms';
import {
  FieldValue,
  InstanceBodyInput,
  InstanceSchema,
  SaveBodyInput,
  SignBodyInput,
  Signature,
  TemplateBodyInput,
  TemplateSchema,
  Version,
} from '../../contracts/forms';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { DomainError } from '../../errors';
import { canAccessPatient } from './access';
import type { User } from './users';

type Json = Parameters<(typeof db)['json']>[0];

export async function canAccessFormVersion(user: User, versionId: string): Promise<boolean> {
  const [instance] = await db<
    { patient_id: string }[]
  >`SELECT i.patient_id FROM forms.instance_versions v JOIN forms.instances i ON i.id = v.instance_id WHERE v.id = ${versionId}`;
  return !!instance && (await canAccessPatient(user, instance.patient_id));
}

export async function listFormTemplates() {
  return db<z.infer<typeof TemplateSchema>[]>`
    SELECT t.id, t.name, t.category, v.id AS template_version_id, v.version, v.fields, v.synthetic
    FROM forms.templates t JOIN LATERAL (SELECT * FROM forms.template_versions WHERE template_id = t.id ORDER BY version DESC LIMIT 1) v ON true WHERE t.visible ORDER BY t.name
  `.catch(rethrowDatabaseError);
}

export async function createFormTemplate(body: TemplateBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [template] = await tx<
        { id: string }[]
      >`INSERT INTO forms.templates (name, category, created_by) VALUES (${body.name}, ${body.category}, ${actor_user_id}) RETURNING id`;
      const [version] = await tx<
        { id: string }[]
      >`INSERT INTO forms.template_versions (template_id, version, fields, created_by) VALUES (${template.id}, 1, ${tx.json(body.fields)}, ${actor_user_id}) RETURNING id`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'create', 'forms.templates', ${template.id}, ${tx.json(body)})`;
      return {
        id: template.id,
        name: body.name,
        category: body.category,
        template_version_id: version.id,
        version: 1,
        fields: body.fields,
        synthetic: true,
      };
    })
    .catch(rethrowDatabaseError);
}

export async function createFormInstance(body: InstanceBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      if (body.admission_id) {
        const [admission] =
          await tx`SELECT id FROM clinical.admissions WHERE id = ${body.admission_id} AND patient_id = ${body.patient_id}`;
        if (!admission) return null;
      }
      const [template] = await tx<
        { id: string; fields: FieldValue[] }[]
      >`SELECT id, fields FROM forms.template_versions WHERE template_id = ${body.template_id} ORDER BY version DESC LIMIT 1`;
      if (!template) return null;
      const [patient] = await tx<
        {
          name: string;
          uhid: string;
          phone: string | null;
          address: string | null;
          blood_group: string | null;
          abha_id: string | null;
        }[]
      >`SELECT name, uhid, phone, address, blood_group, abha_id FROM clinical.patients WHERE id = ${body.patient_id}`;
      const values: Record<string, unknown> = {};
      const sources: Record<string, unknown> = {};
      for (const field of template.fields) {
        if (field.source && field.type !== 'signature' && patient[field.source] != null) {
          values[field.key] = patient[field.source];
          sources[field.key] = { source: field.source, value: patient[field.source] };
        }
      }
      const [instance] = await tx<
        { id: string }[]
      >`INSERT INTO forms.instances (patient_id, admission_id, template_id, created_by) VALUES (${body.patient_id}, ${body.admission_id ?? null}, ${body.template_id}, ${actor_user_id}) RETURNING id`;
      const [row] = await tx<Version[]>`
      INSERT INTO forms.instance_versions (instance_id, template_version_id, version, fields, form_values, source_snapshot, created_by)
      VALUES (${instance.id}, ${template.id}, 1, ${tx.json(template.fields)}, ${tx.json(values as Json)}, ${tx.json(sources as Json)}, ${actor_user_id}) RETURNING *
    `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'create', 'forms.instance_versions', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function listPatientForms(id: string) {
  return db<
    z.infer<typeof InstanceSchema>[]
  >`SELECT * FROM forms.instances WHERE patient_id = ${id} ORDER BY created_at DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function getFormInstance(id: string) {
  return db<
    { patient_id: string }[]
  >`SELECT patient_id FROM forms.instances WHERE id = ${id}`.catch(rethrowDatabaseError);
}

export async function listFormVersions(id: string) {
  return db<
    Version[]
  >`SELECT * FROM forms.instance_versions WHERE instance_id = ${id} ORDER BY version DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function getFormVersion(id: string) {
  return db<Version[]>`SELECT * FROM forms.instance_versions WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function listFormSignatures(id: string) {
  return db<
    Signature[]
  >`SELECT * FROM forms.signatures WHERE version_id = ${id} ORDER BY signed_at`.catch(
    rethrowDatabaseError,
  );
}

export async function saveFormDraft(id: string, body: SaveBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [version] = await tx<
        Version[]
      >`SELECT * FROM forms.instance_versions WHERE id = ${id} AND status = 'draft' AND revision = ${body.expected_revision} FOR UPDATE`;
      if (!version) return null;
      const known = new Map(version.fields.map((field) => [field.key, field]));
      if (
        Object.entries(body.form_values).some(
          ([key, value]) =>
            !known.has(key) || !validValue({ ...known.get(key)!, required: false }, value),
        )
      )
        return null;
      await tx`DELETE FROM forms.signatures WHERE version_id = ${id}`;
      const [row] = await tx<
        Version[]
      >`UPDATE forms.instance_versions SET form_values = ${tx.json(body.form_values as Json)}, revision = revision + 1 WHERE id = ${id} RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'save', 'forms.instance_versions', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function signFormField(id: string, body: SignBodyInput, user: User) {
  return db
    .begin(async (tx) => {
      const [version] = await tx<
        Version[]
      >`SELECT * FROM forms.instance_versions WHERE id = ${id} AND status = 'draft' FOR UPDATE`;
      if (!version || version.status !== 'draft') return null;
      if (Number(version.revision) !== body.expected_revision) throw new DomainError('conflict');
      const field = version.fields.find(
        (item) => item.key === body.field_key && item.type === 'signature',
      );
      if (!field?.signer_role) return 'forbidden' as const;
      if (field.signer_role === 'doctor' && !hasPermission(user, 'clinical.doctor'))
        return 'forbidden' as const;
      if (field.signer_role === 'consultant' && user.job_role !== 'consultant')
        return 'forbidden' as const;
      if (field.signer_role === 'witness' && !hasPermission(user, 'clinical.nurse'))
        return 'forbidden' as const;
      if (
        field.signer_role === 'patient' &&
        !hasPermission(user, 'clinical.doctor') &&
        !hasPermission(user, 'clinical.nurse')
      )
        return 'forbidden' as const;
      const signerName = field.signer_role === 'patient' ? body.signer_name : user.name;
      const [signature] = await tx<
        Signature[]
      >`INSERT INTO forms.signatures (version_id, field_key, role, signer_name, captured_by, strokes) VALUES (${id}, ${body.field_key}, ${field.signer_role}, ${signerName}, ${user.id}, ${tx.json(body.strokes as Json)}) RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${user.id}, 'sign', 'forms.signatures', ${signature.id}, ${tx.json(signature as unknown as Json)})`;
      return signature;
    })
    .catch(rethrowDatabaseError);
}

export async function finalizeForm(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [version] = await tx<
        Version[]
      >`SELECT * FROM forms.instance_versions WHERE id = ${id} AND status = 'draft' FOR UPDATE`;
      if (!version) return null;
      const signatures = await tx<
        Signature[]
      >`SELECT * FROM forms.signatures WHERE version_id = ${id}`;
      if (
        version.fields.some((field) =>
          field.type === 'signature'
            ? field.required && !signatures.some((signature) => signature.field_key === field.key)
            : !validValue(field, version.form_values[field.key]),
        )
      )
        return null;
      const [row] = await tx<
        Version[]
      >`UPDATE forms.instance_versions SET status = 'final', finalized_by = ${actor_user_id}, finalized_at = now(), revision = revision + 1 WHERE id = ${id} RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'finalize', 'forms.instance_versions', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function createFormVersion(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [version] = await tx<
        Version[]
      >`SELECT * FROM forms.instance_versions WHERE id = ${id} AND status = 'final' FOR UPDATE`;
      if (!version) return null;
      const [latest] = await tx<
        { version: number }[]
      >`SELECT max(version)::integer AS version FROM forms.instance_versions WHERE instance_id = ${version.instance_id}`;
      if (latest.version !== version.version) return null;
      const [row] = await tx<Version[]>`
      INSERT INTO forms.instance_versions (instance_id, template_version_id, version, fields, form_values, source_snapshot, created_by)
      VALUES (${version.instance_id}, ${version.template_version_id}, ${version.version + 1}, ${tx.json(version.fields)}, ${tx.json(version.form_values as Json)}, ${tx.json(version.source_snapshot as Json)}, ${actor_user_id}) RETURNING *
    `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'new_version', 'forms.instance_versions', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}
