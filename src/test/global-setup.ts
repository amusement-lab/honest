import 'dotenv/config';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const testDbPath = process.env.DATABASE_URL_TEST ?? './db/data/sqlite.test.db';

/**
 * Runs once before the whole test run: recreates the test database from the
 * Drizzle schema so every run starts from a known-empty state.
 */
export function setup() {
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true });

  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  execSync('npx drizzle-kit push', {
    env: { ...process.env, DATABASE_URL: testDbPath },
    stdio: 'inherit',
  });
}

/** Runs once after the whole test run: removes the throwaway database file. */
export function teardown() {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${testDbPath}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}
