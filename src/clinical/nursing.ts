import type { AssessmentBodyInput } from '../contracts/nursing';

export type NursingScores = {
  morse: {
    history: 0 | 25;
    secondary: 0 | 15;
    aid: 0 | 15 | 30;
    iv: 0 | 20;
    gait: 0 | 10 | 20;
    mental: 0 | 15;
  };
  braden: {
    sensory: number;
    moisture: number;
    activity: number;
    mobility: number;
    nutrition: number;
    friction: number;
  };
  must: { bmi: 0 | 1 | 2; weight_loss: 0 | 1 | 2; acute: 0 | 2 };
};

export function calculateNursingScores(input: NursingScores) {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const morse = sum(Object.values(input.morse));
  const braden = sum(Object.values(input.braden));
  const must = sum(Object.values(input.must));
  const care_plan: string[] = [];
  const tasks: { description: string; interval_minutes: number }[] = [];
  if (morse >= 45) {
    care_plan.push('Fall precautions: low bed, rails up, call bell in reach, fall-risk band');
    tasks.push({ description: 'Fall precautions check', interval_minutes: 240 });
  } else if (morse >= 25) {
    care_plan.push('Fall precautions: rails up and call bell in reach');
  }
  if (braden <= 12) {
    care_plan.push('Turn 2-hourly, off-load heels and check skin each shift');
    tasks.push({ description: 'Position change and pressure-area check', interval_minutes: 120 });
  } else if (braden <= 18) {
    care_plan.push('Turn 2–4-hourly and check skin each shift');
    tasks.push({ description: 'Position change and pressure-area check', interval_minutes: 240 });
  }
  if (must >= 2) care_plan.push('Dietitian referral and food and fluid chart');
  else if (must === 1) care_plan.push('Food chart for three days; re-screen weekly');
  return { morse, braden, must, care_plan, tasks };
}

export function buildNursingCarePlan(body: AssessmentBodyInput) {
  const scores = calculateNursingScores(body);
  if (body.pain_score >= 4)
    scores.care_plan.push(
      `Pain ${body.pain_score}/10: inform duty doctor and reassess after analgesia`,
    );
  for (const device of body.devices) {
    if (/central|arterial/i.test(device.type)) {
      scores.care_plan.push(`${device.type}: daily site check and need review`);
      scores.tasks.push({ description: `${device.type} site check`, interval_minutes: 1440 });
    }
    if (/urinary/i.test(device.type)) {
      scores.care_plan.push('Catheter care twice daily and review need');
      scores.tasks.push({ description: 'Urinary catheter care', interval_minutes: 720 });
    }
    if (/endotracheal/i.test(device.type)) {
      scores.care_plan.push('Head end 30–45°, cuff pressure and mouth care 4-hourly');
      scores.tasks.push({ description: 'ETT cuff pressure and mouth care', interval_minutes: 240 });
    }
    if (/mask/i.test(device.type)) {
      scores.care_plan.push('Protect nasal bridge and check mask skin 2-hourly');
      scores.tasks.push({ description: 'Mask skin check', interval_minutes: 120 });
    }
  }
  if (body.vulnerabilities.some((item) => /self.harm/i.test(item)))
    scores.care_plan.push('Remove sharps and ligature risks; arrange 1:1 observation once awake');
  return scores;
}
