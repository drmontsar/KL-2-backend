import { describe, expect, test } from 'bun:test';
import { calculateNursingScores } from '../src/clinical/nursing';

describe('nursing risk scores', () => {
  test('calculates high fall, pressure and nutrition risks', () => {
    const result = calculateNursingScores({
      morse: { history: 25, secondary: 15, aid: 0, iv: 20, gait: 10, mental: 0 },
      braden: { sensory: 2, moisture: 2, activity: 1, mobility: 1, nutrition: 2, friction: 1 },
      must: { bmi: 1, weight_loss: 1, acute: 0 },
    });
    expect(result.morse).toBe(70);
    expect(result.braden).toBe(9);
    expect(result.must).toBe(2);
    expect(result.tasks.map((task) => task.interval_minutes)).toEqual([240, 120]);
    expect(result.care_plan).toHaveLength(3);
  });

  test('does not create risk-based tasks at low-risk boundaries', () => {
    const result = calculateNursingScores({
      morse: { history: 0, secondary: 0, aid: 0, iv: 20, gait: 0, mental: 0 },
      braden: { sensory: 4, moisture: 4, activity: 4, mobility: 4, nutrition: 4, friction: 3 },
      must: { bmi: 0, weight_loss: 0, acute: 0 },
    });
    expect(result.tasks).toEqual([]);
    expect(result.care_plan).toEqual([]);
  });
});
