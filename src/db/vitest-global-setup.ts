import 'dotenv/config'
import { execSync } from 'node:child_process'

export function setup() {
  execSync('npx drizzle-kit push', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST! },
    stdio: 'inherit',
  })
}
