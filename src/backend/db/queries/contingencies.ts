import { db } from '../index';

export type Contingency = {
  id: string;
  admission_id: string;
  body: string;
  created_by: string;
  created_at: Date;
};

export function listContingencies(admission_id: string): Promise<Contingency[]> {
  return db<Contingency[]>`
    SELECT * FROM clinical.contingencies
    WHERE admission_id = ${admission_id}
    ORDER BY created_at
  `;
}

export async function createContingency(data: {
  admission_id: string;
  body: string;
  created_by: string;
}): Promise<Contingency> {
  const [row] = await db<Contingency[]>`
    INSERT INTO clinical.contingencies (admission_id, body, created_by)
    VALUES (${data.admission_id}, ${data.body}, ${data.created_by})
    RETURNING *
  `;
  return row;
}

export async function deleteContingency(id: string): Promise<boolean> {
  const result = await db`DELETE FROM clinical.contingencies WHERE id = ${id}`;
  return result.count > 0;
}
