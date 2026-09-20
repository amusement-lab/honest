import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.ts';

const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
const dbPath = isTest
  ? (process.env.DATABASE_URL_TEST ?? './sqlite.test.db')
  : (process.env.DATABASE_URL ?? './sqlite.db');

export const client = new Database(dbPath);

// Enable Write-Ahead Logging for high concurrency
if (!isTest) {
  client.pragma('journal_mode = WAL');
}

export const db = drizzle(client, { schema });
