import { describe, expect, test } from 'bun:test';
import { calculateNews2, observationFrequencyMinutes } from '../src/clinical/news2';

const normal = {
  resp_rate: 16,
  spo2: 98,
  on_supplemental_oxygen: false,
  temperature: 37,
  bp_systolic: 120,
  heart_rate: 70,
  consciousness: 'alert' as const,
};

describe('calculateNews2', () => {
  test('scores normal observations as low risk', () => {
    expect(calculateNews2(normal)).toMatchObject({ score: 0, escalation: 'low' });
  });

  test('escalates a single extreme parameter', () => {
    expect(calculateNews2({ ...normal, resp_rate: 8 })).toMatchObject({
      score: 3,
      escalation: 'low-medium',
    });
  });

  test('includes supplemental oxygen and altered consciousness', () => {
    const result = calculateNews2({
      ...normal,
      spo2: 90,
      on_supplemental_oxygen: true,
      consciousness: 'confusion',
    });
    expect(result).toMatchObject({
      score: 8,
      escalation: 'high',
      component_scores: { spo2: 3, supplemental_oxygen: 2, consciousness: 3 },
    });
  });

  test.each([
    ['resp_rate', 8, 3], ['resp_rate', 9, 1], ['resp_rate', 11, 1], ['resp_rate', 12, 0], ['resp_rate', 20, 0], ['resp_rate', 21, 2], ['resp_rate', 24, 2], ['resp_rate', 25, 3],
    ['spo2', 91, 3], ['spo2', 92, 2], ['spo2', 93, 2], ['spo2', 94, 1], ['spo2', 95, 1], ['spo2', 96, 0],
    ['temperature', 35, 3], ['temperature', 35.1, 1], ['temperature', 36, 1], ['temperature', 36.1, 0], ['temperature', 38, 0], ['temperature', 38.1, 1], ['temperature', 39, 1], ['temperature', 39.1, 2],
    ['bp_systolic', 90, 3], ['bp_systolic', 91, 2], ['bp_systolic', 100, 2], ['bp_systolic', 101, 1], ['bp_systolic', 110, 1], ['bp_systolic', 111, 0], ['bp_systolic', 219, 0], ['bp_systolic', 220, 3],
    ['heart_rate', 40, 3], ['heart_rate', 41, 1], ['heart_rate', 50, 1], ['heart_rate', 51, 0], ['heart_rate', 90, 0], ['heart_rate', 91, 1], ['heart_rate', 110, 1], ['heart_rate', 111, 2], ['heart_rate', 130, 2], ['heart_rate', 131, 3],
  ] as const)('scores %s=%s as %s at the boundary', (field, value, expected) => {
    const result = calculateNews2({ ...normal, [field]: value });
    expect(result.component_scores[field]).toBe(expected);
  });

  test.each([
    [{ score: 0, escalation: 'low' }, 720],
    [{ score: 2, escalation: 'low' }, 360],
    [{ score: 3, escalation: 'low-medium' }, 60],
    [{ score: 5, escalation: 'medium' }, 60],
    [{ score: 7, escalation: 'high' }, 15],
  ] as const)('uses the escalation observation frequency', (result, expected) => {
    expect(observationFrequencyMinutes(result)).toBe(expected);
  });

  test('uses medium escalation for scores from five to six', () => {
    expect(calculateNews2({ ...normal, spo2: 93, bp_systolic: 90 })).toMatchObject({
      score: 5,
      escalation: 'medium',
    });
  });
});
