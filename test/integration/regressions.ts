import { checkAccess } from './access';
import { checkAtomicity } from './atomicity';
import { checkClinicalState } from './clinical_state';
import { checkNotes } from './notes';
import { checkPatientIdentity } from './patient_identity';
import { assert, db } from './support';

assert.equal(
  process.env.DISPOSABLE_DATABASE,
  '1',
  'Run through scripts/test-integration.sh, not against a shared database',
);
assert.equal(process.env.NODE_ENV, 'test');
try {
  for (const check of [
    checkAccess,
    checkNotes,
    checkClinicalState,
    checkAtomicity,
    checkPatientIdentity,
  ]) {
    await check();
    console.log(`${check.name} passed`);
  }
} finally {
  await db.end();
}
