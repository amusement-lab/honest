import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from './schema.ts';

const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

export const db = drizzle(isTest ? process.env.DATABASE_URL_TEST! : process.env.DATABASE_URL!, { schema });
