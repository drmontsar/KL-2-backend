// Fixture-only login addresses; remove the clinical title and ignore trailing RN.
export function demoEmail(name: string): string {
  const words = name.replace(/^Dr\.?\s+/i, '').toLowerCase().match(/[a-z]+/g);
  if (!words || words.length < 2) throw new Error(`Demo user needs a first and second name: ${name}`);
  return `${words[0]}+${words[1]}@klinik.com`;
}
