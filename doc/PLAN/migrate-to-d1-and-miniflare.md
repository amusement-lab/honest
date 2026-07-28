# Migration Plan: PostgreSQL → Cloudflare D1 (with Miniflare)

## Overview

Migrate the database layer from PostgreSQL (`node-postgres`) to Cloudflare D1,
using Miniflare for local development and testing. The application server
moves from `@hono/node-server` to Cloudflare Workers (`wrangler dev` locally).

---

## Step 1 — Dependencies

| Action | Package | Reason |
|--------|---------|--------|
| Remove | `pg`, `@types/pg` | No longer needed (was PostgreSQL driver) |
| Add (devDep) | `wrangler` | CLI for Workers dev, deploy, and `getPlatformProxy` |
| Add (devDep) | `@cloudflare/workers-types` | D1Database types for TypeScript |

`drizzle-orm` and `drizzle-kit` stay — both have native D1/SQLite support.

```bash
pnpm remove pg @types/pg
pnpm add -D wrangler @cloudflare/workers-types
```

---

## Step 2 — Create `wrangler.toml`

```toml
name = "honest"
compatibility_date = "2025-07-25"
main = "src/worker.ts"

[[d1_databases]]
binding = "DB"
database_name = "honest-db"
database_id = "honest-db-local"
```

- `binding` is the name available as `env.DB` in Workers/Miniflare.
- `database_id` can be any string for local dev; a real D1 ID is needed for
  production.

---

## Step 3 — Convert `src/db/schema.ts`

### Before (PostgreSQL / pg-core)

```ts
import { pgTable, uuid, date, varchar, numeric } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  vendor: varchar('vendor').notNull(),
  name: varchar('name').notNull(),
  amount: numeric('amount').notNull(),
  unit: varchar('unit').notNull(),
  price: numeric('price').notNull(),
  category: varchar('category').notNull(),
  totalPrice: numeric('total_price').notNull(),
  status: varchar('status').notNull().default('pending'),
});

export const userTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
});
```

### After (SQLite / sqlite-core)

```ts
import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const notes = sqliteTable('notes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  date: text('date').notNull(),
  vendor: text('vendor').notNull(),
  name: text('name').notNull(),
  amount: real('amount').notNull(),
  unit: text('unit').notNull(),
  price: real('price').notNull(),
  category: text('category').notNull(),
  totalPrice: real('total_price').notNull(),
  status: text('status').notNull().default('pending'),
});

export const userTable = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text('username', { length: 100 }).notNull(),
  email: text('email', { length: 255 }).notNull().unique(),
  password: text('password', { length: 255 }).notNull(),
});
```

### Type mapping summary

| PostgreSQL | SQLite/D1 | Notes |
|------------|-----------|-------|
| `uuid` | `text` + `$defaultFn(crypto.randomUUID)` | No native UUID in SQLite |
| `varchar(n)` | `text` | SQLite ignores length constraint |
| `numeric` | `real` or `text` | `real` = float, `text` = string (precision) |
| `date` | `text` | Store as ISO string; no native date type |
| `defaultRandom()` | `$defaultFn(() => crypto.randomUUID())` | App-level UUID gen |

> **Decision**: Use `real` for currency columns (`amount`, `price`, `totalPrice`)
> if float precision is acceptable. Use `text` + manual coercion if exact decimal
> precision is required. The current code already coerces `numeric` → `Number`
> in `note.service.ts`, so `real` is probably fine.

---

## Step 4 — Refactor `src/db/index.ts`

The current module exports a sync global singleton:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
export const db = drizzle(process.env.DATABASE_URL!, { schema });
```

With D1 and Miniflare, the database binding is async. Choose one of the two
options below.

---

### Option A — Async getter (minimal service changes)

**How it works**: `src/db/index.ts` exports an async `getDb()` function. On the
first call, it lazily initializes via `getPlatformProxy()` (Miniflare). Cached
for subsequent calls. Services add `await getDb()` before queries.

**`src/db/index.ts`:**
```ts
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import * as schema from './schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _dbPromise: Promise<Db> | null = null;

export function initDb(d1Binding: D1Database): Db {
  const db = drizzle(d1Binding, { schema });
  return db;
}

export async function getDb(): Promise<Db> {
  if (!_dbPromise) {
    const { getPlatformProxy } = await import('wrangler');
    _dbPromise = getPlatformProxy<{ DB: D1Database }>().then(
      ({ env }) => drizzle(env.DB, { schema })
    );
  }
  return _dbPromise;
}
```

**Service changes** (minimal — one line added per method):

Before:
```ts
import { db } from '../../db/index.ts'

class UserService {
  static async getAllUser() {
    return db.select(...).from(userTable)
  }
}
```

After:
```ts
import { getDb } from '../../db/index.ts'

class UserService {
  static async getAllUser() {
    const db = await getDb()
    return db.select(...).from(userTable)
  }
}
```

**Production Worker usage** (`src/worker.ts`):

```ts
import { initDb } from './db/index.ts'
import app from './modules/app.module.ts'

export default {
  async fetch(request: Request, env: Env) {
    initDb(env.DB) // seeds the singleton for this request
    return app.fetch(request, env)
  },
}
```

**Pros:**
- Minimal diff to existing service code (add one `await` line per method)
- No Hono context threading required
- Works for tests, local dev, and production

**Cons:**
- Global mutable singleton (minor, but not idiomatic Workers)
- `initDb()` must be called at the start of every Worker request
- If two requests arrive concurrently in the same isolate, they share the same
  `db` instance (fine for read-heavy, may need care for transactions)

---

### Option B — Hono middleware (idiomatic Workers)

**How it works**: A Hono middleware creates a `db` instance from the request's
`env.DB` binding and stores it in Hono context (`c.get('db')`). Every handler
and service receives the context-carried `db`.

**`src/db/index.ts`:**
```ts
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(d1Binding: D1Database): Db {
  return drizzle(d1Binding, { schema });
}
```

**Add middleware** (`src/modules/app.module.ts`):

```ts
import { createFactory } from 'hono/factory'
import type { D1Database } from '@cloudflare/workers-types'
import { createDb } from '../db/index.ts'
import type { Db } from '../db/index.ts'

type Env = {
  Bindings: {
    DB: D1Database
  }
  Variables: {
    db: Db
  }
}

const app = new OpenAPIHono<Env>({ defaultHook: ... })

app.use(async (c, next) => {
  c.set('db', createDb(c.env.DB))
  await next()
})
```

**Add type helpers** — a convenience function to get `db` from context:

```ts
// src/utils/db.util.ts
import type { Context } from 'hono'
import type { Db } from '../db/index.ts'

export function db(c: Context): Db {
  return c.get('db')
}
```

**Service changes** — each method receives context or `db`:

Before:
```ts
import { db } from '../../db/index.ts'

class UserService {
  static async getAllUser() {
    return db.select(...).from(userTable)
  }
}
```

After (variant — pass db directly):
```ts
import type { Db } from '../../db/index.ts'

class UserService {
  static async getAllUser(db: Db) {
    return db.select(...).from(userTable)
  }
}
```

**Controller changes** — controller extracts `db` from context and passes to service:

Before:
```ts
const getAll = app.openapi(getAllRoute, async (c) => {
  const users = await UserService.getAllUser()
  return c.json(users)
})
```

After:
```ts
const getAll = app.openapi(getAllRoute, async (c) => {
  const users = await UserService.getAllUser(c.var.db)
  return c.json(users)
})
```

**Test setup** (`vitest-global-setup.ts`):

```ts
import { getPlatformProxy } from 'wrangler'
import { createDb } from '../src/db/index.ts'
import { execSync } from 'node:child_process'

export async function setup({ provide }) {
  // Push schema to local D1
  execSync('pnpm exec drizzle-kit push', { stdio: 'inherit' })

  const { env } = await getPlatformProxy<{ DB: D1Database }>()
  const db = createDb(env.DB)
  provide('db', db)
}
```

**Test changes** — import `db` from vitest context via `inject`:

```ts
import { describe, it, expect, afterAll, inject } from 'vitest'

describe('UserService', () => {
  const db = inject('db') as Db

  afterAll(async () => {
    await db.delete(userTable)
  })

  it('should create a user', async () => {
    const result = await UserService.createUser(db, { username: '...', email: '...', password: '...' })
    expect(result).toBeDefined()
  })
})
```

**Pros:**
- Idiomatic Cloudflare Workers pattern — `db` lives in request context
- No global mutable state
- Each request gets its own `db` instance (safer for concurrent requests)
- No `initDb()` call needed — the middleware handles it automatically
- Easy to mock `db` in tests by injecting a custom instance

**Cons:**
- Larger diff — every controller and service signature changes
- Must thread `db` (or context) through controller → service call chain
- More boilerplate in handler code
- Tests need to use `inject()` or manually create `db` via Miniflare

---

### Comparison

| Aspect | Option A | Option B |
|--------|----------|----------|
| Code diff size | Small (~1 line per service method) | Large (every controller + service affected) |
| Idiomatic Workers | No (global singleton) | Yes (request-scoped context) |
| Test ergonomics | Services unchanged, just add `await getDb()` | Services need `db` param, tests use `inject()` |
| Concurrent request safety | Shared singleton (fine for most cases) | Isolated per-request |
| Future migration to RPC / other patterns | May need larger refactor later | Already aligned with Workers patterns |

---

## Step 5 — Update Services

Based on the chosen option from Step 4:

- **Option A**: Add `const db = await getDb()` at the top of each service method.
- **Option B**: Add `db: Db` parameter to each service method, removed from
  global imports.

The `returning()` calls in `createUser`, `updateUser`, `deleteUser` keep
working — Drizzle emulates `RETURNING` for SQLite via `last_insert_rowid()`
plus a follow-up `SELECT`.

The `numberCoerce()` helper in `note.service.ts` for `numeric` columns may need
adjustment depending on whether `real` or `text` was chosen in Step 3.

---

## Step 6 — Update `vitest-global-setup.ts`

### Before

```ts
import 'dotenv/config'
import { execSync } from 'node:child_process'

export function setup() {
  execSync('pnpm exec drizzle-kit push', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST! },
    stdio: 'inherit',
  })
}
```

### After

```ts
import 'dotenv/config'
import { execSync } from 'node:child_process'

export function setup() {
  execSync('pnpm exec drizzle-kit push', { stdio: 'inherit' })
}
```

The `drizzle.config.ts` now uses `sqlite` dialect pointing to a local SQLite
file (see Step 8). `drizzle-kit push` writes directly to that file. Miniflare's
D1 emulation reads from `.wrangler/state/v3/d1/honest-db-local/db.sqlite`.

No need to set `DATABASE_URL` override — the config handles it.

> If SQLite file path differs between test and dev, use `VITEST` env var to
> switch `dbCredentials.url` in `drizzle.config.ts`.

---

## Step 7 — Update `vitest.config.ts`

### Before

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./src/db/vitest-global-setup.ts'],
    env: {
      VITEST: 'true',
    },
  },
})
```

### After

No major changes needed. The `globalSetup` remains async-compatible. The
`VITEST=true` env var still triggers the test database path.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./src/db/vitest-global-setup.ts'],
    env: {
      VITEST: 'true',
    },
  },
})
```

---

## Step 8 — Update Configs

### `drizzle.config.ts`

**Before:**
```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**After (local dev):**
```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || './local.db',
  },
});
```

**After (with D1 remote):**

If you need to push directly to a remote D1 instance:

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
});
```

### `.env`

**Before:**
```
DATABASE_URL=postgres://honest:honestGood@localhost:5432/honestDB
DATABASE_URL_TEST=postgres://honestTest:honestGoodTest@localhost:5433/honestDBTest
POSTGRES_USER=honest
POSTGRES_PASSWORD=honestGood
POSTGRES_DB=honestDB
POSTGRES_USER_TEST=honestTest
POSTGRES_PASSWORD_TEST=honestGoodTest
POSTGRES_DB_TEST=honestDBTest
```

**After:**
```
DATABASE_URL=file:./local.db
DATABASE_URL_TEST=file:./test.db
# (Optional) for remote D1 operations:
# CLOUDFLARE_ACCOUNT_ID=...
# CLOUDFLARE_DATABASE_ID=...
# CLOUDFLARE_D1_TOKEN=...
```

Remove all `POSTGRES_*` vars — they are no longer needed.

### `.env.example`

Update similarly to reflect the new D1/SQLite configuration.

---

## Step 9 — Create Worker Entry Point

### Current entry (`src/index.ts`)

```ts
import { serve } from '@hono/node-server'
import app from './modules/app.module.ts'

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
```

### New Worker entry (`src/worker.ts`)

```ts
// src/worker.ts
import app from './modules/app.module.ts'

export default app
```

Hono is already compatible with the Workers `fetch` API — just export the app
directly. Wrangler will call `app.fetch(request, env, ctx)`.

### For local dev without wrangler (optional)

Keep `src/index.ts` but change it to use `getPlatformProxy()`:

```ts
import { getPlatformProxy } from 'wrangler'
import { serve } from '@hono/node-server'
import app from './modules/app.module.ts'

const { env } = await getPlatformProxy()

serve({
  fetch: (req) => app.fetch(req, env),
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
```

### For Option A only — initDb call

If using Option A, the Worker entry needs to call `initDb` before the app
handles the request:

```ts
// src/worker.ts
import { initDb } from './db/index.ts'
import app from './modules/app.module.ts'

export default {
  async fetch(request: Request, env: Env) {
    initDb(env.DB)
    return app.fetch(request, env)
  },
}
```

### Run commands

| Command | What it does |
|---------|-------------|
| `pnpm wrangler dev` | Start local dev server with Miniflare |
| `pnpm wrangler deploy` | Deploy to Cloudflare Workers |
| `pnpm wrangler d1 execute honest-db --local --file=<sql>` | Run SQL against local D1 |
| `pnpm wrangler d1 execute honest-db --file=<sql>` | Run SQL against remote D1 |

---

## Step 10 — Generate Fresh SQLite Migrations

Delete the existing PostgreSQL migration and generate new SQLite-format ones:

```bash
rm -rf drizzle/
pnpm exec drizzle-kit generate
```

This creates a new `drizzle/` directory with SQLite-flavored DDL (using
`integer`, `text`, `real`, etc.) matching the new `sqliteTable` definitions.

To apply migrations locally:

```bash
pnpm wrangler d1 execute honest-db --local --file=./drizzle/0000_whatever.sql
```

Or use `drizzle-kit push` (already wired in the vitest global setup).

---

## Step 11 — Cleanup

| Action | Detail |
|--------|--------|
| Remove `docker-compose.yml` | If one exists for PostgreSQL containers |
| Update `tsconfig.json` | Remove `"types": ["node"]` if present (not needed for Workers); keep if you still have Node-based tooling |
| Update `.gitignore` | Add `.wrangler/`, `*.sqlite`, `local.db`, `test.db` |
| Update `package.json` scripts | Replace `"dev": "tsx watch src/index.ts"` → `"dev": "wrangler dev"` |
| Update `package.json` scripts | Add `"deploy": "wrangler deploy"` |

---

## Step 12 — Testing & Verification

1. **Schema push**: `pnpm exec drizzle-kit push` succeeds against SQLite
2. **Local server**: `pnpm wrangler dev` starts without error, endpoints respond
3. **Tests**: `pnpm test` passes — all CRUD operations work against Miniflare's
   local D1
4. **TypeScript**: `pnpm exec tsc --noEmit` passes with no type errors
5. **Migrations**: `pnpm exec drizzle-kit generate` produces valid SQLite SQL

---

## Summary of All File Changes

| File | Change |
|------|--------|
| `package.json` | Dependencies updated, scripts changed |
| `wrangler.toml` | **New file** — D1 binding + Workers config |
| `src/db/schema.ts` | pg-core → sqlite-core, column types converted |
| `src/db/index.ts` | node-postgres → D1 driver, async init pattern |
| `src/db/vitest-global-setup.ts` | Simplified (no Postgres override) |
| `src/worker.ts` | **New file** — Workers entry point |
| `src/index.ts` | Keep (optional Node dev server) or replace |
| `src/modules/*/service.ts` | Adapted per Option A or B |
| `src/modules/*/controller.ts` | May change per Option B |
| `src/modules/*/test.ts` | Adapted per Option A or B |
| `drizzle/` | Regenerated with SQLite SQL |
| `drizzle.config.ts` | dialect → `sqlite` |
| `.env` / `.env.example` | Remove Postgres vars, add SQLite paths |
| `vitest.config.ts` | Minor adjustments if needed |
| `tsconfig.json` | Remove `"types": ["node"]` if desired |
| `.gitignore` | Add `.wrangler/`, `*.sqlite` |
| `docker-compose.yml` | Remove if present |
