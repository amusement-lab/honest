# Migration Plan: PostgreSQL → Cloudflare D1 (with Miniflare)

---

## Scope

Migrate the database layer from PostgreSQL (`node-postgres`) to Cloudflare D1, using Miniflare (via Wrangler) for local development and testing. The application server moves from `@hono/node-server` to the Cloudflare Workers edge runtime (`wrangler dev` locally).

---

## File Index

| File | Issues / Changes |
| --- | --- |
| `package.json` | #1, #8 |
| `wrangler.toml` | #2 |
| `drizzle.config.ts` | #3 |
| `tsconfig.json` | #4 |
| `src/db/schema.ts` | #5 |
| `src/db/index.ts` | #6 |
| `src/types/env.type.ts` | #7 |
| `src/db/seed.ts` | #8 |
| `src/db/seed.sql` | #8 |
| `src/modules/app.module.ts` | #9 |
| `src/modules/user/user.controller.ts` | #10 |
| `src/modules/user/user.service.ts` | #10 |
| `src/modules/note/note.controller.ts` | #11 |
| `src/modules/note/note.service.ts` | #11 |
| `src/modules/common/common.controller.ts` | #12 |
| `src/worker.ts` | #13 |
| `src/index.ts` | #13 |
| `vitest.config.ts` | #14 |
| `src/test/test-db.ts` | #14 |
| `src/modules/user/user.service.test.ts` | #15 |
| `src/modules/note/note.service.test.ts` | #15 |
| `docker-compose.yml` | #16 |
| `.gitignore` | #16 |
| `.env` / `.env.example` | #16 |

---

## Phase 1 — Configuration & Dependencies

### #1 — Update dependencies, npm scripts & hash utility import

**Files:** `package.json`, `src/utils/hash.util.ts`

**Context:** PostgreSQL drivers (`pg`, `@types/pg`), `@hono/node-server`, and `dotenv` are no longer needed on Cloudflare Workers. We add `wrangler` and `@cloudflare/workers-types` as development dependencies, and update package scripts to use Wrangler CLI for dev, deploy, and D1 migrations. In `src/utils/hash.util.ts`, modern module resolution requires importing `@noble/hashes/scrypt` without the `.js` extension.

**Changes:**

- [ ] **`package.json`** — Remove `pg`, `@types/pg`, `@hono/node-server`, `dotenv`.
- [ ] **`package.json`** — Add `wrangler` and `@cloudflare/workers-types` to `devDependencies`.
- [ ] **`package.json`** — Update `scripts` for worker development, automated non-interactive migrations (`--yes`), and type checking.
- [ ] **`src/utils/hash.util.ts`** — Ensure imports use `@noble/hashes/scrypt` and `@noble/hashes/utils` (without `.js`) to satisfy TypeScript compiler.

```json
// package.json
// Dependencies to remove:
//   "dependencies": {
//     "@hono/node-server": "^2.1.1",
//     "dotenv": "^17.4.2",
//     "pg": "^8.23.0"
//   },
//   "devDependencies": {
//     "@types/pg": "^8.23.1"
//   }

// After:
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "types:generate": "wrangler types",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply honest-db --local --yes",
    "db:migrate:remote": "wrangler d1 migrations apply honest-db --remote --yes"
  }
}
```

```bash
pnpm remove pg @types/pg @hono/node-server dotenv
pnpm add -D wrangler @cloudflare/workers-types
```

---

### #2 — Create Cloudflare Worker configuration (`wrangler.toml`)

**File:** `wrangler.toml` (New file)

**Context:** Cloudflare Workers requires a configuration file defining the entry point, compatibility date, nodejs compatibility flags, and D1 database bindings.

**Changes:**

- [ ] **`wrangler.toml`** — Create configuration in repository root with `DB` binding pointing to `honest-db`.

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

---

### #3 — Update Drizzle Kit dialect for SQLite

**File:** `drizzle.config.ts`

**Context:** Cloudflare D1 is built on SQLite. Drizzle Kit must generate SQL migrations using SQLite syntax instead of PostgreSQL syntax.

**Changes:**

- [ ] **`drizzle.config.ts`** — Change dialect from `postgresql` to `sqlite`.

```ts
// drizzle.config.ts
// Before:
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})

// After:
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
})
```

---

### #4 — Update TypeScript configuration & Worker types

**File:** `tsconfig.json`

**Context:** Dated entrypoints like `@cloudflare/workers-types/2023-07-01` are removed in `@cloudflare/workers-types` v5+. Using `wrangler types` generates an ambient `worker-configuration.d.ts` file that precisely reflects `wrangler.toml` bindings.

**Changes:**

- [ ] **`tsconfig.json`** — Configure `types` for `@cloudflare/workers-types` and `vitest/globals`.
- [ ] Run `pnpm run types:generate` (`wrangler types`) to generate `worker-configuration.d.ts`.

```json
// tsconfig.json
// Before:
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": [
      "node"
    ],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "noEmit": true,
    "allowImportingTsExtensions": true
  }
}

// After:
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": [
      "@cloudflare/workers-types",
      "vitest/globals"
    ],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": [
    "src/**/*",
    "worker-configuration.d.ts"
  ]
}
```

---

## Phase 2 — Database Schema & Architecture

### #5 — Migrate database schema to `drizzle-orm/sqlite-core`

**File:** `src/db/schema.ts`

**Context:** PostgreSQL types (`pgTable`, `uuid`, `varchar`, `date`) must be converted to SQLite types (`sqliteTable`, `text`, `integer`). UUIDs are generated via `$defaultFn(() => crypto.randomUUID())` using standard Web Crypto API. Dates are stored as ISO text strings (`YYYY-MM-DD`).

**Changes:**

- [ ] **`src/db/schema.ts`** — Replace `drizzle-orm/pg-core` with `drizzle-orm/sqlite-core`.
- [ ] **`src/db/schema.ts`** — Use `text` with `$defaultFn(() => crypto.randomUUID())` for primary keys.

```ts
// src/db/schema.ts
// Before:
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

// After:
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

---

### #6 — Convert database client to D1 factory

**File:** `src/db/index.ts`

**Context:** In Cloudflare Workers, database connections cannot be global singletons using environment variables at file import time. D1 bindings exist on the request context (`c.env.DB`). We provide a factory function `createDb(d1: D1Database)` and derive the `Db` type cleanly from its return value.

**Changes:**

- [ ] **`src/db/index.ts`** — Remove `dotenv/config` and `node-postgres` driver.
- [ ] **`src/db/index.ts`** — Implement `createDb` factory using `drizzle-orm/d1`.
- [ ] **`src/db/index.ts`** — Export `type Db = ReturnType<typeof createDb>`.

```ts
// src/db/index.ts
// Before:
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
export const db = drizzle(isTest ? process.env.DATABASE_URL_TEST! : process.env.DATABASE_URL!, { schema });

// After:
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import * as schema from './schema.ts';

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
```

---

### #7 — Define application environment types

**File:** `src/types/env.type.ts` (New file)

**Context:** Centralize Hono typed environment bindings and variables so controllers and middleware share exact typings for `c.env.DB` and `c.var.db`.

**Changes:**

- [ ] **`src/types/env.type.ts`** — Create `AppEnv` with `Bindings` and `Variables`.

```ts
// src/types/env.type.ts
import type { D1Database } from '@cloudflare/workers-types';
import type { Db } from '../db/index.ts';

export type AppEnv = {
  Bindings: {
    DB: D1Database;
  };
  Variables: {
    db: Db;
  };
};
```

---

### #8 — Replace PostgreSQL seed script with D1 seed workflow

**Files:** `src/db/seed.ts`, `src/db/seed.sql`

**Context:** `src/db/seed.ts` directly imports `drizzle-orm/node-postgres` and uses `DATABASE_URL`. Once `pg` is removed, this file fails compilation. D1 databases can be seeded natively using `wrangler d1 execute` with a SQL seed file, or via a Miniflare helper script.

**Changes:**

- [ ] **`src/db/seed.sql`** — Create a reproducible SQL seed script for D1.
- [ ] **`src/db/seed.ts`** — Delete the obsolete PostgreSQL script or convert to a local D1 runner.
- [ ] **`package.json`** — Add `"db:seed": "wrangler d1 execute honest-db --local --file=./src/db/seed.sql"` script.

```sql
-- src/db/seed.sql
INSERT INTO notes (id, date, vendor, name, amount, unit, price, category, total_price, status)
VALUES (
  '550e8400-e29b-41d4-a716-446655440001',
  '2024-01-01',
  'Test Vendor',
  'Test Note',
  10,
  'pcs',
  1000,
  'Test',
  10000,
  'pending'
);
```

---

## Phase 3 — Composition Root, Controllers & Services

### #9 — Update composition root and error handling

**File:** `src/modules/app.module.ts`

**Context:** The composition root must:
1. Initialize `OpenAPIHono<AppEnv>`.
2. Inject a typed `db` instance into `c.set('db', ...)` with an explicit guard if `c.env.DB` is missing.
3. Preserve structured JSON error logging and `HTTPException` handling in `app.onError`.
4. Handle D1 unique constraint failures (`UNIQUE constraint failed`) returning clean 400/409 errors.

**Changes:**

- [ ] **`src/modules/app.module.ts`** — Type app with `OpenAPIHono<AppEnv>`.
- [ ] **`src/modules/app.module.ts`** — Attach request middleware to create and set `c.set('db')`.
- [ ] **`src/modules/app.module.ts`** — Preserve and update `app.onError` with D1 SQLite constraint detection.

```ts
// src/modules/app.module.ts
import { HTTPException } from 'hono/http-exception';
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { createDb } from '../db/index.ts';
import type { AppEnv } from '../types/env.type.ts';

import common from './common/common.controller.ts';
import note from './note/note.controller.ts';
import user from './user/user.controller.ts';

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        { message: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ') },
        400
      );
    }
  },
});

// Middleware: initialize scoped DB binding for each incoming request
app.use(async (c, next) => {
  if (!c.env?.DB) {
    throw new Error('D1 database binding "DB" is not configured in request environment');
  }
  c.set('db', createDb(c.env.DB));
  await next();
});

app.doc('/doc', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Honest API',
  },
});
app.get('/doc-ui', swaggerUI({ url: '/doc' }));

app.route('/user', user);
app.route('/note', note);
app.route('/', common);

app.onError((err, c) => {
  console.error(JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    method: c.req.method,
    url: c.req.url,
  }));

  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status);
  }

  // D1 / SQLite unique constraint violation
  if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
    return c.json({ message: 'Resource already exists' }, 409);
  }

  return c.json({ message: 'Internal Server Error' }, 500);
});

export default app;
```

---

### #10 — Refactor User Module for context injection

**Files:** `src/modules/user/user.controller.ts`, `src/modules/user/user.service.ts`

**Context:** Remove global database imports from `UserService`. Pass `c.var.db` from the controller into every service method.

**Changes:**

- [ ] **`src/modules/user/user.controller.ts`** — Type router with `OpenAPIHono<AppEnv>` and forward `c.var.db`.
- [ ] **`src/modules/user/user.service.ts`** — Accept `db: Db` as the first argument in all static methods.
- [ ] **`src/modules/user/user.service.ts`** — Remove `import { db } from '../../db/index.ts'`.

```ts
// src/modules/user/user.controller.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../../types/env.type.ts';
import { UserService } from './user.service.ts';
import { UserSchema, UsersSchema, UserCreateSchema, UserUpdateSchema, type User } from './user.entity.ts';
import { CreateRouteUtil, IdParamSchema } from '../../utils/route.util.ts';

const app = new OpenAPIHono<AppEnv>();
const userRoute = new CreateRouteUtil(['User']);

app.openapi(
  userRoute.createRouteUtil({
    method: 'get',
    path: '/',
    responseSchema: UsersSchema,
  }),
  async (c) => {
    const users = await UserService.getAllUsers(c.var.db);
    return c.json(users);
  }
);

app.openapi(
  userRoute.createRouteUtil({
    method: 'post',
    path: '/',
    requestSchema: UserCreateSchema,
    responseSchema: UserSchema,
    status: 201,
  }),
  async (c) => {
    const body = c.req.valid('json');
    const user: User = await UserService.createUser(c.var.db, body);
    return c.json(user, 201);
  }
);

app.openapi(
  userRoute.createRouteUtil({
    method: 'get',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user: User = await UserService.getUserById(c.var.db, id);
    return c.json(user);
  }
);

app.openapi(
  userRoute.createRouteUtil({
    method: 'put',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    requestSchema: UserUpdateSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const user: User = await UserService.updateUser(c.var.db, id, body);
    return c.json(user);
  }
);

app.openapi(
  userRoute.createRouteUtil({
    method: 'delete',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user: User = await UserService.deleteUser(c.var.db, id);
    return c.json(user);
  }
);

export default app;
```

```ts
// src/modules/user/user.service.ts
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/index.ts';
import { userTable } from '../../db/schema.ts';
import { hashPassword } from '../../utils/hash.util.ts';
import type { UserCreate, UserUpdate } from './user.entity.ts';

class UserService {
  static async getAllUsers(db: Db) {
    return db.select({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    }).from(userTable);
  }

  static async getUserById(db: Db, id: string) {
    const result = await db.select({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    }).from(userTable).where(eq(userTable.id, id)).limit(1);

    if (result.length === 0) {
      throw new HTTPException(404, { message: `User with id ${id} is not found` });
    }

    return result[0];
  }

  static async createUser(db: Db, user: UserCreate) {
    const existing = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, user.email)).limit(1);
    if (existing.length > 0) {
      throw new HTTPException(400, { message: `User with email ${user.email} already exists` });
    }

    const hashedPassword = await hashPassword(user.password);

    const result = await db.insert(userTable).values({
      username: user.username,
      email: user.email,
      password: hashedPassword,
    }).returning({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    });

    return result[0];
  }

  static async updateUser(db: Db, id: string, updatedUser: UserUpdate) {
    const existing = await db.select({ id: userTable.id, email: userTable.email }).from(userTable).where(eq(userTable.id, id)).limit(1);
    if (existing.length === 0) {
      throw new HTTPException(404, { message: `User with id ${id} is not found` });
    }

    if (updatedUser.email && updatedUser.email !== existing[0].email) {
      const duplicate = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, updatedUser.email)).limit(1);
      if (duplicate.length > 0) {
        throw new HTTPException(400, { message: `User with email ${updatedUser.email} already exists` });
      }
    }

    const values: Partial<typeof userTable.$inferInsert> = {};
    if (updatedUser.username !== undefined) values.username = updatedUser.username;
    if (updatedUser.email !== undefined) values.email = updatedUser.email;
    if (updatedUser.password !== undefined) values.password = await hashPassword(updatedUser.password);

    // Guard empty update payload to prevent SQLite syntax error
    if (Object.keys(values).length === 0) {
      return await this.getUserById(db, id);
    }

    const result = await db.update(userTable).set(values).where(eq(userTable.id, id)).returning({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    });

    return result[0];
  }

  static async deleteUser(db: Db, id: string) {
    const result = await db.delete(userTable).where(eq(userTable.id, id)).returning({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    });

    if (result.length === 0) {
      throw new HTTPException(404, { message: `User with id ${id} is not found` });
    }

    return result[0];
  }
}

export { UserService };
```

---

### #11 — Refactor Note Module for context injection

**Files:** `src/modules/note/note.controller.ts`, `src/modules/note/note.service.ts`

**Context:** Update `NoteService` and `NoteController` to remove global `db` imports and accept `db: Db`.

**Changes:**

- [ ] **`src/modules/note/note.controller.ts`** — Type router with `OpenAPIHono<AppEnv>` and forward `c.var.db`.
- [ ] **`src/modules/note/note.service.ts`** — Accept `db: Db` parameter across all static methods.
- [ ] **`src/modules/note/note.service.ts`** — Remove `import { db } from '../../db/index.ts'`.

```ts
// src/modules/note/note.controller.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../../types/env.type.ts';
import { NoteService } from './note.service.ts';
import { NoteSchema, NotesSchema, NoteCreateSchema, NoteUpdateSchema, type Note } from './note.entity.ts';
import { CreateRouteUtil, IdParamSchema } from '../../utils/route.util.ts';

const app = new OpenAPIHono<AppEnv>();
const noteRoute = new CreateRouteUtil(['Note']);

app.openapi(
  noteRoute.createRouteUtil({
    method: 'get',
    path: '/',
    responseSchema: NotesSchema,
  }),
  async (c) => {
    const notes = await NoteService.getAllNotes(c.var.db);
    return c.json(notes);
  }
);

app.openapi(
  noteRoute.createRouteUtil({
    method: 'post',
    path: '/',
    requestSchema: NoteCreateSchema,
    responseSchema: NoteSchema,
    status: 201,
  }),
  async (c) => {
    const body = c.req.valid('json');
    const note: Note = await NoteService.createNote(c.var.db, body);
    return c.json(note, 201);
  }
);

app.openapi(
  noteRoute.createRouteUtil({
    method: 'get',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: NoteSchema,
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const note: Note = await NoteService.getNoteById(c.var.db, id);
    return c.json(note);
  }
);

app.openapi(
  noteRoute.createRouteUtil({
    method: 'put',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    requestSchema: NoteUpdateSchema,
    responseSchema: NoteSchema,
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const note: Note = await NoteService.updateNote(c.var.db, id, body);
    return c.json(note);
  }
);

app.openapi(
  noteRoute.createRouteUtil({
    method: 'delete',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: NoteSchema,
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const note: Note = await NoteService.deleteNote(c.var.db, id);
    return c.json(note);
  }
);

export default app;
```

```ts
// src/modules/note/note.service.ts
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/index.ts';
import { notes } from '../../db/schema.ts';
import type { NoteCreate, NoteUpdate } from './note.entity.ts';

class NoteService {
  static async getAllNotes(db: Db) {
    return await db.select().from(notes);
  }

  static async getNoteById(db: Db, id: string) {
    const result = await db.select().from(notes).where(eq(notes.id, id)).limit(1);

    if (result.length === 0) {
      throw new HTTPException(404, { message: `Note with id ${id} is not found` });
    }

    return result[0];
  }

  static async createNote(db: Db, note: NoteCreate) {
    const result = await db.insert(notes).values({
      ...note,
      status: 'pending',
    }).returning();

    return result[0];
  }

  static async updateNote(db: Db, id: string, updatedNote: NoteUpdate) {
    // Guard empty update payload to prevent SQLite syntax error
    if (Object.keys(updatedNote).length === 0) {
      return await this.getNoteById(db, id);
    }

    const result = await db.update(notes).set(updatedNote).where(eq(notes.id, id)).returning();

    if (result.length === 0) {
      throw new HTTPException(404, { message: `Note with id ${id} is not found` });
    }

    return result[0];
  }

  static async deleteNote(db: Db, id: string) {
    const result = await db.delete(notes).where(eq(notes.id, id)).returning();

    if (result.length === 0) {
      throw new HTTPException(404, { message: `Note with id ${id} is not found` });
    }

    return result[0];
  }
}

export { NoteService };
```

---

### #12 — Align Common Controller typing

**File:** `src/modules/common/common.controller.ts`

**Context:** Type `common.controller.ts` with `OpenAPIHono<AppEnv>` so route mounting in `app.module.ts` remains strictly type-safe.

**Changes:**

- [ ] **`src/modules/common/common.controller.ts`** — Instantiate router with `OpenAPIHono<AppEnv>()`.

```ts
// src/modules/common/common.controller.ts
// Before:
import { OpenAPIHono } from '@hono/zod-openapi'
const app = new OpenAPIHono()

// After:
import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../../types/env.type.ts'
const app = new OpenAPIHono<AppEnv>()
```

---

### #13 — Create Worker entry point and remove Node server entry

**Files:** `src/worker.ts` (New file), `src/index.ts` (Delete)

**Context:** `@hono/node-server` is replaced by the Cloudflare Worker native export. In Cloudflare Workers, exporting the Hono application directly satisfies the Fetch handler contract.

**Changes:**

- [ ] **`src/worker.ts`** — Create file exporting `app` as default export.
- [ ] **`src/index.ts`** — Delete the Node server `serve()` entry point.

```ts
// src/worker.ts (New file)
import app from './modules/app.module.ts';

export default app;
```

---

## Phase 4 — Testing Architecture & Vitest Setup

### #14 — Configure Vitest for D1 & Miniflare test execution

**Files:** `vitest.config.ts`, `src/test/test-db.ts`

**Context:** Tests need isolated, reproducible D1 database instances. There are two standard approaches:

#### Approach A: Official Cloudflare Workers Vitest Pool (Recommended)
Cloudflare's `@cloudflare/vitest-pool-workers` runs tests inside the actual Workers runtime (`workerd`), isolating storage per test file and preventing concurrency collisions.

1. Install:
   ```bash
   pnpm add -D @cloudflare/vitest-pool-workers
   ```
2. In `vitest.config.ts`, load migrations at config time via `readD1Migrations` and apply them inside tests with `applyD1Migrations`.

#### Approach B: Node-based Vitest with `getPlatformProxy` & Serial Execution
If keeping the standard Node test environment:
1. Vitest must run with `fileParallelism: false` to avoid multiple workers opening the same SQLite file simultaneously (`SQLITE_BUSY`).
2. Migrations must be run programmatically using Drizzle's D1 migrator `migrate(db, { migrationsFolder: './drizzle' })`.
3. The platform proxy must be created once and cleanly disposed in an `afterAll` hook to prevent Vitest from hanging.

**Implementation (Approach B — zero extra dependencies beyond `wrangler`):**

**Changes:**

- [ ] **`vitest.config.ts`** — Configure `fileParallelism: false` and 10s timeout.
- [ ] **`src/test/test-db.ts`** — Implement singleton proxy with automatic Drizzle migration execution on setup and proper disposal.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false, // Prevents SQLite database locking during concurrent tests
    testTimeout: 10000,
  },
});
```

```ts
// src/test/test-db.ts
import { getPlatformProxy } from 'wrangler';
import type { D1Database } from '@cloudflare/workers-types';
import { migrate } from 'drizzle-orm/d1/migrator';
import { createDb, type Db } from '../db/index.ts';

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>> | null = null;
let testDb: Db | null = null;
let migrated = false;

export async function setupTestDb(): Promise<Db> {
  if (!proxy) {
    proxy = await getPlatformProxy<{ DB: D1Database }>();
    testDb = createDb(proxy.env.DB);
  }

  if (!migrated && testDb) {
    await migrate(testDb, { migrationsFolder: './drizzle' });
    migrated = true;
  }

  return testDb!;
}

export async function teardownTestDb(): Promise<void> {
  if (proxy) {
    await proxy.dispose();
    proxy = null;
    testDb = null;
    migrated = false;
  }
}
```

---

### #15 — Update integration test suites

**Files:** `src/modules/user/user.service.test.ts`, `src/modules/note/note.service.test.ts`

**Context:** Service tests now initialize `db` via `setupTestDb()` in `beforeAll` and clean up their test tables in `afterAll`.

**Changes:**

- [ ] **`src/modules/user/user.service.test.ts`** — Pass `db` to all `UserService` calls; tear down proxy in `afterAll`.
- [ ] **`src/modules/note/note.service.test.ts`** — Pass `db` to all `NoteService` calls; clean up `notes` table in `afterAll`.

```ts
// src/modules/user/user.service.test.ts
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { UserService } from './user.service.ts';
import { userTable } from '../../db/schema.ts';
import { setupTestDb, teardownTestDb } from '../../test/test-db.ts';
import type { Db } from '../../db/index.ts';

describe('UserService', () => {
  let db: Db;
  let createdId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    if (db) {
      await db.delete(userTable);
    }
    await teardownTestDb();
  });

  it('should create a user', async () => {
    const user = await UserService.createUser(db, {
      username: 'johndoe',
      email: 'john@example.com',
      password: 'secret123',
    });

    expect(user).toHaveProperty('id');
    expect(user.username).toBe('johndoe');
    expect(user.email).toBe('john@example.com');
    expect(user).not.toHaveProperty('password');

    createdId = user.id;
  });

  it('should throw 400 when creating user with duplicate email', async () => {
    await expect(UserService.createUser(db, {
      username: 'janedoe',
      email: 'john@example.com',
      password: 'secret456',
    })).rejects.toBeInstanceOf(HTTPException);
  });

  it('should get all users', async () => {
    const allUsers = await UserService.getAllUsers(db);
    expect(allUsers.length).toBeGreaterThan(0);
    expect(allUsers[0]).toHaveProperty('id');
    expect(allUsers[0]).not.toHaveProperty('password');
  });

  it('should get user by id', async () => {
    const user = await UserService.getUserById(db, createdId);
    expect(user.id).toBe(createdId);
    expect(user.username).toBe('johndoe');
    expect(user).not.toHaveProperty('password');
  });

  it('should throw 404 when user not found', async () => {
    await expect(UserService.getUserById(db, '550e8400-e29b-41d4-a716-446655440000')).rejects.toBeInstanceOf(HTTPException);
  });

  it('should update a user', async () => {
    const updated = await UserService.updateUser(db, createdId, {
      username: 'johndoe_updated',
    });

    expect(updated.username).toBe('johndoe_updated');
    expect(updated.email).toBe('john@example.com');
  });

  it('should delete a user', async () => {
    const { id: secondUserId } = await UserService.createUser(db, {
      username: 'deleteme',
      email: 'delete@example.com',
      password: 'secret000',
    });

    const deleted = await UserService.deleteUser(db, secondUserId);
    expect(deleted.id).toBe(secondUserId);

    const remaining = await db.select().from(userTable).where(eq(userTable.id, secondUserId));
    expect(remaining.length).toBe(0);
  });
});
```

```ts
// src/modules/note/note.service.test.ts
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { NoteService } from './note.service.ts';
import { notes } from '../../db/schema.ts';
import { setupTestDb, teardownTestDb } from '../../test/test-db.ts';
import type { Db } from '../../db/index.ts';

describe('NoteService', () => {
  let db: Db;
  let createdId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    if (db) {
      await db.delete(notes);
    }
    await teardownTestDb();
  });

  it('should create a note with pending status', async () => {
    const note = await NoteService.createNote(db, {
      date: '2024-01-01',
      vendor: 'Test Vendor',
      name: 'Test Note',
      amount: 10,
      unit: 'pcs',
      price: 1000,
      category: 'Test',
      totalPrice: 10000,
      status: 'pending',
    });

    expect(note).toHaveProperty('id');
    expect(note.vendor).toBe('Test Vendor');
    expect(note.status).toBe('pending');
    expect(typeof note.amount).toBe('number');
    expect(typeof note.price).toBe('number');
    expect(typeof note.totalPrice).toBe('number');

    createdId = note.id;
  });

  it('should get all notes', async () => {
    const allNotes = await NoteService.getAllNotes(db);
    expect(allNotes.length).toBeGreaterThan(0);
    expect(allNotes[0]).toHaveProperty('id');
    expect(typeof allNotes[0].status).toBe('string');
  });

  it('should get note by id', async () => {
    const note = await NoteService.getNoteById(db, createdId);
    expect(note.id).toBe(createdId);
    expect(note.vendor).toBe('Test Vendor');
    expect(typeof note.status).toBe('string');
  });

  it('should throw 404 when note not found', async () => {
    await expect(NoteService.getNoteById(db, '550e8400-e29b-41d4-a716-446655440000')).rejects.toBeInstanceOf(HTTPException);
  });

  it('should update a note', async () => {
    const updated = await NoteService.updateNote(db, createdId, {
      vendor: 'Updated Vendor',
    });

    expect(updated.vendor).toBe('Updated Vendor');
    expect(typeof updated.status).toBe('string');
  });

  it('should delete a note', async () => {
    const deleted = await NoteService.deleteNote(db, createdId);
    expect(deleted.id).toBe(createdId);

    const remaining = await db.select().from(notes).where(eq(notes.id, createdId));
    expect(remaining.length).toBe(0);
  });
});
```

---

## Phase 5 — Cleanup & Legacy Removal

### #16 — Remove PostgreSQL artifacts and update ignore lists

**Files:** `docker-compose.yml`, `.gitignore`, `.env`, `.env.example`

**Context:** Remove Docker PostgreSQL services and update environment files for Wrangler/Miniflare.

**Changes:**

- [ ] **`docker-compose.yml`** — Delete PostgreSQL container specification.
- [ ] **`.gitignore`** — Add `.wrangler/`, `.dev.vars`, and `*.sqlite`.
- [ ] **`.env` / `.env.example`** — Remove `DATABASE_URL` and `DATABASE_URL_TEST`.

---

## Execution Order

| Step | Task | Files | Depends on |
| --- | --- | --- | --- |
| 1 | #1 (Dependencies & Scripts) | `package.json` | — |
| 2 | #2 (Wrangler Configuration) | `wrangler.toml` | #1 |
| 3 | #3 (Drizzle Dialect) | `drizzle.config.ts` | — |
| 4 | #4 (TypeScript & Types) | `tsconfig.json` | #1, #2 |
| 5 | #5 (SQLite Schema) | `src/db/schema.ts` | #3 |
| 6 | #6 (Database Client Factory) | `src/db/index.ts` | #4, #5 |
| 7 | #7 (App Environment Types) | `src/types/env.type.ts` | #6 |
| 8 | #9 (Composition Root & Middleware) | `src/modules/app.module.ts` | #7 |
| 9 | #10 (User Module Refactor) | `src/modules/user/user.controller.ts`, `user.service.ts` | #7, #9 |
| 10 | #11 (Note Module Refactor) | `src/modules/note/note.controller.ts`, `note.service.ts` | #7, #9 |
| 11 | #12 (Common Controller) | `src/modules/common/common.controller.ts` | #7 |
| 12 | #13 (Worker Entry Point) | `src/worker.ts`, `src/index.ts` | #9 |
| 13 | #8 (Seed Script / SQL) | `src/db/seed.sql`, `src/db/seed.ts` | #5 |
| 14 | #14 (Vitest & Test DB Helper) | `vitest.config.ts`, `src/test/test-db.ts` | #6 |
| 15 | #15 (Test Suites) | `src/modules/*/*.service.test.ts` | #10, #11, #14 |
| 16 | #16 (Cleanup) | `docker-compose.yml`, `.gitignore`, `.env` | — |

---

## Verification & Testing

- [ ] **1. Fresh Migration Generation**
  ```bash
  rm -rf drizzle/
  pnpm run db:generate
  ```
  Verify that SQL files inside `drizzle/` use SQLite syntax (e.g., `CREATE TABLE` without `pg_catalog`).

- [ ] **2. Local D1 Migration Application**
  ```bash
  pnpm run db:migrate:local
  ```
  Verify that migrations apply cleanly to the local Miniflare D1 database without prompt errors.

- [ ] **3. Static Type Verification**
  ```bash
  pnpm run typecheck
  ```
  Verify `tsc --noEmit` exits with `0` errors across all controllers, services, and tests.

- [ ] **4. Automated Integration Tests**
  ```bash
  pnpm test
  ```
  Verify all Vitest tests run against the local D1 proxy without hangs or concurrency errors.

- [ ] **5. Local Development Server**
  ```bash
  pnpm dev
  ```
  Verify server starts on `http://localhost:8787`, and Swagger UI is accessible at `http://localhost:8787/doc-ui`.
