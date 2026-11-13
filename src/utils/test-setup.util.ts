import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const DEFAULT_DEV_DB_PATH = './db/data/sqlite.db';
const testDbPath = process.env.DATABASE_URL_TEST || './db/data/sqlite.test.db';

/** Set only after setup() finishes, so a failed setup never deletes files. */
let setupSucceeded = false;

/** Refuses to run destructive test setup against the development database. */
function assertNotDevDatabase() {
  const devDbPath = process.env.DATABASE_URL || DEFAULT_DEV_DB_PATH;
  if (path.resolve(testDbPath) === path.resolve(devDbPath)) {
    throw new Error(
      `Refusing to run destructive test setup against the development database: ${testDbPath}`,
    );
  }
}

/**
 * Removes the test database and any journal file left by an interrupted run.
 * The guard lives here so every caller is protected, including teardown.
 */
function removeDatabaseFiles() {
  assertNotDevDatabase();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    fs.rmSync(`${testDbPath}${suffix}`, { force: true });
  }
}

/**
 * Runs once before the test run: recreates the test database by applying the
 * migrations in `drizzle/`, so the same SQL that production runs is exercised.
 */
export function setup() {
  setupSucceeded = false;

  // Deletes the old file before any test worker starts; the guard lives inside.
  removeDatabaseFiles();

  // `db/data/` is gitignored, so it does not exist on a fresh clone.
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true });

  // Close the handle so teardown can delete the file on Windows.
  const client = new Database(testDbPath);
  try {
    migrate(drizzle(client), { migrationsFolder: './drizzle' });
  } finally {
    client.close();
  }

  setupSucceeded = true;
}

/** Runs once after the test run: deletes the throwaway database. */
export function teardown() {
  // Vitest still calls teardown when setup threw (for example, when the guard
  // above refused to run). Never delete anything in that case.
  if (setupSucceeded) removeDatabaseFiles();
}
