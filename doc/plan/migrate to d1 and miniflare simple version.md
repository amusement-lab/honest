# Migration Plan (Simple Version): better-sqlite3 → Cloudflare D1 & Miniflare

## Goal
Get the project running on **Cloudflare Workers + D1 (Miniflare)** for local development (`wrangler dev`) and testing (`vitest`) with **minimal changes**—without refactoring controllers, services, or existing test files.

---

## Summary of Changes

| File | Action | Purpose |
| :--- | :--- | :--- |
| `package.json` | Modify | Swap Node SQLite/server packages for `wrangler` & `@cloudflare/workers-types`. |
| `wrangler.toml` | Create | Configure Cloudflare Worker entry point and local D1 database binding (`DB`). |
| `src/index.ts` | Modify | Export `app` directly for Cloudflare Workers instead of `@hono/node-server`. |
| `src/db/index.ts` | Modify | Switch from `better-sqlite3` to `drizzle-orm/d1` with `initDb()`. |
| `src/modules/app.module.ts` | Modify | Add a 4-line middleware to initialize `db` from `c.env.DB`. |
| `src/db/vitest-global-setup.ts` | Modify | Repurpose as Vitest `setupFiles` using Miniflare's in-memory D1 (`getPlatformProxy`). |
| `vitest.config.ts` | Modify | Switch `globalSetup` to `setupFiles` so `db` is initialized in the test worker. |
| `drizzle.config.ts` | Modify | Remove `dotenv/config` and local file `dbCredentials`. |
| `src/db/seed.ts` | Delete | Remove legacy `better-sqlite3` seed script. |

> **Zero changes needed** in `user.controller.ts`, `user.service.ts`, `user.service.test.ts`, `note.controller.ts`, `note.service.ts`, `note.service.test.ts`, or `common.controller.ts`.

---

## Step-by-Step Implementation

### Step 1: Update Dependencies & Scripts (`package.json`)

Remove Node-only packages and install Wrangler:

```bash
npm uninstall better-sqlite3 @types/better-sqlite3 @hono/node-server dotenv tsx
npm install -D wrangler @cloudflare/workers-types
```

Update `scripts` in `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "ncu": "ncu",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "wrangler d1 migrations apply honest-db --local"
  }
}
```

---

### Step 2: Create `wrangler.toml`

Create `wrangler.toml` in the project root. Wrangler uses Miniflare under the hood to emulate Cloudflare Workers and D1 locally:

```toml
name = "honest"
main = "src/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "honest-db"
database_id = "local-dev-db"
migrations_dir = "drizzle"
```

---

### Step 3: Update Entry Point (`src/index.ts`)

Replace `@hono/node-server` with the standard Cloudflare Worker export:

```ts
// src/index.ts
import app from './modules/app.module.ts'

export default app
```

---

### Step 4: Switch Database Adapter to D1 (`src/db/index.ts` & `src/modules/app.module.ts`)

#### 4.1 `src/db/index.ts`
Export `db` and an `initDb(d1)` initializer so existing services (`UserService`, `NoteService`) can continue importing `{ db }` without any code changes:

```ts
// src/db/index.ts
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import type { D1Database } from '@cloudflare/workers-types'
import * as schema from './schema.ts'

export let db: DrizzleD1Database<typeof schema>

export function initDb(d1: D1Database) {
  db = drizzle(d1, { schema })
  return db
}
```

#### 4.2 `src/modules/app.module.ts`
Add a small middleware before the routes to bind `c.env.DB`:

```ts
import type { D1Database } from '@cloudflare/workers-types'
import { initDb } from '../db/index.ts'

// Add before app.route(...)
app.use('*', async (c, next) => {
  const env = c.env as { DB?: D1Database }
  if (env?.DB) {
    initDb(env.DB)
  }
  await next()
})
```

#### 4.3 `drizzle.config.ts` & `src/db/seed.ts`
Simplify `drizzle.config.ts` (since `dotenv` and local `sqlite.db` are no longer used) and delete `src/db/seed.ts`:

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
})
```

---

### Step 5: Configure Vitest to Use Miniflare D1 (`vitest.config.ts` & `src/db/vitest-global-setup.ts`)

#### 5.1 `src/db/vitest-global-setup.ts`
Replace the `drizzle-kit push` shell script with Wrangler's `getPlatformProxy({ persist: false })`, which boots an isolated in-memory Miniflare D1 instance and runs your `./drizzle` migrations automatically:

```ts
// src/db/vitest-global-setup.ts
import { getPlatformProxy } from 'wrangler'
import { migrate } from 'drizzle-orm/d1/migrator'
import type { D1Database } from '@cloudflare/workers-types'
import { afterAll } from 'vitest'
import { initDb } from './index.ts'

const proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false })
const db = initDb(proxy.env.DB)

await migrate(db, { migrationsFolder: './drizzle' })

afterAll(async () => {
  await proxy.dispose()
})
```

#### 5.2 `vitest.config.ts`
Use `setupFiles` (runs in the same process as your tests so `db` is populated) and disable `fileParallelism`:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false,
    setupFiles: ['./src/db/vitest-global-setup.ts'],
  },
})
```

---

## How to Run & Verify

1. **Apply existing Drizzle migration to local Miniflare D1:**
   ```bash
   npm run db:migrate
   ```
2. **Run all tests on in-memory Miniflare D1:**
   ```bash
   npm test
   ```
3. **Start the local Cloudflare Worker dev server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:8787/doc-ui` to test your endpoints with Swagger UI.

