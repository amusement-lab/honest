import 'dotenv/config';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.ts';

export const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

const devDbPath = process.env.DATABASE_URL || './db/data/sqlite.db';

// Tests get their own throwaway file; the dev server and seed script use the
// regular one. This guard refuses to open the dev file in test mode, and
// `src/utils/test-setup.util.ts` refuses to delete it.
const dbPath = isTest
  ? process.env.DATABASE_URL_TEST || './db/data/sqlite.test.db'
  : devDbPath;

if (isTest && path.resolve(dbPath) === path.resolve(devDbPath)) {
  throw new Error(`Refusing to open the development database in test mode: ${dbPath}`);
}

export const client = new Database(dbPath);

export const db = drizzle(client, { schema });
