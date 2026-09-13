import 'dotenv/config';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const testDbPath = process.env.DATABASE_URL_TEST ?? './sqlite.test.db';

export function setup() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  execSync('npx drizzle-kit push', {
    env: { ...process.env, DATABASE_URL: testDbPath },
    stdio: 'inherit',
  });
}

export function teardown() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
}
