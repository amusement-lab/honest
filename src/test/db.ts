import { db } from '../db/index.ts';
import { notes, userTable } from '../db/schema.ts';

/**
 * Empties every table. Call this in `beforeEach` so each test starts from a
 * clean slate without paying the cost of recreating the schema.
 */
export async function resetDatabase() {
  await db.delete(notes);
  await db.delete(userTable);
}
