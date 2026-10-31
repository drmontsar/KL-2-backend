export const NEWS2_RULE_VERSION = 'NEWS2-2017-scale-1' as const;

export type Consciousness = 'alert' | 'confusion' | 'voice' | 'pain' | 'unresponsive';

export type News2Input = {
  resp_rate: number;
  spo2: number;
  on_supplemental_oxygen: boolean;
  temperature: number;
  bp_systolic: number;
  heart_rate: number;
  consciousness: Consciousness;
};

export type News2Result = {
  score: number;
  escalation: 'low' | 'low-medium' | 'medium' | 'high';
  component_scores: {
    resp_rate: number;
    spo2: number;
    supplemental_oxygen: number;
    temperature: number;
    bp_systolic: number;
    heart_rate: number;
    consciousness: number;
  };
};

function respiratoryRateScore(value: number): number {
  if (value <= 8 || value >= 25) return 3;
  if (value <= 11) return 1;
  if (value <= 20) return 0;
  return 2;
}

function spo2Score(value: number): number {
  if (value <= 91) return 3;
  if (value <= 93) return 2;
  if (value <= 95) return 1;
  return 0;
}

function temperatureScore(value: number): number {
  if (value <= 35) return 3;
  if (value <= 36) return 1;
  if (value <= 38) return 0;
  if (value <= 39) return 1;
  return 2;
}

function systolicBloodPressureScore(value: number): number {
  if (value <= 90 || value >= 220) return 3;
  if (value <= 100) return 2;
  if (value <= 110) return 1;
  return 0;
}

function heartRateScore(value: number): number {
  if (value <= 40 || value >= 131) return 3;
  if (value <= 50) return 1;
  if (value <= 90) return 0;
  if (value <= 110) return 1;
  return 2;
}

export function observationFrequencyMinutes(
  result: Pick<News2Result, 'score' | 'escalation'>,
): number {
  if (result.escalation === 'high') return 15;
  if (result.escalation === 'medium' || result.escalation === 'low-medium') return 60;
  return result.score === 0 ? 720 : 360;
}

export function calculateNews2(input: News2Input): News2Result {
  const component_scores = {
    resp_rate: respiratoryRateScore(input.resp_rate),
    spo2: spo2Score(input.spo2),
    supplemental_oxygen: input.on_supplemental_oxygen ? 2 : 0,
    temperature: temperatureScore(input.temperature),
    bp_systolic: systolicBloodPressureScore(input.bp_systolic),
    heart_rate: heartRateScore(input.heart_rate),
    consciousness: input.consciousness === 'alert' ? 0 : 3,
  };
  const scores = Object.values(component_scores);
  const score = scores.reduce((total, value) => total + value, 0);
  const escalation =
    score >= 7 ? 'high' : score >= 5 ? 'medium' : scores.includes(3) ? 'low-medium' : 'low';

  return { score, escalation, component_scores };
}
