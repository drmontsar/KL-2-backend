import { expect, test } from 'bun:test';
import { ClinicalContextSchema } from '../src/contracts/common';
import { SummaryBody } from '../src/contracts/discharge_plans';
import { SignBody } from '../src/contracts/forms';

test('clinical context requires an explicit observation frequency and clinical reason together', () => {
  expect(ClinicalContextSchema.safeParse({observation_frequency:'Every 4 hours'}).success).toBe(false);
  expect(ClinicalContextSchema.safeParse({observation_reason:'Watch respiratory status'}).success).toBe(false);
  expect(ClinicalContextSchema.parse({provisional_diagnoses:['  Possible pneumonia  '],observation_frequency:'Every 4 hours',observation_reason:'Watch respiratory status'}).provisional_diagnoses).toEqual(['Possible pneumonia']);
  expect(ClinicalContextSchema.safeParse({provisional_diagnoses:Array(21).fill('Possible pneumonia')}).success).toBe(false);
});
test('a signed discharge summary requires a nonblank final diagnosis', () => {
  expect(SummaryBody.safeParse({summary:'Ready for discharge'}).success).toBe(false);
  expect(SummaryBody.safeParse({summary:'Ready for discharge',final_diagnosis:'   '}).success).toBe(false);
  expect(SummaryBody.parse({summary:'Ready for discharge',final_diagnosis:' Pneumonia '}).final_diagnosis).toBe('Pneumonia');
});
test('signature capture requires ink, bounded coordinates and the reviewed revision', () => {
  const base={field_key:'signature',signer_name:'Test signer',expected_revision:1};
  for(const strokes of [[], [[[.5,.5],[.5,.5]]], [[[0,0],[2,1]]], [[[0,0]]]]) expect(SignBody.safeParse({...base,strokes}).success).toBe(false);
  expect(SignBody.safeParse({...base,strokes:[[[0,0],[1,1]]]}).success).toBe(true);
  expect(SignBody.safeParse({field_key:'signature',signer_name:'Test signer',strokes:[[[0,0],[1,1]]]}).success).toBe(false);
});
