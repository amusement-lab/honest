# Migration Plan: PostgreSQL → SQLite

---

## Scope

Migrate the database layer from PostgreSQL (`node-postgres` / `pg`) to SQLite using `better-sqlite3` and `drizzle-orm/better-sqlite3`. The application remains on Node.js using `@hono/node-server`, but eliminates external Docker container dependencies (`docker-compose.yml`) in favor of an embedded, zero-configuration local database.

---

## File Index

| File                               | Issues / Changes |
| ---------------------------------- | ---------------- |
| `package.json`                     | #1               |
| `drizzle.config.ts`                | #2               |
| `.env` & `.env.example`            | #3               |
| `.gitignore`                       | #4               |
| `src/db/schema.ts`                 | #5               |
| `src/db/index.ts`                  | #6               |
| `src/db/seed.ts`                   | #7               |
| `src/modules/app.module.ts`        | #8               |
| `src/modules/user/user.service.ts` | #9               |
| `src/db/vitest-global-setup.ts`    | #10              |
| `vitest.config.ts`                 | #11              |
| `drizzle/` migrations              | #12              |
| `docker-compose.yml`               | #13              |

---

## Phase 1 — Configuration & Dependencies

### #1 — Update dependencies and npm scripts

**Files:** `package.json`

**Context:**
PostgreSQL drivers (`pg`, `@types/pg`) are no longer required. We install `better-sqlite3` (the fastest, production-ready, synchronous SQLite driver for Node.js) and its TypeScript definitions `@types/better-sqlite3`. We also expand npm scripts with standard Drizzle database lifecycle commands (`db:generate`, `db:push`, `db:migrate`, `db:seed`, `db:studio`).

**Changes:**

- [ ] **`package.json`** — Remove `pg` from `dependencies` and `@types/pg` from `devDependencies`.
- [ ] **`package.json`** — Add `better-sqlite3` to `dependencies` and `@types/better-sqlite3` to `devDependencies`.
- [ ] **`package.json`** — Add database migration, push, seed, and studio scripts.

```json
// package.json
// Dependencies to remove:
//   "dependencies": {
//     "pg": "^8.23.0"
//   },
//   "devDependencies": {
//     "@types/pg": "^8.23.1"
//   }

// After:
{
  "name": "hono-template",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx watch src/index.ts",
    "ncu": "ncu",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx src/db/seed.ts",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@hono/node-server": "^2.1.1",
    "@hono/swagger-ui": "^0.6.1",
    "@hono/zod-openapi": "^1.6.1",
    "@noble/hashes": "^2.3.0",
    "better-sqlite3": "^11.8.1",
    "dotenv": "^17.4.2",
    "drizzle-orm": "^0.45.2",
    "hono": "^4.13.5",
    "zod": "4.5.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^26.4.0",
    "drizzle-kit": "^0.31.10",
    "npm-check-updates": "^23.1.0",
    "tsx": "^4.23.12",
    "typescript": "^7.0.2",
    "vitest": "^4.1.11"
  }
}
```

```bash
pnpm remove pg @types/pg
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

---

### #2 — Update Drizzle Kit dialect for SQLite

**Files:** `drizzle.config.ts`

**Context:**
Drizzle Kit must target the `sqlite` dialect instead of `postgresql` and point its connection credentials to a local SQLite database file path.

**Changes:**

- [ ] **`drizzle.config.ts`** — Change `dialect` from `postgresql` to `sqlite`.
- [ ] **`drizzle.config.ts`** — Update `dbCredentials.url` to use `process.env.DATABASE_URL ?? './sqlite.db'`.

```ts
// drizzle.config.ts
// Before:
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

// After:
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./sqlite.db",
  },
});
```

---

### #3 — Update environment variables for SQLite

**Files:** `.env`, `.env.example`

**Context:**
PostgreSQL connection strings (`postgres://...`) and container environment variables (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) are obsolete. SQLite needs only file paths for the main database and the test database.

**Changes:**

- [ ] **`.env` / `.env.example`** — Remove PostgreSQL user, password, and port configurations.
- [ ] **`.env` / `.env.example`** — Add `DATABASE_URL` and `DATABASE_URL_TEST` pointing to local SQLite files.

```env
# .env.example & .env
# Before:
POSTGRES_USER=honest
POSTGRES_PASSWORD=honestGood
POSTGRES_DB=honestDB

POSTGRES_USER_TEST=honestTest
POSTGRES_PASSWORD_TEST=honestGoodTest
POSTGRES_DB_TEST=honestDBTest

DATABASE_URL=postgres://honest:honestGood@localhost:5432/honestDB
DATABASE_URL_TEST=postgres://honestTest:honestGoodTest@localhost:5433/honestDBTest

# After:
DATABASE_URL=./sqlite.db
DATABASE_URL_TEST=./sqlite.test.db
```

---

### #4 — Ignore SQLite database files in Git

**Files:** `.gitignore`

**Context:**
SQLite stores data in single files alongside journal/WAL files (`.db`, `.db-journal`, `.db-wal`, `.db-shm`). These runtime artifacts must not be checked into version control.

**Changes:**

- [ ] **`.gitignore`** — Add patterns for SQLite database files and temporary lock/journal files.

```gitignore
# .gitignore
# Add to file:
*.db
*.db-journal
*.db-wal
*.db-shm
```

---

## Phase 2 — Database Schema & Connection

### #5 — Migrate database schema to `drizzle-orm/sqlite-core`

**Files:** `src/db/schema.ts`

**Context:**
PostgreSQL types (`pgTable`, `uuid`, `varchar`, `date`) must be converted to SQLite types (`sqliteTable`, `text`, `integer`).

- `uuid` with `.defaultRandom()` becomes `text` with `.$defaultFn(() => crypto.randomUUID())` using Node.js built-in Web Crypto.
- `date` becomes `text` (storing ISO date strings `YYYY-MM-DD`, perfectly matching `z.iso.date()` in entity schemas).
- `varchar` becomes `text`.
- `integer` columns (`amount`, `price`, `totalPrice`) map directly to SQLite `integer`.
- SQLite 3.35.0+ natively supports `RETURNING` clauses, preserving existing `.returning()` Drizzle calls without query rewrites.

**Changes:**

- [ ] **`src/db/schema.ts`** — Replace `drizzle-orm/pg-core` imports with `drizzle-orm/sqlite-core`.
- [ ] **`src/db/schema.ts`** — Convert `notes` table definition to `sqliteTable`.
- [ ] **`src/db/schema.ts`** — Convert `userTable` definition to `sqliteTable`.

```ts
// src/db/schema.ts
// Before:
import { pgTable, uuid, date, varchar, integer } from "drizzle-orm/pg-core";

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull(),
  vendor: varchar("vendor").notNull(),
  name: varchar("name").notNull(),
  amount: integer("amount").notNull(),
  unit: varchar("unit").notNull(),
  price: integer("price").notNull(),
  category: varchar("category").notNull(),
  totalPrice: integer("total_price").notNull(),
  status: varchar("status").notNull().default("pending"),
});

export const userTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
});

// After:
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

### #6 — Initialize SQLite database client with `better-sqlite3`

**Files:** `src/db/index.ts`

**Context:**
Replace `drizzle-orm/node-postgres` with `drizzle-orm/better-sqlite3`. Instantiates `better-sqlite3` database instance pointing to `DATABASE_URL` (or `DATABASE_URL_TEST` in test environment). Enables Write-Ahead Logging (`WAL` mode) for fast concurrent read/write operations in production/dev. Export both `db` and the raw `client` for teardown / connection management.

**Changes:**

- [ ] **`src/db/index.ts`** — Remove `drizzle-orm/node-postgres` import.
- [ ] **`src/db/index.ts`** — Import `Database` from `better-sqlite3` and `drizzle` from `drizzle-orm/better-sqlite3`.
- [ ] **`src/db/index.ts`** — Initialize `client` with `WAL` pragma and export `db` and `client`.

```ts
// src/db/index.ts
// Before:
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema.ts";

const isTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";

export const db = drizzle(
  isTest ? process.env.DATABASE_URL_TEST! : process.env.DATABASE_URL!,
  { schema },
);

// After:
import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.ts";

const isTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
const dbPath = isTest
  ? (process.env.DATABASE_URL_TEST ?? "./sqlite.test.db")
  : (process.env.DATABASE_URL ?? "./sqlite.db");

export const client = new Database(dbPath);

// Enable Write-Ahead Logging for high concurrency
if (!isTest) {
  client.pragma("journal_mode = WAL");
}

export const db = drizzle(client, { schema });
```

---

## Phase 3 — Scripts, Error Handling & Services

### #7 — Update seed script for SQLite lifecycle

**Files:** `src/db/seed.ts`

**Context:**
`src/db/seed.ts` creates its own standalone `drizzle(process.env.DATABASE_URL!)` connection using PostgreSQL. Update it to use `better-sqlite3` and ensure the database connection is explicitly closed when the script finishes.

**Changes:**

- [ ] **`src/db/seed.ts`** — Replace PostgreSQL connection with imported `db` and `client` from `src/db/index.ts`.
- [ ] **`src/db/seed.ts`** — Ensure `client.close()` is called in `.finally()`.

```ts
// src/db/seed.ts
// Before:
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { notes, userTable } from "./schema.ts";

const db = drizzle(process.env.DATABASE_URL!);

async function main() {
  const note: typeof notes.$inferInsert = {
    date: "2024-01-01",
    vendor: "Test Vendor",
    name: "Test Note",
    amount: 10,
    unit: "pcs",
    price: 1000,
    category: "Test",
    totalPrice: 10000,
    status: "pending",
  };

  await db.insert(notes).values(note);
  console.log("New note created!");

  const allNotes = await db.select().from(notes);
  console.log("Getting all notes from the database: ", allNotes);

  await db
    .update(notes)
    .set({ status: "done" })
    .where(eq(notes.id, allNotes[0].id!));
  console.log("Note updated!");

  await db.delete(notes).where(eq(notes.id, allNotes[0].id!));
  console.log("Note deleted!");
}

main();

// After:
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, client } from "./index.ts";
import { notes } from "./schema.ts";

async function main() {
  const note: typeof notes.$inferInsert = {
    date: "2024-01-01",
    vendor: "Test Vendor",
    name: "Test Note",
    amount: 10,
    unit: "pcs",
    price: 1000,
    category: "Test",
    totalPrice: 10000,
    status: "pending",
  };

  await db.insert(notes).values(note);
  console.log("New note created!");

  const allNotes = await db.select().from(notes);
  console.log("Getting all notes from the database: ", allNotes);

  if (allNotes.length > 0 && allNotes[0].id) {
    await db
      .update(notes)
      .set({ status: "done" })
      .where(eq(notes.id, allNotes[0].id));
    console.log("Note updated!");

    await db.delete(notes).where(eq(notes.id, allNotes[0].id));
    console.log("Note deleted!");
  }
}

main()
  .catch(console.error)
  .finally(() => {
    client.close();
  });
```

---

### #8 — Handle SQLite constraint violations in global error handler

**Files:** `src/modules/app.module.ts`

**Context:**
`src/modules/app.module.ts` has commented stubs for PostgreSQL error codes (`23505` for unique violations and `23503` for foreign key violations). `better-sqlite3` throws `SqliteError` with error codes `SQLITE_CONSTRAINT_UNIQUE` / `SQLITE_CONSTRAINT_PRIMARYKEY` and message `"UNIQUE constraint failed: ..."`. Update the error handler to recognize SQLite constraint errors and map them to clean HTTP status codes (409 Conflict / 400 Bad Request).

**Changes:**

- [ ] **`src/modules/app.module.ts`** — Replace PostgreSQL error code stubs with SQLite constraint violation checks.

```ts
// src/modules/app.module.ts
// Before:
/* Future: Drizzle/Postgres constraint violations
  if (err instanceof PostgresError) {
    if (err.code === "23505") return c.json({ message: "Resource already exists" }, 409);
    if (err.code === "23503") return c.json({ message: "Referenced resource not found" }, 400);
    return c.json({ message: "Database error" }, 500);
  }
  */

// After:
// SQLite constraint violations (thrown by better-sqlite3)
if (
  err instanceof Error &&
  ("code" in err || err.message.includes("UNIQUE constraint failed"))
) {
  const errorWithCode = err as Error & { code?: string };
  if (
    errorWithCode.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    errorWithCode.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    err.message.includes("UNIQUE constraint failed")
  ) {
    return c.json({ message: "Resource already exists" }, 409);
  }
  if (
    errorWithCode.code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
    err.message.includes("FOREIGN KEY constraint failed")
  ) {
    return c.json({ message: "Referenced resource not found" }, 400);
  }
}
```

---

### #9 — Update User Service duplicate error handling for SQLite

**Files:** `src/modules/user/user.service.ts`

**Context:**
`UserService` handles email uniqueness via pre-check `SELECT` queries. If concurrent requests bypass the check or if driver-level constraint catches are implemented, the exception thrown is an SQLite error (`SQLITE_CONSTRAINT_UNIQUE` or `"UNIQUE constraint failed"`), not Postgres error `23505`.

**Changes:**

- [ ] **`src/modules/user/user.service.ts`** — Ensure `createUser` and `updateUser` safely handle SQLite unique constraint violations.

```ts
// src/modules/user/user.service.ts
// When catching database-level constraint exceptions:
try {
  const result = await db.insert(userTable).values({ ... }).returning({ ... });
  return result[0];
} catch (err: unknown) {
  if (
    (err instanceof Error && err.message.includes('UNIQUE constraint failed')) ||
    (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE')
  ) {
    throw new HTTPException(400, { message: `User with email ${user.email} already exists` });
  }
  throw err;
}
```

---

## Phase 4 — Testing, Cleanups & Migrations

### #10 — Automate SQLite test DB lifecycle in Vitest global setup

**Files:** `src/db/vitest-global-setup.ts`

**Context:**
`src/db/vitest-global-setup.ts` previously ran `npx drizzle-kit push` targeting a PostgreSQL test database container. With SQLite, tests run against a local test database file (`./sqlite.test.db`). We remove any stale test database file before running tests to ensure a clean slate, push the schema via `drizzle-kit push`, and clean up the file in `teardown()`.

**Changes:**

- [ ] **`src/db/vitest-global-setup.ts`** — Delete existing test database file prior to `drizzle-kit push`.
- [ ] **`src/db/vitest-global-setup.ts`** — Export `teardown()` to clean up the test database file after all test suites complete.

```ts
// src/db/vitest-global-setup.ts
// Before:
import "dotenv/config";
import { execSync } from "node:child_process";

export function setup() {
  execSync("npx drizzle-kit push", {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST! },
    stdio: "inherit",
  });
}

// After:
import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";

const testDbPath = process.env.DATABASE_URL_TEST ?? "./sqlite.test.db";

export function setup() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  execSync("npx drizzle-kit push", {
    env: { ...process.env, DATABASE_URL: testDbPath },
    stdio: "inherit",
  });
}

export function teardown() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
}
```

---

### #11 — Update Vitest configuration for SQLite

**Files:** `vitest.config.ts`

**Context:**
Ensure Vitest recognizes `teardown` from `src/db/vitest-global-setup.ts` and runs tests sequentially or in single fork if file-locking on SQLite requires isolation.

**Changes:**

- [ ] **`vitest.config.ts`** — Confirm `globalSetup` points to `./src/db/vitest-global-setup.ts` and file locks do not conflict.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ["./src/db/vitest-global-setup.ts"],
    env: {
      VITEST: "true",
      DATABASE_URL_TEST: "./sqlite.test.db",
    },
  },
});
```

---

### #12 — Re-generate Drizzle migrations for SQLite

**Files:** `drizzle/` directory (`drizzle/0000_wandering_wolfpack.sql`, `drizzle/meta/*`)

**Context:**
Existing SQL migrations in `drizzle/` use PostgreSQL syntax (e.g., `gen_random_uuid()`, `uuid`, `varchar`). They are incompatible with SQLite. The old migrations must be removed and replaced with a fresh initial migration generated by Drizzle Kit targeting SQLite.

**Changes:**

- [ ] **`drizzle/`** — Remove old PostgreSQL migration `0000_wandering_wolfpack.sql` and metadata in `drizzle/meta/`.
- [ ] Run `pnpm run db:generate` to generate a fresh SQLite migration.
- [ ] Run `pnpm run db:push` to apply schema directly to `sqlite.db`.

```bash
# Clean up old Postgres migrations
rm -rf drizzle/0000_wandering_wolfpack.sql drizzle/meta/

# Generate fresh SQLite migration
pnpm run db:generate
```

---

### #13 — Decommission Docker Compose PostgreSQL service

**Files:** `docker-compose.yml`

**Context:**
`docker-compose.yml` runs two PostgreSQL instances (`honest_pg`, `honest_pg_test`) and an Adminer container. Since SQLite is embedded in-process, Docker is no longer required for development or testing. The file can be removed or marked as deprecated.

**Changes:**

- [ ] **`docker-compose.yml`** — Remove or replace with a note documenting that Docker is no longer required for SQLite.

```yaml
# docker-compose.yml (Optional / Deprecated)
# SQLite runs directly on disk; Docker containers for PostgreSQL are no longer needed.
```

---

## Execution Order

| Step | Task                                  | Files                                               | Depends on     |
| ---- | ------------------------------------- | --------------------------------------------------- | -------------- |
| 1    | #1 Update dependencies & scripts      | `package.json`                                      | —              |
| 2    | #2 Configure Drizzle Kit dialect      | `drizzle.config.ts`                                 | Step 1         |
| 3    | #3 Update environment variables       | `.env`, `.env.example`                              | —              |
| 4    | #4 Update Git ignore rules            | `.gitignore`                                        | —              |
| 5    | #5 Migrate schema to `sqlite-core`    | `src/db/schema.ts`                                  | Step 1         |
| 6    | #6 Initialize `better-sqlite3` client | `src/db/index.ts`                                   | Step 1, Step 5 |
| 7    | #7 Update seed script                 | `src/db/seed.ts`                                    | Step 6         |
| 8    | #8 Update global error handling       | `src/modules/app.module.ts`                         | —              |
| 9    | #9 Update user service constraints    | `src/modules/user/user.service.ts`                  | Step 5, Step 6 |
| 10   | #10 & #11 Update test setup & config  | `src/db/vitest-global-setup.ts`, `vitest.config.ts` | Step 2, Step 6 |
| 11   | #12 Generate fresh SQLite migrations  | `drizzle/*`                                         | Step 2, Step 5 |
| 12   | #13 Decommission Docker Compose       | `docker-compose.yml`                                | —              |
| 13   | Verify test suite                     | Run `pnpm test`                                     | All steps      |
