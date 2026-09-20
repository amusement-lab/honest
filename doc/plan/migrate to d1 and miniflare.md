# Migration Plan: better-sqlite3 → Cloudflare D1 (with Miniflare)

---

## Scope

Migrate the database and runtime layer of the application from local Node.js (`better-sqlite3` and `@hono/node-server`) to Cloudflare Workers with Cloudflare D1 (built on SQLite). Local development and testing are powered by Wrangler and Miniflare.

> [!NOTE]
> The repository was previously migrated from PostgreSQL to SQLite (`better-sqlite3`). The schema (`src/db/schema.ts`) and Drizzle dialect (`drizzle.config.ts`) are already configured for SQLite. This migration focuses on:
>
> 1. Replacing the Node-based `better-sqlite3` driver with the Cloudflare D1 driver (`drizzle-orm/d1`).
> 2. Switching the server entrypoint from `@hono/node-server` to the native Cloudflare Worker export (`src/worker.ts`).
> 3. Injecting the request-scoped D1 database instance (`c.env.DB`) into Hono context (`c.var.db`) and passing it to services.
> 4. Setting up Miniflare via Wrangler for isolated in-memory test execution in Vitest.

---

## File Index

| File                                      | Status   | Description / Changes                                                                                                                         | Reference |
| ----------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `package.json`                            | Modified | Remove `better-sqlite3`, `@types/better-sqlite3`, `@hono/node-server`, `dotenv`. Add `wrangler`, `@cloudflare/workers-types`. Update scripts. | #1        |
| `src/utils/hash.util.ts`                  | Retained | Keep `.js` imports (`@noble/hashes/scrypt.js`, `@noble/hashes/utils.js`) required by `@noble/hashes` exports. Note on Free Tier CPU limits.   | #1        |
| `wrangler.toml`                           | New      | Worker configuration: compatibility flags, entry point, and D1 binding definition.                                                            | #2        |
| `drizzle.config.ts`                       | Modified | Remove `dotenv/config` and file-based `dbCredentials`. Keep `dialect: 'sqlite'`.                                                              | #3        |
| `tsconfig.json`                           | Modified | Add `@cloudflare/workers-types` and `vitest/globals` to `types`. Include `worker-configuration.d.ts`.                                         | #4        |
| `src/db/schema.ts`                        | Audited  | Confirm schema uses SQLite types (`text`, `integer`, `sqliteTable`) with `$defaultFn(() => crypto.randomUUID())`.                             | #5        |
| `src/db/index.ts`                         | Modified | Replace `better-sqlite3` singleton with `createDb(d1: D1Database)` factory and export `Db` type.                                              | #6        |
| `src/types/env.type.ts`                   | New      | Define `AppEnv` with `Bindings: Env` (from ambient `worker-configuration.d.ts`) and `Variables: { db: Db }`.                                  | #7        |
| `src/db/seed.sql`                         | New      | SQL seed script for D1 (`notes` and initial `users`).                                                                                         | #8        |
| `src/db/seed.ts`                          | Deleted  | Obsolete Node script importing `better-sqlite3`. Replaced by `wrangler d1 execute`.                                                           | #8        |
| `src/db/vitest-global-setup.ts`           | Deleted  | Obsolete Vitest setup script using `npx drizzle-kit push` on local file.                                                                      | #8, #14   |
| `src/modules/app.module.ts`               | Modified | Type app with `OpenAPIHono<AppEnv>`, attach request middleware to set `c.set('db')`, align error handling.                                    | #9        |
| `src/modules/user/user.controller.ts`     | Modified | Type router with `OpenAPIHono<AppEnv>`, forward `c.var.db` to `UserService`.                                                                  | #10       |
| `src/modules/user/user.service.ts`        | Modified | Accept `db: Db` as first argument in all static methods. Align unique constraint handling.                                                    | #10       |
| `src/modules/note/note.controller.ts`     | Modified | Type router with `OpenAPIHono<AppEnv>`, forward `c.var.db` to `NoteService`.                                                                  | #11       |
| `src/modules/note/note.service.ts`        | Modified | Accept `db: Db` as first argument in all static methods. Guard against empty update payloads.                                                 | #11       |
| `src/modules/common/common.controller.ts` | Modified | Type router with `OpenAPIHono<AppEnv>` for consistent route mounting.                                                                         | #12       |
| `src/worker.ts`                           | New      | Cloudflare Worker entry point exporting `default app`.                                                                                        | #13       |
| `src/index.ts`                            | Deleted  | Obsolete Node.js entry point (`serve()` from `@hono/node-server`).                                                                            | #13       |
| `vitest.config.ts`                        | Modified | Remove `globalSetup`, set `fileParallelism: false` and `testTimeout: 10000`.                                                                  | #14       |
| `src/test/test-db.ts`                     | New      | Test helper using `getPlatformProxy({ persist: false })` with automated Drizzle migration execution.                                          | #14       |
| `src/modules/user/user.service.test.ts`   | Modified | Refactor for `setupTestDb` and `db` parameter. Preserve all 10 unit test cases (including negative tests).                                    | #15       |
| `src/modules/note/note.service.test.ts`   | Modified | Refactor for `setupTestDb` and `db` parameter. Clean up state in `afterAll`.                                                                  | #15       |
| `src/modules/app.module.test.ts`          | New      | HTTP integration tests via `app.request()` verifying middleware, routing, and error responses.                                                | #15       |
| `.gitignore`                              | Modified | Add `.wrangler/`, `.dev.vars`, and `*.sqlite`.                                                                                                | #16       |
| `.env` / `.env.example`                   | Modified | Remove `DATABASE_URL` and `DATABASE_URL_TEST`.                                                                                                | #16       |

---

## Phase 1 — Configuration & Dependencies

### #1 — Update dependencies, package scripts & hash utility audit

**Files:** `package.json`, `src/utils/hash.util.ts`

**Context:**

- The current project uses `better-sqlite3`, `@types/better-sqlite3`, `@hono/node-server`, and `dotenv`. These are Node-specific and must be removed for Cloudflare Workers.
- Add `wrangler` and `@cloudflare/workers-types` as development dependencies.
- Update npm scripts for local Worker development (`wrangler dev`), deployment (`wrangler deploy`), migration execution (`wrangler d1 migrations apply`), type generation (`wrangler types`), and seeding.
- **CRITICAL NOTE ON HASH UTILITY:** In `src/utils/hash.util.ts`, do **NOT** remove the `.js` extension from imports (`import ... from '@noble/hashes/scrypt.js'`). The `@noble/hashes` package defines subpath exports exclusively with `.js`. Removing it causes an immediate `ERR_PACKAGE_PATH_NOT_EXPORTED` compiler/runtime error under `NodeNext` module resolution.
- **OPERATIONAL NOTE ON WORKERS FREE TIER:** `@noble/hashes/scryptAsync` is pure JavaScript. Computing Scrypt with $N=16384$ takes ~100ms CPU time. Cloudflare Workers Free Tier enforces a **50ms CPU execution limit**. If deploying to the free tier, consider migrating to Web Crypto API (`crypto.subtle.deriveBits` with PBKDF2) or tuning Scrypt cost parameters to avoid `Worker exceeded CPU limit`.

**Changes:**

- [ ] **`package.json`** — Remove `better-sqlite3`, `@types/better-sqlite3`, `@hono/node-server`, `dotenv`.
- [ ] **`package.json`** — Add `wrangler` and `@cloudflare/workers-types` to `devDependencies`.
- [ ] **`package.json`** — Add complete script definitions.
- [ ] **`src/utils/hash.util.ts`** — Keep `.js` extensions intact.

```bash
pnpm remove better-sqlite3 @types/better-sqlite3 @hono/node-server dotenv
pnpm add -D wrangler @cloudflare/workers-types
```

```json
// package.json (Updated scripts)
{
  "name": "honest",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "types:generate": "wrangler types",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply honest-db --local --yes",
    "db:migrate:remote": "wrangler d1 migrations apply honest-db --remote --yes",
    "db:seed": "wrangler d1 execute honest-db --local --file=./src/db/seed.sql"
  }
}
```

---

### #2 — Create Cloudflare Worker configuration (`wrangler.toml`)

**File:** `wrangler.toml` (New file)

**Context:**
Defines the Cloudflare Worker settings: entry point (`src/worker.ts`), compatibility date, Node.js compatibility flags, and D1 database binding named `DB`.

> [!WARNING]
> `database_id = "honest-db-local"` is a local development placeholder. While Wrangler accepts this for local emulation (`--local`), remote deployment (`wrangler deploy` or `wrangler d1 migrations apply --remote`) requires a real Cloudflare D1 UUID.
> Before deploying to production, run:
>
> ```bash
> wrangler d1 create honest-db
> ```
>
> and update `database_id` with the returned UUID.

**Changes:**

- [ ] **`wrangler.toml`** — Create configuration in repository root.

```toml
# wrangler.toml
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

### #3 — Update Drizzle Kit configuration

**File:** `drizzle.config.ts`

**Context:**
Drizzle Kit only needs `schema`, `out`, and `dialect: 'sqlite'` to generate SQL migrations. Remove `dotenv/config` and file-based `dbCredentials`. Migrations will be applied locally and remotely via Wrangler CLI (`wrangler d1 migrations apply`).

**Changes:**

- [ ] **`drizzle.config.ts`** — Remove `dotenv/config` and `dbCredentials`. Keep `dialect: 'sqlite'`.

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
});
```

---

### #4 — Update TypeScript configuration & Worker types

**File:** `tsconfig.json`

**Context:**
Cloudflare Workers types are injected globally via `@cloudflare/workers-types`. Running `pnpm run types:generate` (`wrangler types`) automatically generates ambient types in `worker-configuration.d.ts` that match all bindings declared in `wrangler.toml`.

**Changes:**

- [ ] **`tsconfig.json`** — Add `@cloudflare/workers-types` and `vitest/globals` to `compilerOptions.types`.
- [ ] **`tsconfig.json`** — Include `worker-configuration.d.ts` in `include`.
- [ ] Run `pnpm run types:generate` to generate `worker-configuration.d.ts`.

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "worker-configuration.d.ts"]
}
```

---

## Phase 2 — Database Schema & Architecture

### #5 — Verify SQLite Schema

**File:** `src/db/schema.ts`

**Context:**
The current `src/db/schema.ts` is already written using `drizzle-orm/sqlite-core`. UUID primary keys use `$defaultFn(() => crypto.randomUUID())` which is supported natively in Cloudflare Workers global scope. Verify that schema definitions align with SQLite conventions.

**Changes:**

- [ ] **`src/db/schema.ts`** — Audit to ensure table and column names align with D1 requirements.

```ts
// src/db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  date: text("date").notNull(),
  vendor: text("vendor").notNull(),
  name: text("name").notNull(),
  amount: integer("amount").notNull(),
  unit: text("unit").notNull(),
  price: integer("price").notNull(),
  category: text("category").notNull(),
  totalPrice: integer("total_price").notNull(),
  status: text("status").notNull().default("pending"),
});

export const userTable = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text("username", { length: 100 }).notNull(),
  email: text("email", { length: 255 }).notNull().unique(),
  password: text("password", { length: 255 }).notNull(),
});
```

---

### #6 — Convert database client to D1 factory

**File:** `src/db/index.ts`

**Context:**
In Cloudflare Workers, database connections cannot be global singletons using file-system paths or environment variables at module evaluation time. The D1 database binding is injected per-request on `c.env.DB`. Provide a lightweight factory function `createDb(d1: D1Database)` that initializes the Drizzle D1 adapter, and export the derived `Db` type.

**Changes:**

- [ ] **`src/db/index.ts`** — Remove `better-sqlite3` driver, `dotenv/config`, and singleton client.
- [ ] **`src/db/index.ts`** — Implement `createDb(d1: D1Database)` factory using `drizzle-orm/d1`.
- [ ] **`src/db/index.ts`** — Export `type Db = ReturnType<typeof createDb>`.

```ts
// src/db/index.ts
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "./schema.ts";

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
```

---

### #7 — Define application environment types

**File:** `src/types/env.type.ts` (New file)

**Context:**
Centralize Hono typed environment definitions. By binding `Bindings: Env` (where `Env` is generated by `wrangler types` in `worker-configuration.d.ts`), all Wrangler bindings are automatically available with full type safety without manual duplication.

**Changes:**

- [ ] **`src/types/env.type.ts`** — Create `AppEnv` typing `Bindings` and `Variables`.

```ts
// src/types/env.type.ts
import type { Db } from "../db/index.ts";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: Db;
  };
};
```

---

### #8 — Seed script & obsolete file cleanup

**Files:** `src/db/seed.sql` (New file), `src/db/seed.ts` (Delete), `src/db/vitest-global-setup.ts` (Delete)

**Context:**

- `src/db/seed.ts` directly imports `better-sqlite3` and executes Node file operations. Delete this file.
- `src/db/vitest-global-setup.ts` executes `drizzle-kit push` on `./sqlite.test.db`. This is obsolete in the Miniflare test architecture and must be deleted.
- Create `src/db/seed.sql` with reproducible seed data for both `notes` and `users` (with a pre-hashed password).
- Seeding is executed using Wrangler: `pnpm run db:seed`.

**Changes:**

- [ ] **`src/db/seed.sql`** — Create reproducible SQL seed script for D1.
- [ ] **`src/db/seed.ts`** — Delete obsolete file.
- [ ] **`src/db/vitest-global-setup.ts`** — Delete obsolete file.

```sql
-- src/db/seed.sql
INSERT INTO notes (id, date, vendor, name, amount, unit, price, category, total_price, status)
VALUES (
  '550e8400-e29b-41d4-a716-446655440001',
  '2024-01-01',
  'Office Supplies Co.',
  'Printer Paper A4',
  5,
  'ream',
  50000,
  'Stationery',
  250000,
  'pending'
);

-- Seed user: password is 'secret123' hashed with scrypt
INSERT INTO users (id, username, email, password)
VALUES (
  '550e8400-e29b-41d4-a716-446655440002',
  'admin',
  'admin@example.com',
  'a1b2c3d4e5f60718293a4b5c6d7e8f90:5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'
);
```

---

## Phase 3 — Composition Root, Controllers & Services

### #9 — Update composition root and error handling

**File:** `src/modules/app.module.ts`

**Context:**
The composition root must:

1. Initialize `OpenAPIHono<AppEnv>`.
2. Attach middleware that initializes `c.set('db', createDb(c.env.DB))` on each request.
3. Handle `HTTPException` and uncaught errors cleanly.
4. Catch SQLite unique constraint errors (`UNIQUE constraint failed`) and return consistent `409 Conflict` responses.

**Changes:**

- [ ] **`src/modules/app.module.ts`** — Update `app` typing to `OpenAPIHono<AppEnv>`.
- [ ] **`src/modules/app.module.ts`** — Add D1 binding middleware with environment validation guard.
- [ ] **`src/modules/app.module.ts`** — Standardize constraint violation error handling to `409 Conflict`.

```ts
// src/modules/app.module.ts
import { HTTPException } from "hono/http-exception";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { createDb } from "../db/index.ts";
import type { AppEnv } from "../types/env.type.ts";

import common from "./common/common.controller.ts";
import note from "./note/note.controller.ts";
import user from "./user/user.controller.ts";

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          message: result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(", "),
        },
        400,
      );
    }
  },
});

// Middleware: initialize scoped DB binding for each incoming request
app.use(async (c, next) => {
  if (!c.env?.DB) {
    throw new Error(
      'D1 database binding "DB" is not configured in request environment',
    );
  }
  c.set("db", createDb(c.env.DB));
  await next();
});

app.doc("/doc", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Honest API",
  },
});
app.get("/doc-ui", swaggerUI({ url: "/doc" }));

app.route("/user", user);
app.route("/note", note);
app.route("/", common);

app.onError((err, c) => {
  console.error(
    JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      method: c.req.method,
      url: c.req.url,
    }),
  );

  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status);
  }

  // D1 / SQLite unique constraint violation
  if (
    err instanceof Error &&
    err.message.includes("UNIQUE constraint failed")
  ) {
    return c.json({ message: "Resource already exists" }, 409);
  }

  return c.json({ message: "Internal Server Error" }, 500);
});

export default app;
```

---

### #10 — Refactor User Module for context injection

**Files:** `src/modules/user/user.controller.ts`, `src/modules/user/user.service.ts`

**Context:**

- Controllers receive `c.var.db` from context and pass it to static service methods.
- Services accept `db: Db` as their first argument.
- Standardize duplicate email errors to `HTTPException(409, ...)` so both pre-checks and database unique constraint catches return consistent HTTP 409 responses.
- In `updateUser`, handle empty payloads gracefully to avoid SQLite syntax errors on `UPDATE ... SET WHERE`.

**Changes:**

- [ ] **`src/modules/user/user.controller.ts`** — Type with `OpenAPIHono<AppEnv>` and pass `c.var.db`.
- [ ] **`src/modules/user/user.service.ts`** — Accept `db: Db` across all static methods. Remove global `db` import.
- [ ] **`src/modules/user/user.service.ts`** — Standardize duplicate email error status to 409.

```ts
// src/modules/user/user.controller.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types/env.type.ts";
import { UserService } from "./user.service.ts";
import {
  UserSchema,
  UsersSchema,
  UserCreateSchema,
  UserUpdateSchema,
  type User,
} from "./user.entity.ts";
import { CreateRouteUtil, IdParamSchema } from "../../utils/route.util.ts";

const app = new OpenAPIHono<AppEnv>();
const userRoute = new CreateRouteUtil(["User"]);

app.openapi(
  userRoute.createRouteUtil({
    method: "get",
    path: "/",
    responseSchema: UsersSchema,
  }),
  async (c) => {
    const users = await UserService.getAllUsers(c.var.db);
    return c.json(users);
  },
);

app.openapi(
  userRoute.createRouteUtil({
    method: "post",
    path: "/",
    requestSchema: UserCreateSchema,
    responseSchema: UserSchema,
    status: 201,
  }),
  async (c) => {
    const body = c.req.valid("json");
    const user: User = await UserService.createUser(c.var.db, body);
    return c.json(user, 201);
  },
);

app.openapi(
  userRoute.createRouteUtil({
    method: "get",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const user: User = await UserService.getUserById(c.var.db, id);
    return c.json(user);
  },
);

app.openapi(
  userRoute.createRouteUtil({
    method: "put",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    requestSchema: UserUpdateSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const user: User = await UserService.updateUser(c.var.db, id, body);
    return c.json(user);
  },
);

app.openapi(
  userRoute.createRouteUtil({
    method: "delete",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const user: User = await UserService.deleteUser(c.var.db, id);
    return c.json(user);
  },
);

export default app;
```

```ts
// src/modules/user/user.service.ts
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { userTable } from "../../db/schema.ts";
import { hashPassword } from "../../utils/hash.util.ts";
import type { UserCreate, UserUpdate } from "./user.entity.ts";

class UserService {
  static async getAllUsers(db: Db) {
    return db
      .select({
        id: userTable.id,
        username: userTable.username,
        email: userTable.email,
      })
      .from(userTable);
  }

  static async getUserById(db: Db, id: string) {
    const result = await db
      .select({
        id: userTable.id,
        username: userTable.username,
        email: userTable.email,
      })
      .from(userTable)
      .where(eq(userTable.id, id))
      .limit(1);

    if (result.length === 0) {
      throw new HTTPException(404, {
        message: `User with id ${id} is not found`,
      });
    }

    return result[0];
  }

  static async createUser(db: Db, user: UserCreate) {
    const existing = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, user.email))
      .limit(1);
    if (existing.length > 0) {
      throw new HTTPException(409, {
        message: `User with email ${user.email} already exists`,
      });
    }

    const hashedPassword = await hashPassword(user.password);

    try {
      const result = await db
        .insert(userTable)
        .values({
          username: user.username,
          email: user.email,
          password: hashedPassword,
        })
        .returning({
          id: userTable.id,
          username: userTable.username,
          email: userTable.email,
        });

      return result[0];
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        throw new HTTPException(409, {
          message: `User with email ${user.email} already exists`,
        });
      }
      throw err;
    }
  }

  static async updateUser(db: Db, id: string, updatedUser: UserUpdate) {
    const existing = await db
      .select({ id: userTable.id, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, id))
      .limit(1);
    if (existing.length === 0) {
      throw new HTTPException(404, {
        message: `User with id ${id} is not found`,
      });
    }

    if (updatedUser.email && updatedUser.email !== existing[0].email) {
      const duplicate = await db
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.email, updatedUser.email))
        .limit(1);
      if (duplicate.length > 0) {
        throw new HTTPException(409, {
          message: `User with email ${updatedUser.email} already exists`,
        });
      }
    }

    const values: Partial<typeof userTable.$inferInsert> = {};
    if (updatedUser.username !== undefined)
      values.username = updatedUser.username;
    if (updatedUser.email !== undefined) values.email = updatedUser.email;
    if (updatedUser.password !== undefined)
      values.password = await hashPassword(updatedUser.password);

    // Guard empty update payload to prevent SQLite syntax error
    if (Object.keys(values).length === 0) {
      return await this.getUserById(db, id);
    }

    try {
      const result = await db
        .update(userTable)
        .set(values)
        .where(eq(userTable.id, id))
        .returning({
          id: userTable.id,
          username: userTable.username,
          email: userTable.email,
        });

      return result[0];
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        throw new HTTPException(409, {
          message: `User with email ${updatedUser.email} already exists`,
        });
      }
      throw err;
    }
  }

  static async deleteUser(db: Db, id: string) {
    const result = await db
      .delete(userTable)
      .where(eq(userTable.id, id))
      .returning({
        id: userTable.id,
        username: userTable.username,
        email: userTable.email,
      });

    if (result.length === 0) {
      throw new HTTPException(404, {
        message: `User with id ${id} is not found`,
      });
    }

    return result[0];
  }
}

export { UserService };
```

---

### #11 — Refactor Note Module for context injection

**Files:** `src/modules/note/note.controller.ts`, `src/modules/note/note.service.ts`

**Context:**

- Controllers receive `c.var.db` from context and forward to `NoteService`.
- Services accept `db: Db` as their first argument.
- Guard empty update payloads to prevent SQLite syntax errors.

**Changes:**

- [ ] **`src/modules/note/note.controller.ts`** — Type with `OpenAPIHono<AppEnv>` and pass `c.var.db`.
- [ ] **`src/modules/note/note.service.ts`** — Accept `db: Db` parameter across all static methods. Remove global `db` import.

```ts
// src/modules/note/note.controller.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types/env.type.ts";
import { NoteService } from "./note.service.ts";
import {
  NoteSchema,
  NotesSchema,
  NoteCreateSchema,
  NoteUpdateSchema,
  type Note,
} from "./note.entity.ts";
import { CreateRouteUtil, IdParamSchema } from "../../utils/route.util.ts";

const app = new OpenAPIHono<AppEnv>();
const noteRoute = new CreateRouteUtil(["Note"]);

app.openapi(
  noteRoute.createRouteUtil({
    method: "get",
    path: "/",
    responseSchema: NotesSchema,
  }),
  async (c) => {
    const notes = await NoteService.getAllNotes(c.var.db);
    return c.json(notes);
  },
);

app.openapi(
  noteRoute.createRouteUtil({
    method: "post",
    path: "/",
    requestSchema: NoteCreateSchema,
    responseSchema: NoteSchema,
    status: 201,
  }),
  async (c) => {
    const body = c.req.valid("json");
    const note: Note = await NoteService.createNote(c.var.db, body);
    return c.json(note, 201);
  },
);

app.openapi(
  noteRoute.createRouteUtil({
    method: "get",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    responseSchema: NoteSchema,
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const note: Note = await NoteService.getNoteById(c.var.db, id);
    return c.json(note);
  },
);

app.openapi(
  noteRoute.createRouteUtil({
    method: "put",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    requestSchema: NoteUpdateSchema,
    responseSchema: NoteSchema,
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const note: Note = await NoteService.updateNote(c.var.db, id, body);
    return c.json(note);
  },
);

app.openapi(
  noteRoute.createRouteUtil({
    method: "delete",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    responseSchema: NoteSchema,
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const note: Note = await NoteService.deleteNote(c.var.db, id);
    return c.json(note);
  },
);

export default app;
```

```ts
// src/modules/note/note.service.ts
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { notes } from "../../db/schema.ts";
import type { NoteCreate, NoteUpdate } from "./note.entity.ts";

class NoteService {
  static async getAllNotes(db: Db) {
    return await db.select().from(notes);
  }

  static async getNoteById(db: Db, id: string) {
    const result = await db
      .select()
      .from(notes)
      .where(eq(notes.id, id))
      .limit(1);

    if (result.length === 0) {
      throw new HTTPException(404, {
        message: `Note with id ${id} is not found`,
      });
    }

    return result[0];
  }

  static async createNote(db: Db, note: NoteCreate) {
    const result = await db
      .insert(notes)
      .values({
        ...note,
        status: "pending",
      })
      .returning();

    return result[0];
  }

  static async updateNote(db: Db, id: string, updatedNote: NoteUpdate) {
    // Guard empty update payload to prevent SQLite syntax error
    if (Object.keys(updatedNote).length === 0) {
      return await this.getNoteById(db, id);
    }

    const result = await db
      .update(notes)
      .set(updatedNote)
      .where(eq(notes.id, id))
      .returning();

    if (result.length === 0) {
      throw new HTTPException(404, {
        message: `Note with id ${id} is not found`,
      });
    }

    return result[0];
  }

  static async deleteNote(db: Db, id: string) {
    const result = await db.delete(notes).where(eq(notes.id, id)).returning();

    if (result.length === 0) {
      throw new HTTPException(404, {
        message: `Note with id ${id} is not found`,
      });
    }

    return result[0];
  }
}

export { NoteService };
```

---

### #12 — Align Common Controller typing

**File:** `src/modules/common/common.controller.ts`

**Context:**
Type `common.controller.ts` with `OpenAPIHono<AppEnv>` so route mounting in `app.module.ts` remains strictly type-safe.

**Changes:**

- [ ] **`src/modules/common/common.controller.ts`** — Instantiate router with `OpenAPIHono<AppEnv>()`.

```ts
// src/modules/common/common.controller.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types/env.type.ts";
import { CreateRouteUtil } from "../../utils/route.util.ts";

const app = new OpenAPIHono<AppEnv>();
const commonRoute = new CreateRouteUtil(["Common"]);

app.openapi(
  commonRoute.createRouteUtil({
    method: "get",
    path: "/",
  }),
  (c) => {
    return c.json({ message: "Hono API is starting" });
  },
);

export default app;
```

---

### #13 — Create Worker entry point and remove Node server entry

**Files:** `src/worker.ts` (New file), `src/index.ts` (Delete)

**Context:**
Cloudflare Workers use standard fetch handler exports. The Hono application instance satisfies this contract directly (`export default app`). Remove `src/index.ts` which uses `@hono/node-server`.

**Changes:**

- [ ] **`src/worker.ts`** — Create file exporting `app` as default export.
- [ ] **`src/index.ts`** — Delete the Node server `serve()` entry point.

```ts
// src/worker.ts (New file)
import app from "./modules/app.module.ts";

export default app;
```

---

## Phase 4 — Testing Architecture & Vitest Setup

### #14 — Configure Vitest & Miniflare Test Helper

**Files:** `vitest.config.ts`, `src/test/test-db.ts` (New file)

**Context:**

- Tests run under Node via Vitest, using Wrangler's `getPlatformProxy()` to simulate the Cloudflare D1 environment.
- **CRITICAL ISOLATION REQUIREMENT:** `getPlatformProxy({ persist: false })` MUST be used. Without `{ persist: false }`, tests will read from and delete data in `.wrangler/state/v3/d1`, wiping your local development database.
- Setting `fileParallelism: false` ensures serial execution, avoiding SQLite lock collisions.
- Migrations are applied programmatically to the in-memory test database using `drizzle-orm/d1/migrator`.

**Changes:**

- [ ] **`vitest.config.ts`** — Remove `globalSetup`, configure `fileParallelism: false` and `testTimeout: 10000`.
- [ ] **`src/test/test-db.ts`** — Implement helper with `persist: false`, programmatic Drizzle migration execution, and cleanup.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false,
    testTimeout: 10000,
  },
});
```

```ts
// src/test/test-db.ts
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { migrate } from "drizzle-orm/d1/migrator";
import { createDb, type Db } from "../db/index.ts";

let proxy: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>
> | null = null;
let testDb: Db | null = null;

/**
 * Initializes an isolated, in-memory D1 database proxy for testing and applies all migrations.
 * Using persist: false ensures test data NEVER writes to or corrupts the local dev database.
 */
export async function setupTestDb(): Promise<{ db: Db; d1: D1Database }> {
  if (!proxy) {
    proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false });
    testDb = createDb(proxy.env.DB);
    await migrate(testDb, { migrationsFolder: "./drizzle" });
  }

  return { db: testDb!, d1: proxy.env.DB };
}

export async function teardownTestDb(): Promise<void> {
  if (proxy) {
    await proxy.dispose();
    proxy = null;
    testDb = null;
  }
}
```

---

### #15 — Update integration test suites

**Files:** `src/modules/user/user.service.test.ts`, `src/modules/note/note.service.test.ts`, `src/modules/app.module.test.ts` (New file)

**Context:**

- Refactor existing test suites to obtain `db` via `setupTestDb()`.
- **PRESERVE ALL TEST CASES:** Maintain all 10 test cases in `user.service.test.ts` (including 404 on updating non-existent, 409 on duplicate email update, and 404 on deleting non-existent).
- Add HTTP integration testing for `app.module.ts` via `app.request()` to verify that Hono middleware (`c.set('db')`), route dispatching, and error handlers execute as expected in an edge request lifecycle.

**Changes:**

- [ ] **`src/modules/user/user.service.test.ts`** — Pass `db` to all `UserService` calls; preserve all 10 tests.
- [ ] **`src/modules/note/note.service.test.ts`** — Pass `db` to all `NoteService` calls; clean up in `afterAll`.
- [ ] **`src/modules/app.module.test.ts`** — Create HTTP integration tests using `app.request()`.

```ts
// src/modules/user/user.service.test.ts
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { UserService } from "./user.service.ts";
import { userTable } from "../../db/schema.ts";
import { setupTestDb, teardownTestDb } from "../../test/test-db.ts";
import type { Db } from "../../db/index.ts";

describe("UserService", () => {
  let db: Db;
  let createdId: string;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
  });

  afterAll(async () => {
    if (db) {
      await db.delete(userTable);
    }
    await teardownTestDb();
  });

  it("should create a user", async () => {
    const user = await UserService.createUser(db, {
      username: "johndoe",
      email: "john@example.com",
      password: "secret123",
    });

    expect(user).toHaveProperty("id");
    expect(user.username).toBe("johndoe");
    expect(user.email).toBe("john@example.com");
    expect(user).not.toHaveProperty("password");

    createdId = user.id;
  });

  it("should throw 409 when creating user with duplicate email", async () => {
    await expect(
      UserService.createUser(db, {
        username: "janedoe",
        email: "john@example.com",
        password: "secret456",
      }),
    ).rejects.toBeInstanceOf(HTTPException);
  });

  it("should get all users", async () => {
    const allUsers = await UserService.getAllUsers(db);
    expect(allUsers.length).toBeGreaterThan(0);
    expect(allUsers[0]).toHaveProperty("id");
    expect(allUsers[0]).not.toHaveProperty("password");
  });

  it("should get user by id", async () => {
    const user = await UserService.getUserById(db, createdId);
    expect(user.id).toBe(createdId);
    expect(user.username).toBe("johndoe");
    expect(user).not.toHaveProperty("password");
  });

  it("should throw 404 when user not found", async () => {
    await expect(
      UserService.getUserById(db, "550e8400-e29b-41d4-a716-446655440000"),
    ).rejects.toBeInstanceOf(HTTPException);
  });

  it("should update a user", async () => {
    const updated = await UserService.updateUser(db, createdId, {
      username: "johndoe_updated",
    });

    expect(updated.username).toBe("johndoe_updated");
    expect(updated.email).toBe("john@example.com");
  });

  it("should throw 404 when updating non-existent user", async () => {
    await expect(
      UserService.updateUser(db, "550e8400-e29b-41d4-a716-446655440000", {
        username: "ghost",
      }),
    ).rejects.toBeInstanceOf(HTTPException);
  });

  it("should throw 409 when updating user with duplicate email", async () => {
    await UserService.createUser(db, {
      username: "janedoe",
      email: "jane@example.com",
      password: "secret789",
    });

    await expect(
      UserService.updateUser(db, createdId, {
        email: "jane@example.com",
      }),
    ).rejects.toBeInstanceOf(HTTPException);
  });

  it("should delete a user", async () => {
    const { id: secondUserId } = await UserService.createUser(db, {
      username: "deleteme",
      email: "delete@example.com",
      password: "secret000",
    });

    const deleted = await UserService.deleteUser(db, secondUserId);
    expect(deleted.id).toBe(secondUserId);

    const remaining = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, secondUserId));
    expect(remaining.length).toBe(0);
  });

  it("should throw 404 when deleting non-existent user", async () => {
    await expect(
      UserService.deleteUser(db, "550e8400-e29b-41d4-a716-446655440000"),
    ).rejects.toBeInstanceOf(HTTPException);
  });
});
```

```ts
// src/modules/note/note.service.test.ts
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { NoteService } from "./note.service.ts";
import { notes } from "../../db/schema.ts";
import { setupTestDb, teardownTestDb } from "../../test/test-db.ts";
import type { Db } from "../../db/index.ts";

describe("NoteService", () => {
  let db: Db;
  let createdId: string;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
  });

  afterAll(async () => {
    if (db) {
      await db.delete(notes);
    }
    await teardownTestDb();
  });

  it("should create a note with pending status", async () => {
    const note = await NoteService.createNote(db, {
      date: "2024-01-01",
      vendor: "Test Vendor",
      name: "Test Note",
      amount: 10,
      unit: "pcs",
      price: 1000,
      category: "Test",
      totalPrice: 10000,
      status: "pending",
    });

    expect(note).toHaveProperty("id");
    expect(note.vendor).toBe("Test Vendor");
    expect(note.status).toBe("pending");
    expect(typeof note.amount).toBe("number");
    expect(typeof note.price).toBe("number");
    expect(typeof note.totalPrice).toBe("number");

    createdId = note.id;
  });

  it("should get all notes", async () => {
    const allNotes = await NoteService.getAllNotes(db);
    expect(allNotes.length).toBeGreaterThan(0);
    expect(allNotes[0]).toHaveProperty("id");
    expect(typeof allNotes[0].status).toBe("string");
  });

  it("should get note by id", async () => {
    const note = await NoteService.getNoteById(db, createdId);
    expect(note.id).toBe(createdId);
    expect(note.vendor).toBe("Test Vendor");
    expect(typeof note.status).toBe("string");
  });

  it("should throw 404 when note not found", async () => {
    await expect(
      NoteService.getNoteById(db, "550e8400-e29b-41d4-a716-446655440000"),
    ).rejects.toBeInstanceOf(HTTPException);
  });

  it("should update a note", async () => {
    const updated = await NoteService.updateNote(db, createdId, {
      vendor: "Updated Vendor",
    });

    expect(updated.vendor).toBe("Updated Vendor");
    expect(typeof updated.status).toBe("string");
  });

  it("should delete a note", async () => {
    const deleted = await NoteService.deleteNote(db, createdId);
    expect(deleted.id).toBe(createdId);

    const remaining = await db
      .select()
      .from(notes)
      .where(eq(notes.id, createdId));
    expect(remaining.length).toBe(0);
  });
});
```

```ts
// src/modules/app.module.test.ts (New HTTP Integration Test)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import app from "./app.module.ts";
import { setupTestDb, teardownTestDb } from "../test/test-db.ts";

describe("App HTTP Integration (app.request)", () => {
  let d1: D1Database;

  beforeAll(async () => {
    const setup = await setupTestDb();
    d1 = setup.d1;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("should return welcome message from GET /", async () => {
    const res = await app.request("/", { method: "GET" }, { DB: d1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "Hono API is starting" });
  });

  it("should return 200 and user list from GET /user", async () => {
    const res = await app.request("/user", { method: "GET" }, { DB: d1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("should return 400 when creating note with invalid body", async () => {
    const res = await app.request(
      "/note",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invalid: "field" }),
      },
      { DB: d1 },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("message");
  });
});
```

---

## Phase 5 — Cleanup & Legacy Removal

### #16 — Remove Node artifacts and update environment/ignore lists

**Files:** `.gitignore`, `.env`, `.env.example`, `sqlite.db*`

**Context:**
Clean up remaining Node and SQLite artifacts from the repository.

**Changes:**

- [ ] **`.gitignore`** — Add `.wrangler/`, `.dev.vars`, and `*.sqlite`.
- [ ] **`.env` / `.env.example`** — Remove `DATABASE_URL` and `DATABASE_URL_TEST`.
- [ ] Delete any untracked local SQLite files (`sqlite.db`, `sqlite.test.db`, `sqlite.db-wal`, `sqlite.db-shm`).

```
# .gitignore additions
.wrangler/
.dev.vars
*.sqlite
```

---

## Execution Order

| Step   | Task                        | Target Files                                                                           | Depends on    |
| :----- | :-------------------------- | :------------------------------------------------------------------------------------- | :------------ |
| **1**  | #1 (Dependencies & Scripts) | `package.json`                                                                         | —             |
| **2**  | #2 (Wrangler Config)        | `wrangler.toml`                                                                        | #1            |
| **3**  | #3 (Drizzle Config)         | `drizzle.config.ts`                                                                    | —             |
| **4**  | #4 (TypeScript & Types)     | `tsconfig.json`, `worker-configuration.d.ts`                                           | #1, #2        |
| **5**  | #5 (Audit Schema)           | `src/db/schema.ts`                                                                     | #3            |
| **6**  | #6 (D1 Client Factory)      | `src/db/index.ts`                                                                      | #4, #5        |
| **7**  | #7 (App Environment Types)  | `src/types/env.type.ts`                                                                | #4, #6        |
| **8**  | #9 (Composition Root)       | `src/modules/app.module.ts`                                                            | #7            |
| **9**  | #10 (User Module)           | `src/modules/user/user.controller.ts`, `user.service.ts`                               | #7, #9        |
| **10** | #11 (Note Module)           | `src/modules/note/note.controller.ts`, `note.service.ts`                               | #7, #9        |
| **11** | #12 (Common Controller)     | `src/modules/common/common.controller.ts`                                              | #7            |
| **12** | #13 (Worker Entrypoint)     | `src/worker.ts`, `src/index.ts` (delete)                                               | #9            |
| **13** | #8 (Seed & Legacy Cleanup)  | `src/db/seed.sql`, `src/db/seed.ts` (delete), `src/db/vitest-global-setup.ts` (delete) | #5            |
| **14** | #14 (Test Setup Helper)     | `vitest.config.ts`, `src/test/test-db.ts`                                              | #6            |
| **15** | #15 (Test Suites)           | `src/modules/*/*.service.test.ts`, `src/modules/app.module.test.ts`                    | #10, #11, #14 |
| **16** | #16 (Cleanup)               | `.gitignore`, `.env`, `.env.example`                                                   | —             |

---

## Verification & Testing

- [ ] **1. Migration Generation**

  ```bash
  pnpm run db:generate
  ```

  Ensure Drizzle Kit generates SQL files in `drizzle/` using SQLite syntax and statement breakpoints (`--> statement-breakpoint`).

- [ ] **2. Local D1 Migration Application**

  ```bash
  pnpm run db:migrate:local
  ```

  Apply migrations to the local Miniflare D1 database without prompt errors.

- [ ] **3. Local Database Seeding**

  ```bash
  pnpm run db:seed
  ```

  Verify seed records are inserted cleanly into local D1.

- [ ] **4. Static Type Verification**

  ```bash
  pnpm run types:generate
  pnpm run typecheck
  ```

  Verify `tsc --noEmit` exits with `0` errors across all controllers, services, and tests.

- [ ] **5. Automated Integration Tests**

  ```bash
  pnpm test
  ```

  Verify all unit and HTTP tests pass against the isolated Miniflare in-memory proxy without database locks or dev-state corruption.

- [ ] **6. Local Development Server**
  ```bash
  pnpm dev
  ```
  Verify the server starts on `http://localhost:8787`, routes return valid responses, and Swagger UI loads at `http://localhost:8787/doc-ui`.
