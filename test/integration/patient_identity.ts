import { actor, admission, assert, db, request } from './support';

export async function checkPatientIdentity() {
  const doctor = await actor();
  const a = await admission(doctor);
  const response = await request(doctor, `/patients/${a.patient.id}`, 'PATCH', {
    phone: '',
    address: '',
    abha_id: '',
    expected_revision: Number(a.patient.revision),
  });
  assert.equal(response.status, 200);
  const cleared = (await response.json()) as {
    phone: string | null;
    address: string | null;
    abha_id: string | null;
    revision: string | number;
  };
  assert.equal(cleared.phone, null);
  assert.equal(cleared.address, null);
  assert.equal(cleared.abha_id, null);
  const [contacts] =
    await db`SELECT count(*)::int AS n FROM clinical.patient_contacts WHERE patient_id = ${a.patient.id} AND is_primary AND type IN ('phone','address')`;
  const [abha] =
    await db`SELECT count(*)::int AS n FROM clinical.patient_identifiers WHERE patient_id = ${a.patient.id} AND type = 'abha'`;
  assert.equal(contacts.n, 0);
  assert.equal(abha.n, 0);
  assert.equal(
    (
      await request(doctor, `/patients/${a.patient.id}`, 'PATCH', {
        phone: '987654321',
        expected_revision: Number(cleared.revision),
      })
    ).status,
    200,
  );
  const [contact] =
    await db`SELECT value FROM clinical.patient_contacts WHERE patient_id = ${a.patient.id} AND type = 'phone' AND is_primary`;
  assert.equal(contact.value, '987654321');
}
