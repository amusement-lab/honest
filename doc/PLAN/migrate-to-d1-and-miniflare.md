# Migration Plan: PostgreSQL → Cloudflare D1 (with Miniflare)

## Overview

Migrate the database layer from PostgreSQL (`node-postgres`) to Cloudflare D1, using Miniflare (via Wrangler) for local development and testing. The application server moves from `@hono/node-server` to Cloudflare Workers edge runtime (`wrangler dev` locally).

---

## Step 1 — Dependencies

| Action | Package | Reason |
|--------|---------|--------|
| Remove | `pg`, `@types/pg` | No longer needed (PostgreSQL driver) |
| Remove | `@hono/node-server` | Replaced by native Cloudflare Workers runtime |
| Add (devDep) | `wrangler` | CLI for Workers dev, deployment, and Miniflare proxy (`getPlatformProxy`) |
| Add (devDep) | `@cloudflare/workers-types` | D1Database and Worker runtime types for TypeScript |

`drizzle-orm` and `drizzle-kit` stay — both have native Cloudflare D1 / SQLite support.

```bash
pnpm remove pg @types/pg @hono/node-server
pnpm add -D wrangler @cloudflare/workers-types
```

---

## Step 2 — Create `wrangler.toml`

Create `wrangler.toml` in the repository root:

```toml
name = "honest"
compatibility_date = "2025-07-25"
compatibility_flags = ["nodejs_compat"]
main = "src/worker.ts"

[[d1_databases]]
binding = "DB"
database_name = "honest-db"
database_id = "honest-db-local"
migrations_dir = "drizzle"
```

- `compatibility_flags = ["nodejs_compat"]` enables Node.js compatibility APIs in Workers runtime (required for `@noble/hashes` and crypto utilities).
- `binding` is exposed on the Hono context as `c.env.DB`.
- `database_id` can be any placeholder for local development; a real D1 UUID is used for production.
- `migrations_dir` specifies the folder where Drizzle-generated SQL migrations reside.

---

## Step 3 — Convert `src/db/schema.ts`

### Before (PostgreSQL / `drizzle-orm/pg-core`)

```ts
import { pgTable, uuid, date, varchar, integer } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  vendor: varchar('vendor').notNull(),
  name: varchar('name').notNull(),
  amount: integer('amount').notNull(),
  unit: varchar('unit').notNull(),
  price: integer('price').notNull(),
  category: varchar('category').notNull(),
  totalPrice: integer('total_price').notNull(),
  status: varchar('status').notNull().default('pending'),
});

export const userTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
});
```

### After (SQLite / `drizzle-orm/sqlite-core`)

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const notes = sqliteTable('notes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  date: text('date').notNull(),
  vendor: text('vendor').notNull(),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  unit: text('unit').notNull(),
  price: integer('price').notNull(),
  category: text('category').notNull(),
  totalPrice: integer('total_price').notNull(),
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

### Type Mapping Summary

| PostgreSQL | SQLite/D1 | Notes |
|------------|-----------|-------|
| `uuid` + `defaultRandom()` | `text` + `$defaultFn(() => crypto.randomUUID())` | Generates standard UUID v4 string compatible with `z.uuid()` |
| `varchar(n)` | `text` | SQLite treats text columns uniformly without fixed length |
| `integer` | `integer` | Exact integer representation |
| `date` | `text` | Stored as ISO date string (`YYYY-MM-DD`), matching `z.iso.date()` |

> **Note on `RETURNING`**: Cloudflare D1 uses SQLite 3.35+, which natively supports `RETURNING` clauses. Drizzle ORM's D1 driver executes `.returning()` statements directly.

---

## Step 4 — Refactor Database & Context Architecture

In Cloudflare Workers, environment bindings (like `env.DB`) are request-scoped. Global singletons that import `wrangler` at runtime will crash in production Workers.

The idiomatic pattern is **Request Context Injection** via Hono middleware, passing the typed `db` instance to services.

### 4.1 Define App Environment (`src/types/env.type.ts`)

```ts
import type { D1Database } from '@cloudflare/workers-types'
import type { Db } from '../db/index.ts'

export type AppEnv = {
  Bindings: {
    DB: D1Database
  }
  Variables: {
    db: Db
  }
}
```

### 4.2 Database Factory (`src/db/index.ts`)

```ts
import { drizzle } from 'drizzle-orm/d1'
import type { D1Database } from '@cloudflare/workers-types'
import * as schema from './schema.ts'

export type Db = ReturnType<typeof drizzle<typeof schema>>

export function createDb(d1: D1Database): Db {
  return drizzle(d1, { schema })
}
```

### 4.3 Attach Middleware in Composition Root (`src/modules/app.module.ts`)

```ts
import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { createDb } from '../db/index.ts'
import type { AppEnv } from '../types/env.type.ts'

import common from './common/common.controller.ts'
import note from './note/note.controller.ts'
import user from './user/user.controller.ts'

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        { message: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ') },
        400
      )
    }
  },
})

// Initialize DB binding for each request
app.use(async (c, next) => {
  if (c.env?.DB) {
    c.set('db', createDb(c.env.DB))
  }
  await next()
})

app.doc('/doc', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Honest API',
  },
})
app.get('/doc-ui', swaggerUI({ url: '/doc' }))

app.route('/user', user)
app.route('/note', note)
app.route('/', common)

export default app
```

---

## Step 5 — Update Controllers and Services

### 5.1 Sub-Routers / Controllers

Sub-routers must be typed with `OpenAPIHono<AppEnv>` so `c.var.db` is strictly typed.

Example (`src/modules/user/user.controller.ts`):

```ts
import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../../types/env.type.ts'
import { UserService } from './user.service.ts'
import { UserSchema, UsersSchema, UserCreateSchema, UserUpdateSchema, type User } from './user.entity.ts'
import { CreateRouteUtil, IdParamSchema } from '../../utils/route.util.ts'

const app = new OpenAPIHono<AppEnv>()
const userRoute = new CreateRouteUtil(['User'])

app.openapi(
  userRoute.createRouteUtil({
    method: 'get',
    path: '/',
    responseSchema: UsersSchema,
  }),
  async (c) => {
    const users = await UserService.getAllUsers(c.var.db)
    return c.json(users)
  }
)

app.openapi(
  userRoute.createRouteUtil({
    method: 'post',
    path: '/',
    requestSchema: UserCreateSchema,
    responseSchema: UserSchema,
    status: 201,
  }),
  async (c) => {
    const body = c.req.valid('json')
    const user: User = await UserService.createUser(c.var.db, body)
    return c.json(user, 201)
  }
)

app.openapi(
  userRoute.createRouteUtil({
    method: 'get',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const user: User = await UserService.getUserById(c.var.db, id)
    return c.json(user)
  }
)

app.openapi(
  userRoute.createRouteUtil({
    method: 'put',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    requestSchema: UserUpdateSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const user: User = await UserService.updateUser(c.var.db, id, body)
    return c.json(user)
  }
)

app.openapi(
  userRoute.createRouteUtil({
    method: 'delete',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const user: User = await UserService.deleteUser(c.var.db, id)
    return c.json(user)
  }
)

export default app
```

### 5.2 Services

Services receive `db: Db` as their first parameter, removing all global database imports and making unit/integration testing straightforward.

Example (`src/modules/user/user.service.ts`):

```ts
import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/index.ts'
import { userTable } from '../../db/schema.ts'
import { hashPassword } from '../../utils/hash.util.ts'
import type { UserCreate, UserUpdate } from './user.entity.ts'

class UserService {
  static async getAllUsers(db: Db) {
    return db.select({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    }).from(userTable)
  }

  static async getUserById(db: Db, id: string) {
    const result = await db.select({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    }).from(userTable).where(eq(userTable.id, id)).limit(1)

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `User with id ${id} is not found` }
    )

    return result[0]
  }

  static async createUser(db: Db, user: UserCreate) {
    const existing = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, user.email)).limit(1)
    if (existing.length > 0) throw new HTTPException(
      400,
      { message: `User with email ${user.email} already exists` }
    )

    const hashedPassword = await hashPassword(user.password)

    const result = await db.insert(userTable).values({
      username: user.username,
      email: user.email,
      password: hashedPassword,
    }).returning({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    })

    return result[0]
  }

  static async updateUser(db: Db, id: string, updatedUser: UserUpdate) {
    const existing = await db.select({ id: userTable.id, email: userTable.email }).from(userTable).where(eq(userTable.id, id)).limit(1)
    if (existing.length === 0) throw new HTTPException(
      404,
      { message: `User with id ${id} is not found` }
    )

    if (updatedUser.email && updatedUser.email !== existing[0].email) {
      const duplicate = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, updatedUser.email)).limit(1)
      if (duplicate.length > 0) throw new HTTPException(
        400,
        { message: `User with email ${updatedUser.email} already exists` }
      )
    }

    const values: Partial<typeof userTable.$inferInsert> = {}
    if (updatedUser.username !== undefined) values.username = updatedUser.username
    if (updatedUser.email !== undefined) values.email = updatedUser.email
    if (updatedUser.password !== undefined) values.password = await hashPassword(updatedUser.password)

    const result = await db.update(userTable).set(values).where(eq(userTable.id, id)).returning({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    })

    return result[0]
  }

  static async deleteUser(db: Db, id: string) {
    const result = await db.delete(userTable).where(eq(userTable.id, id)).returning({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    })

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `User with id ${id} is not found` }
    )

    return result[0]
  }
}

export { UserService }
```

Similarly update `src/modules/note/note.controller.ts` and `src/modules/note/note.service.ts`.

---

## Step 6 — Test Setup with Miniflare & Vitest

### 6.1 Test Helper & Global Setup (`src/db/vitest-global-setup.ts`)

In Miniflare v3, D1 database instances are managed inside dynamic storage paths. To avoid "table not found" errors, apply generated migrations directly to the Miniflare D1 proxy binding during Vitest global setup:

```ts
import { getPlatformProxy } from 'wrangler'
import type { D1Database } from '@cloudflare/workers-types'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export async function setup() {
  const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>()

  // Read all generated SQLite SQL migration files in order
  const migrationFiles = readdirSync('./drizzle')
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of migrationFiles) {
    const sql = readFileSync(join('./drizzle', file), 'utf-8')
    // Execute migration SQL on local Miniflare D1
    await env.DB.exec(sql)
  }

  await dispose()
}
```

### 6.2 Test Database Utility (`src/test/test-db.ts`)

Provide a helper for test suites to obtain a fresh Miniflare `db` instance:

```ts
import { getPlatformProxy } from 'wrangler'
import type { D1Database } from '@cloudflare/workers-types'
import { createDb, type Db } from '../db/index.ts'

let _proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>> | null = null

export async function getTestDb(): Promise<{ db: Db; dispose: () => Promise<void> }> {
  if (!_proxy) {
    _proxy = await getPlatformProxy<{ DB: D1Database }>()
  }
  return {
    db: createDb(_proxy.env.DB),
    dispose: async () => {
      if (_proxy) {
        await _proxy.dispose()
        _proxy = null
      }
    }
  }
}
```

### 6.3 Update Service Tests (`src/modules/*/*.service.test.ts`)

Example (`src/modules/user/user.service.test.ts`):

```ts
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { UserService } from './user.service.ts'
import { userTable } from '../../db/schema.ts'
import { getTestDb } from '../../test/test-db.ts'
import type { Db } from '../../db/index.ts'

describe('UserService', () => {
  let db: Db
  let createdId: string

  beforeAll(async () => {
    const testDb = await getTestDb()
    db = testDb.db
  })

  afterAll(async () => {
    await db.delete(userTable)
  })

  it('should create a user', async () => {
    const user = await UserService.createUser(db, {
      username: 'johndoe',
      email: 'john@example.com',
      password: 'secret123',
    })

    expect(user).toHaveProperty('id')
    expect(user.username).toBe('johndoe')
    expect(user.email).toBe('john@example.com')
    expect(user).not.toHaveProperty('password')

    createdId = user.id
  })

  it('should throw 400 when creating user with duplicate email', async () => {
    await expect(UserService.createUser(db, {
      username: 'janedoe',
      email: 'john@example.com',
      password: 'secret456',
    })).rejects.toBeInstanceOf(HTTPException)
  })

  it('should get all users', async () => {
    const allUsers = await UserService.getAllUsers(db)
    expect(allUsers.length).toBeGreaterThan(0)
    expect(allUsers[0]).toHaveProperty('id')
    expect(allUsers[0]).not.toHaveProperty('password')
  })

  it('should get user by id', async () => {
    const user = await UserService.getUserById(db, createdId)
    expect(user.id).toBe(createdId)
    expect(user.username).toBe('johndoe')
    expect(user).not.toHaveProperty('password')
  })

  it('should throw 404 when user not found', async () => {
    await expect(UserService.getUserById(db, '550e8400-e29b-41d4-a716-446655440000')).rejects.toBeInstanceOf(HTTPException)
  })

  it('should update a user', async () => {
    const updated = await UserService.updateUser(db, createdId, {
      username: 'johndoe_updated',
    })

    expect(updated.username).toBe('johndoe_updated')
    expect(updated.email).toBe('john@example.com')
  })

  it('should delete a user', async () => {
    const { id: secondUserId } = await UserService.createUser(db, {
      username: 'deleteme',
      email: 'delete@example.com',
      password: 'secret000',
    })

    const deleted = await UserService.deleteUser(db, secondUserId)
    expect(deleted.id).toBe(secondUserId)

    const remaining = await db.select().from(userTable).where(eq(userTable.id, secondUserId))
    expect(remaining.length).toBe(0)
  })
})
```

---

## Step 7 — Update `tsconfig.json` & `vitest.config.ts`

### 7.1 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": [
      "@cloudflare/workers-types/2023-07-01",
      "vitest/globals"
    ],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "noEmit": true,
    "allowImportingTsExtensions": true
  }
}
```

### 7.2 `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./src/db/vitest-global-setup.ts'],
    testTimeout: 10000,
  },
})
```

---

## Step 8 — Update `drizzle.config.ts` & Environment Variables

### 8.1 `drizzle.config.ts`

Configure Drizzle Kit with `dialect: 'sqlite'` to output SQL migrations compatible with D1:

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
})
```

### 8.2 `.env` / `.env.example`

Remove PostgreSQL connection strings. Environment variables in Workers/Miniflare are defined in `wrangler.toml` (or `.dev.vars` for local secrets):

```bash
# .dev.vars (for local development secrets, gitignored)
# JWT_SECRET=...
```

---

## Step 9 — Create Worker Entry Point

### 9.1 `src/worker.ts`

Hono natively satisfies the Cloudflare Workers `fetch` handler:

```ts
import app from './modules/app.module.ts'

export default app
```

### 9.2 Remove or Replace `src/index.ts`

Remove `src/index.ts` (the Node-server entry) and update `package.json` scripts:

```json
"scripts": {
  "dev": "wrangler dev",
  "deploy": "wrangler deploy",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "db:migrate:local": "wrangler d1 migrations apply honest-db --local",
  "db:migrate:remote": "wrangler d1 migrations apply honest-db --remote"
}
```

---

## Step 10 — Generate SQLite Migrations

1. Delete existing PostgreSQL migrations:
   ```bash
   rm -rf drizzle/
   ```
2. Generate fresh SQLite migrations with Drizzle Kit:
   ```bash
   pnpm run db:generate
   ```
3. Apply migration to local Miniflare D1:
   ```bash
   pnpm run db:migrate:local
   ```

---

## Step 11 — Cleanup

| Action | Detail |
|--------|--------|
| Remove `docker-compose.yml` | PostgreSQL container is no longer needed |
| Remove `src/index.ts` | Replaced by `src/worker.ts` |
| Update `.gitignore` | Add `.wrangler/`, `.dev.vars`, `*.sqlite` |

---

## Step 12 — Testing & Verification

1. **Migration generation**: `pnpm run db:generate` generates valid SQLite SQL files in `drizzle/`.
2. **Local migration**: `pnpm run db:migrate:local` executes cleanly on Miniflare D1.
3. **Local dev**: `pnpm dev` starts `wrangler dev` without errors, Swagger UI accessible at `http://localhost:8787/doc-ui`.
4. **Automated tests**: `pnpm test` runs all Vitest tests against the Miniflare D1 proxy successfully.
5. **Type checking**: `pnpm exec tsc --noEmit` passes with 0 errors.

---

## Summary of All File Changes

| File | Change |
|------|--------|
| `package.json` | Remove `pg`, `@types/pg`, `@hono/node-server`; add `wrangler`, `@cloudflare/workers-types`; update scripts |
| `wrangler.toml` | **New file** — D1 database binding, compatibility flags, migrations dir |
| `src/types/env.type.ts` | **New file** — `AppEnv` with typed `Bindings` and `Variables` |
| `src/db/schema.ts` | Convert to `drizzle-orm/sqlite-core`, `integer` types, `crypto.randomUUID()` default |
| `src/db/index.ts` | Convert to `createDb(d1: D1Database)` factory with `drizzle-orm/d1` |
| `src/modules/app.module.ts` | Use `OpenAPIHono<AppEnv>`, attach `db` context middleware |
| `src/modules/*/*.controller.ts` | Type with `OpenAPIHono<AppEnv>`, pass `c.var.db` to service methods |
| `src/modules/*/*.service.ts` | Accept `db: Db` parameter, remove global `db` imports |
| `src/modules/*/*.service.test.ts` | Initialize `db` via Miniflare proxy in `beforeAll` |
| `src/db/vitest-global-setup.ts` | Apply SQL migrations to Miniflare D1 proxy binding |
| `src/test/test-db.ts` | **New file** — Miniflare D1 test database helper |
| `src/worker.ts` | **New file** — Cloudflare Worker entry exporting `app` |
| `src/index.ts` | **Deleted** — Replaced by `src/worker.ts` |
| `drizzle.config.ts` | `dialect: 'sqlite'` |
| `tsconfig.json` | Update `types` for `@cloudflare/workers-types` and `vitest/globals` |
| `.gitignore` | Add `.wrangler/`, `.dev.vars`, `*.sqlite` |
| `docker-compose.yml` | **Deleted** |
