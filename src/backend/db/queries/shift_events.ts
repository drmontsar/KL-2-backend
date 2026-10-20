import { db } from '../index';

export type ShiftEvent = {
  id: string;
  admission_id: string;
  body: string;
  logged_by: string;
  logged_at: Date;
};

export function listShiftEvents(admission_id: string): Promise<ShiftEvent[]> {
  return db<ShiftEvent[]>`
    SELECT * FROM clinical.shift_events
    WHERE admission_id = ${admission_id}
    ORDER BY logged_at
  `;
}

export async function createShiftEvent(data: {
  admission_id: string;
  body: string;
  logged_by: string;
}): Promise<ShiftEvent> {
  const [row] = await db<ShiftEvent[]>`
    INSERT INTO clinical.shift_events (admission_id, body, logged_by)
    VALUES (${data.admission_id}, ${data.body}, ${data.logged_by})
    RETURNING *
  `;
  return row;
}
