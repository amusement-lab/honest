import { db, isTest } from '../db/index.ts';
import { notes, userTable } from '../db/schema.ts';

/**
 * Empties every table so each test starts from a clean slate.
 *
 * The database is the throwaway file created by `global-setup.ts`. This throws
 * if called outside a test run, so a stray script cannot empty the dev database.
 */
export async function resetDatabase() {
  if (!isTest) throw new Error('resetDatabase() must only run inside tests');

  await db.delete(notes);
  await db.delete(userTable);
}
