// Run only against an isolated, migrated, seeded disposable database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app';
import { db } from '../src/db';
import { createSession } from '../src/db/queries/auth';

if (process.env.NODE_ENV !== 'test' || process.env.DISPOSABLE_DATABASE !== '1') throw new Error('Requires an isolated disposable test database');
try {
  const [doctor] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'duty_doctor' AND disabled_at IS NULL LIMIT 1`;
  const [nurse] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'staff_nurse' AND disabled_at IS NULL LIMIT 1`;
  assert(doctor && nurse, 'Requires seeded clinical staff');
  const token = await createSession(doctor.id);
  const nurseToken = await createSession(nurse.id);
  const request = (path: string, body?: unknown, bearer = token) => app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const [patient] = await db<{ id: string }[]>`INSERT INTO clinical.patients (name, dob, created_by) VALUES ('Workspace pagination test', '1970-01-01', ${doctor.id}) RETURNING id`;
  const [admission] = await db<{ id: string }[]>`INSERT INTO clinical.admissions (patient_id, ward, bed, created_by, assigned_to, arrival_status, arrived_at) VALUES (${patient.id}, 'Workspace test', ${randomUUID()}, ${doctor.id}, ${nurse.id}, 'admitted', now()) RETURNING id`;
  const admissionId = admission.id;
  await db`INSERT INTO clinical.vitals (admission_id, recorded_by, recorded_at, heart_rate)
    SELECT ${admissionId}, ${doctor.id}, now() - ((n / 10) * interval '1 minute'), 80 FROM generate_series(1, 103) n`;
  const expected = await db<{ id: string }[]>`SELECT id FROM clinical.vitals WHERE admission_id = ${admissionId} ORDER BY recorded_at DESC, event_order DESC`;
  const seen: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const response = await request(`/admissions/${admissionId}/vitals?limit=17${before ? `&before=${before}` : ''}`);
    assert.equal(response.status, 200, await response.clone().text());
    const rows = await response.json() as { id: string }[];
    seen.push(...rows.map(row => row.id));
    if (rows.length < 17) break;
    before = rows.at(-1)?.id;
  }
  assert.deepEqual(seen, expected.map(row => row.id));
  assert.equal(new Set(seen).size, 103);
  assert.equal((await request(`/admissions/${admissionId}/vitals?before=invalid`)).status, 400);
  const missingCursor = await request(`/admissions/${admissionId}/vitals?before=ffffffff-ffff-4fff-8fff-ffffffffffff`);
  assert.deepEqual(await missingCursor.json(), []);
  const orderResponse = await request(`/admissions/${admissionId}/orders`, { kind: 'nursing', payload: { tasks: ['Reposition patient'] } });
  assert.equal(orderResponse.status, 201, await orderResponse.clone().text());
  const order = await orderResponse.json() as { id: string };
  assert.equal((await request(`/orders/${order.id}/confirm`, {})).status, 200);
  const tasks = await (await request(`/admissions/${admissionId}/tasks`)).json() as { id: string }[];
  assert.equal(tasks.length, 1);
  for (const operation of ['complete', 'cancel']) assert.equal((await request(`/tasks/${tasks[0].id}/${operation}`, {})).status, 403);
  await db`INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by) VALUES (${admissionId}, ${nurse.id}, 'primary_nurse', ${doctor.id}) ON CONFLICT DO NOTHING`;
  const completed = await request(`/tasks/${tasks[0].id}/complete`, {}, nurseToken);
  assert.equal(completed.status, 200, await completed.clone().text());
  assert.equal(((await completed.json()) as { completed_by: string }).completed_by, nurse.id);
  const [room] = await db<{ id: string; unit_id: string }[]>`SELECT r.id, w.unit_id FROM organization.rooms r JOIN organization.wards w ON w.id = r.ward_id LIMIT 1`;
  assert(room, 'Requires a seeded managed room');
  const [bed] = await db<{ id: string }[]>`INSERT INTO organization.beds (room_id, label) VALUES (${room.id}, ${randomUUID()}) RETURNING id`;
  await db`UPDATE clinical.admissions SET bed_id = ${bed.id} WHERE id = ${admissionId}`;
  await db`UPDATE clinical.vitals SET news2_score = 6, news2_escalation = 'medium', news2_rule_version = 'test', news2_component_scores = '{}'::jsonb WHERE id = ${expected[0].id}`;
  const visitBody = { admission_id: admissionId, movement_type: 'temporary', destination_area: 'CT', reason: 'Imaging', escort: 'nurse', equipment: [] };
  assert.equal((await request('/patient-movements', visitBody)).status, 403);
  assert.equal((await request('/patient-movements', { ...visitBody, escort: 'porter' }, nurseToken)).status, 409);
  const visitResponse = await request('/patient-movements', visitBody, nurseToken);
  assert.equal(visitResponse.status, 201, await visitResponse.clone().text());
  const visit = await visitResponse.json() as { id: string };
  for (const operation of ['depart', 'arrive', 'return', 'cancel']) assert.equal((await request(`/patient-movements/${visit.id}/${operation}`, {})).status, 403);
  for (const operation of ['depart', 'return']) {
    const response = await request(`/patient-movements/${visit.id}/${operation}`, {}, nurseToken);
    assert.equal(response.status, 200, await response.clone().text());
    if (operation === 'depart') assert.equal((await request(`/patient-movements/${visit.id}/arrive`, {}, nurseToken)).status, 409);
  }
  const permanentResponse = await request('/patient-movements', { admission_id: admissionId, movement_type: 'permanent', destination_unit_id: room.unit_id, reason: 'Bed transfer', escort: 'nurse', equipment: [] });
  assert.equal(permanentResponse.status, 201, await permanentResponse.clone().text());
  const permanent = await permanentResponse.json() as { id: string };
  assert.equal((await request(`/patient-movements/${permanent.id}/cancel`, {})).status, 200);
  const clinicalContext = { provisional_diagnoses: ['Possible pneumonia', 'possible pneumonia'], observation_frequency: 'Every 4 hours', observation_reason: 'Monitor respiratory status' };
  assert.equal((await request(`/admissions/${admissionId}/notes`, {kind:'progress',draft_body:'Doctor assessment',clinical_context:clinicalContext}, nurseToken)).status,403);
  assert.equal((await request(`/admissions/${admissionId}/notes`, {kind:'progress',draft_body:'Doctor assessment',clinical_context:{observation_frequency:'Every 4 hours'}})).status,400);
  const noteResponse=await request(`/admissions/${admissionId}/notes`, {kind:'progress',draft_body:'Doctor assessment',clinical_context:clinicalContext});
  assert.equal(noteResponse.status,201,await noteResponse.clone().text());
  const savedNote=await noteResponse.json() as {clinical_context:unknown};
  assert.deepEqual(savedNote.clinical_context,clinicalContext);
  const diagnoses=await db`SELECT * FROM clinical.diagnoses WHERE admission_id=${admissionId}`;
  assert.equal(diagnoses.length,1,'case-insensitive provisional diagnoses are inserted once with the note');
  assert.equal(diagnoses[0].created_by,doctor.id);
  const draftResponse = await request(`/admissions/${admissionId}/notes`, {kind:'progress',draft_body:'Unfinished assessment',documentation_status:'draft',clinical_context:{provisional_diagnoses:['Possible asthma'],observation_frequency:'Every 2 hours'}});
  assert.equal(draftResponse.status,201,await draftResponse.clone().text());
  const draft = await draftResponse.json() as {id:string;revision:number;created_at:string;saved_at:string|null};
  assert.equal(draft.saved_at,null);
  const beforeDraftSave = await db`SELECT id FROM clinical.diagnoses WHERE admission_id=${admissionId}`;
  assert.equal(beforeDraftSave.length,1,'private draft context does not become a clinical diagnosis');
  const nurseNotes = await app.request(`/admissions/${admissionId}/notes`,{headers:{Authorization:`Bearer ${nurseToken}`}});
  assert.equal(nurseNotes.status,200);
  assert(!(await nurseNotes.json() as {id:string}[]).some(note=>note.id===draft.id),'another staff member cannot see a private draft');
  assert.equal((await app.request(`/notes/${draft.id}/versions`,{headers:{Authorization:`Bearer ${nurseToken}`}})).status,403);
  const editDraft = (body:unknown, sessionToken=token) => app.request(`/notes/${draft.id}/draft`,{method:'PATCH',headers:{Authorization:`Bearer ${sessionToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await editDraft({draft_body:'Other staff edit',expected_revision:draft.revision},nurseToken)).status,403);
  assert.equal((await editDraft({draft_body:'Stale edit',expected_revision:draft.revision+1,documentation_status:'draft'})).status,409);
  const savedResponse=await editDraft({draft_body:'Reviewed assessment',expected_revision:draft.revision,documentation_status:'saved',clinical_context:{provisional_diagnoses:['Possible asthma'],observation_frequency:'Every 2 hours',observation_reason:'Review breathing after treatment'},saved_at:'2099-01-01T00:00:00Z',author_stamp:{name:'Spoofed identity'}});
  assert.equal(savedResponse.status,200,await savedResponse.clone().text());
  const published = await savedResponse.json() as {saved_at:string;created_at:string;author_stamp:{user_id:string;name:string;registration_number:string|null}};
  assert(published.saved_at && Date.parse(published.saved_at)>=Date.parse(draft.created_at));
  assert(Date.parse(published.saved_at)<Date.parse('2099-01-01T00:00:00Z'));
  assert.equal(published.author_stamp.user_id,doctor.id);assert.notEqual(published.author_stamp.name,'Spoofed identity');
  const publishedDiagnoses=await db`SELECT id FROM clinical.diagnoses WHERE admission_id=${admissionId}`;
  assert.equal(publishedDiagnoses.length,2,'diagnosis applies only on final save');
  const templateResponse=await request('/forms/templates',{name:'Workspace signed consent',category:'Test',fields:[{key:'patient_name',label:'Patient name',type:'text',source:'name',required:true},{key:'doctor_signature',label:'Doctor signature',type:'signature',signer_role:'doctor',required:true}]});
  assert.equal(templateResponse.status,201,await templateResponse.clone().text());
  const template=await templateResponse.json() as {id:string};
  const instanceResponse=await request('/forms/instances',{patient_id:patient.id,admission_id:admissionId,template_id:template.id});
  assert.equal(instanceResponse.status,201,await instanceResponse.clone().text());
  const version=await instanceResponse.json() as {id:string;revision:number;form_values:Record<string,unknown>};
  assert.equal(version.form_values.patient_name,'Workspace pagination test');
  const strokes=[[[.1,.2],[.3,.5],[.7,.3]]];
  const signBody={field_key:'doctor_signature',signer_name:'Spoofed name',strokes,expected_revision:version.revision};
  assert.equal((await request(`/forms/versions/${version.id}/signatures`,signBody,nurseToken)).status,403);
  assert.equal((await request(`/forms/versions/${version.id}/signatures`,{...signBody,expected_revision:version.revision+1})).status,409);
  const signatureResponse=await request(`/forms/versions/${version.id}/signatures`,signBody);
  assert.equal(signatureResponse.status,201,await signatureResponse.clone().text());
  const signature=await signatureResponse.json() as {strokes:unknown;signer_name:string};
  assert.deepEqual(signature.strokes,strokes);
  assert.notEqual(signature.signer_name,'Spoofed name','doctor identity comes from authenticated session');
  const finalized=await request(`/forms/versions/${version.id}/finalize`,{});
  assert.equal(finalized.status,200,await finalized.clone().text());
  assert.equal((await request(`/forms/versions/${version.id}/signatures`,signBody)).status,409);
  const planResponse=await request('/discharge-plans',{admission_id:admissionId,discharge_type:'home',planned_at:new Date(Date.now()+86400000).toISOString(),condition:'Stable for planned discharge',follow_up:'Clinic review'});
  assert.equal(planResponse.status,201,await planResponse.clone().text());
  const plan=await planResponse.json() as {id:string;plan?:{id:string}};
  const planId=plan.plan?.id??plan.id;
  await db`UPDATE clinical.discharge_plans SET status='approved',approved_by=${doctor.id},approved_at=now() WHERE id=${planId}`;
  assert.equal((await request(`/discharge-plans/${planId}/summary`,{summary:'Reviewed discharge summary'})).status,400);
  const summaryResponse=await request(`/discharge-plans/${planId}/summary`,{summary:'Reviewed discharge summary',final_diagnosis:'Pneumonia'});
  assert.equal(summaryResponse.status,200,await summaryResponse.clone().text());
  const [savedPlan]=await db`SELECT final_diagnosis FROM clinical.discharge_plans WHERE id=${planId}`;
  assert.equal(savedPlan.final_diagnosis,'Pneumonia');
  console.log('PASS: stable vitals, nurse-only controls, explicit note context with atomic diagnoses, prefilled forms, authenticated signature ink/revisions and required final diagnosis');
} finally {
  await db.end();
}
