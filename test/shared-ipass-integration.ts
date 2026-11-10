// Run only against an isolated, seeded test database; leaves test records behind.
import { randomUUID } from 'node:crypto';
import { app } from '../src/app';
import { db } from '../src/db';
import { createSession } from '../src/db/queries/auth';

if (process.env.NODE_ENV !== 'test') throw new Error('Requires NODE_ENV=test and an isolated seeded database');
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
type Detail = { session: { id: string; status: string; incoming_doctor_id: string | null }; items: { id: string; admission_id: string; arrival_status: string; reviewed_by: string | null; receiver_view: string | null }[] };

try {
  const doctors = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'duty_doctor' AND disabled_at IS NULL ORDER BY id LIMIT 3`;
  const [consultant] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'consultant' AND disabled_at IS NULL LIMIT 1`;
  assert(doctors.length === 3 && consultant, 'Seed requires three duty doctors and a consultant');
  const [dd1, dd2, dd3] = doctors;
  const ward = `Handover test ${randomUUID()}`;
  const ids: string[] = [];
  for (const index of [1, 2, 3]) {
    const [patient] = await db<{ id: string }[]>`
      INSERT INTO clinical.patients (name, dob, created_by)
      VALUES (${`Handover patient ${index}`}, '1990-01-01', ${dd1.id}) RETURNING id
    `;
    const [admission] = await db<{ id: string }[]>`
      INSERT INTO clinical.admissions (patient_id, ward, bed, created_by, arrival_status, arrived_at, severity)
      VALUES (${patient.id}, ${ward}, ${`TEST-${index}`}, ${dd1.id},
        ${index === 3 ? 'incoming' : 'admitted'}, ${index === 3 ? null : new Date()},
        ${index === 2 ? 'watcher' : 'stable'}) RETURNING id
    `;
    ids.push(admission.id);
  }
  const [outgoing, unavailable, replacement, consultantToken] = await Promise.all([
    createSession(dd1.id), createSession(dd2.id), createSession(dd3.id), createSession(consultant.id),
  ]);
  const call = (path: string, token: string, method = 'GET', body?: unknown) => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert((await call('/handover-sessions', outgoing, 'POST', { incoming_doctor_id: dd2.id, ward })).status === 409,
    'Legacy doctor handover must not create new sessions');
  assert((await call('/ipass', consultantToken)).status === 403, 'Consultants cannot participate in duty handover');
  const created = await call('/ipass', outgoing, 'POST', { ward });
  assert(created.status === 201, `Create shared session: ${created.status} ${await created.clone().text()}`);
  const detail = await created.json() as Detail;
  assert(detail.session.incoming_doctor_id === null && detail.items.length === 3 && detail.items.some((item) => item.arrival_status === 'incoming'),
    'Handover should include incoming and admitted patients without a fixed receiver');
  const sessionPath = `/ipass/${detail.session.id}`;
  assert((await call(sessionPath, replacement)).status === 403, 'Draft must be private to outgoing doctor');
  const overlapDraft = await call('/ipass', unavailable, 'POST', { ward });
  assert(overlapDraft.status === 201 && (await overlapDraft.clone().json() as Detail).items.length === 3,
    'Another doctor may create a handover while these patients are already in a draft');
  const overlapDraftId = (await overlapDraft.json() as Detail).session.id;
  for (const item of detail.items) {
    // Flow testing permits signing with no clinical content, but retains chart/actor checks.
    const emptySave = await call(`/ipass/items/${item.id}`, outgoing, 'PATCH', {
      patient_summary: '', action_list: '', contingency: '',
    });
    assert(emptySave.status === 200, 'Empty draft saves must be allowed for flow testing');
    assert((await call(`/ipass/items/${item.id}/sign`, consultantToken, 'POST')).status === 403,
      'Empty content must not bypass authorization');
    assert((await call(`/ipass/items/${item.id}/sign`, outgoing, 'POST')).status === 200,
      'Empty handovers must be markable as ready for flow testing');
    const fields = {
      patient_summary: 'Findings and current condition', action_list: 'Review next observation', contingency: 'Escalate if worse',
    };
    if (item.id === detail.items[0].id) {
      const [before] = await db<{ revision: string; severity: string }[]>`SELECT revision, severity FROM clinical.admissions WHERE id = ${item.admission_id}`;
      const nextSeverity = before.severity === 'unstable' ? 'watcher' : 'unstable';
      const severityChange = { ...fields, severity: nextSeverity, expected_revision: Number(before.revision) };
      assert((await call(`/ipass/items/${item.id}`, consultantToken, 'PATCH', severityChange)).status === 403,
        'Consultants must not change handover or chart severity');
      assert((await call(`/ipass/items/${item.id}`, outgoing, 'PATCH', { ...severityChange, expected_revision: Number(before.revision) + 1 })).status === 409,
        'Stale chart severity writes must fail');
      const [unchanged] = await db<{ revision: string; severity: string }[]>`SELECT revision, severity FROM clinical.admissions WHERE id = ${item.admission_id}`;
      assert(String(unchanged.revision) === String(before.revision) && unchanged.severity === before.severity,
        'A rejected severity edit must not update the clinical chart');
      const changed = await call(`/ipass/items/${item.id}`, outgoing, 'PATCH', severityChange);
      assert(changed.status === 200, `Severity change failed: ${changed.status} ${await changed.clone().text()}`);
      const saved = await changed.json() as { severity: string; snapshot_revision: string };
      const [chart] = await db<{ revision: string; severity: string }[]>`SELECT revision, severity FROM clinical.admissions WHERE id = ${item.admission_id}`;
      assert(chart.severity === nextSeverity && saved.severity === nextSeverity && Number(chart.revision) === Number(before.revision) + 1 && String(chart.revision) === String(saved.snapshot_revision),
        'Severity must update both the chart and handover snapshot atomically');
    }
    const patch = await call(`/ipass/items/${item.id}`, outgoing, 'PATCH', fields);
    assert(patch.status === 200, `Outgoing doctor must write findings: ${patch.status}`);
    const initialItem = await patch.json() as { item_revision: string | number };
    const taskId = crypto.randomUUID();
    const task = { id: taskId, text: 'Review repeat blood count', done: true, high_priority: true, role: 'DD', timing: 'Shift End' };
    const taskBody = { ...fields, action_tasks: [task], expected_item_revision: Number(initialItem.item_revision) };
    assert((await call(`/ipass/items/${item.id}`, consultantToken, 'PATCH', taskBody)).status === 403,
      'Consultants cannot edit handover tasks');
    assert((await call(`/ipass/items/${item.id}`, outgoing, 'PATCH', { ...taskBody, expected_item_revision: undefined })).status === 400,
      'Structured task saves require an item revision');
    const taskSave = await call(`/ipass/items/${item.id}`, outgoing, 'PATCH', taskBody);
    assert(taskSave.status === 200, `Task save failed: ${taskSave.status} ${await taskSave.clone().text()}`);
    const taskResult = await taskSave.json() as { action_tasks: typeof task[]; item_revision: string | number; action_list: string };
    assert(taskResult.action_tasks[0]?.done && taskResult.action_tasks[0]?.high_priority && taskResult.action_tasks[0]?.id === taskId,
      'Completion, priority and task identity must persist');
    assert(taskResult.action_list.includes('☑ [HIGH] Review repeat blood count · DD · Shift End'),
      'Legacy readers must see the structured tasks in action_list');
    assert((await call(`/ipass/items/${item.id}`, outgoing, 'PATCH', taskBody)).status === 409,
      'Stale task saves must not overwrite a newer checklist');
    const reopened = await call(sessionPath, outgoing);
    const reopenedDetail = await reopened.json() as { items: { id: string; action_tasks: typeof task[] }[] };
    assert(reopenedDetail.items.find((entry) => entry.id === item.id)?.action_tasks[0]?.done,
      'Reopening the session must retain task completion');
    assert((await call(`/ipass/items/${item.id}/sign`, outgoing, 'POST')).status === 200, 'Item signing failed');
  }
  const overlapSigned = await call('/ipass', replacement, 'POST', { ward });
  assert(overlapSigned.status === 201 && (await overlapSigned.clone().json() as Detail).items.length === 3,
    'Another doctor may create a handover while these patients have signed items');
  const overlapSignedId = (await overlapSigned.json() as Detail).session.id;
  assert((await call(`/ipass/${overlapDraftId}/cancel`, unavailable, 'POST')).status === 200, 'Cancelling overlapping draft failed');
  assert((await call(`/ipass/${overlapSignedId}/cancel`, replacement, 'POST')).status === 200, 'Cancelling overlapping signed-session draft failed');
  assert((await call(`${sessionPath}/send`, outgoing, 'POST')).status === 200, 'Sending shared handover failed');
  const queue = await call('/ipass', replacement);
  assert(queue.status === 200 && (await queue.json() as { id: string }[]).some((row) => row.id === detail.session.id),
    'Replacement doctor must discover sent handover on login');
  assert((await call(sessionPath, unavailable)).status === 200, 'Original receiver must also be able to view shared handover');
  const [first, second] = detail.items;
  const firstAccept = await call(`/ipass/items/${first.id}/accept`, replacement, 'POST', { receiver_view: 'Reviewed chart and agree with the plan', readback: 'Monitor and escalate if worse' });
  assert(firstAccept.status === 200, `Replacement doctor acceptance failed: ${firstAccept.status} ${await firstAccept.clone().text()}`);
  assert((await call(`/ipass/items/${first.id}/accept`, unavailable, 'POST', { receiver_view: 'Duplicate review' })).status === 409,
    'Another doctor must not accept a previously reviewed patient');
  const part = await call(sessionPath, replacement);
  assert((await part.json() as Detail).session.status === 'sent', 'Session must remain open while a patient is pending');
  await db`UPDATE clinical.admissions SET revision = revision + 1 WHERE id = ${second.admission_id}`;
  const secondPath = `/ipass/items/${second.id}/accept`;
  assert((await call(secondPath, replacement, 'POST', { receiver_view: 'Rechecked chart', readback: 'Escalate if worse' })).status === 409,
    'A changed chart must require explicit stale acknowledgment');
  const secondAccept = await call(secondPath, replacement, 'POST', {
    receiver_view: 'Reviewed updated chart and agree with plan', readback: 'Escalate if worse', acknowledge_stale: true,
  });
  assert(secondAccept.status === 200, `Stale acknowledged review failed: ${secondAccept.status} ${await secondAccept.clone().text()}`);
  assert((await (await call(sessionPath, replacement)).json() as Detail).session.status === 'sent',
    'Session remains open until the incoming patient is reviewed');
  const [remaining] = detail.items.filter((item) => item.id !== first.id && item.id !== second.id);
  assert((await call(`/ipass/items/${remaining.id}/accept`, replacement, 'POST', {
    receiver_view: 'Incoming patient expected; review on arrival',
  })).status === 200, 'Incoming patient must be included in the handover');
  const completed = await call(sessionPath, replacement);
  const finished = await completed.json() as Detail & { items: (Detail['items'][number] & { stale_acknowledged: boolean })[] };
  assert(finished.session.status === 'completed' && finished.items.every((item) => item.reviewed_by === dd3.id && item.receiver_view),
    'All patient reviews must complete the session and preserve DD3 attribution');
  assert(finished.items.some((item) => item.stale_acknowledged), 'Stale review acknowledgment must be recorded');
  console.log('Shared I-PASS duty-doctor handover integration passed');
} finally {
  await db.end();
}
