# Code Review & Refactor — Fix Plan

---

## Scope

Fixes for issues identified in the codebase review across security, entity schemas, controllers, service reliability, database tables, and utility scripts.

---

## File Index

| File | Issues |
| --- | --- |
| `src/modules/app.module.ts` | ~~#4~~ |
| `src/utils/hash.util.ts` | ~~#2~~ |
| `src/modules/note/note.entity.ts` | #5 |
| `src/modules/note/note.controller.ts` | ~~#3, #6~~ |
| `src/modules/note/note.service.ts` | ~~#1, #11~~, #8 |
| `src/modules/note/note.service.test.ts` | ~~#1~~, #5 |
| `src/modules/user/user.entity.ts` | #6 |
| `src/modules/user/user.controller.ts` | ~~#3, #6~~ |
| `src/modules/user/user.service.ts` | ~~#2~~, #7, #8, #9 |
| `src/modules/user/user.service.test.ts` | #7 |
| `src/db/schema.ts` | #7 |
| `src/db/seed.ts` | #7, #10 |

---

## Phase 1 — Security + Bugs

### ~~#1 — `createNote` returns a fake status~~

**Files:** `src/modules/note/note.service.ts`, `src/modules/note/note.service.test.ts`

**Root cause:** `createNote` inserted `status: 'pending'`, but the returned object hardcoded `status: 'active'`. The test on line 30 asserted `toBe('active')`, conflicting with the test name.

**Changes (completed):**

- [x] **`src/modules/note/note.service.ts`** — Removed hardcoded override; `createNote` returns `result[0]` directly from `returning()`.
- [x] **`src/modules/note/note.service.test.ts`** — Fixed assertion on line 31 from `toBe('active')` to `toBe('pending')`.

---

### ~~#2 — Plaintext passwords~~

**Files:** `src/modules/user/user.service.ts`, `src/utils/hash.util.ts`

**Root cause:** Passwords were stored and updated in plaintext without cryptographic hashing.

**Changes (completed):**

- [x] **`src/utils/hash.util.ts`** — Implemented Scrypt password hashing via `@noble/hashes` (`hashPassword` with 16-byte salt and constant-time `verifyPassword`).
- [x] **`src/modules/user/user.service.ts`** — `createUser` hashes password on insert with `await hashPassword(user.password)`; `updateUser` hashes password if provided in update payload.

---

## Phase 2 — Validation & Controllers

### ~~#3 — Eliminate redundant manual parsing in controllers~~

**Files:** `src/modules/note/note.controller.ts`, `src/modules/user/user.controller.ts`

**Root cause:** Handlers called `Schema.parse(await c.req.json())`, duplicating what `@hono/zod-openapi` already performs via `requestSchema`.

**Changes (completed):**

- [x] **`src/modules/note/note.controller.ts`** — Switched POST and PUT handlers to `c.req.valid('json')` and `c.req.valid('param')`.
- [x] **`src/modules/user/user.controller.ts`** — Switched POST and PUT handlers to `c.req.valid('json')` and `c.req.valid('param')`.

```ts
// Before:
const body = NoteCreateSchema.parse(await c.req.json());
const note: Note = await NoteService.createNote(body);

// After:
const body = c.req.valid('json');
const note: Note = await NoteService.createNote(body);
```

---

### ~~#4 — Fix error logger `err.cause`~~

**File:** `src/modules/app.module.ts:33-40`

**Root cause:** `err.cause` was usually `undefined`, resulting in uninformative 500 logs without stack traces or context.

**Changes (completed):**

- [x] **`src/modules/app.module.ts`** — Replaced `console.error(err.cause)` with structured JSON logging (`{ error, stack, method, url }`).

```ts
// Before:
if (err instanceof Error) {
  console.error(err.cause);
  return c.json({ message: err.message }, 500);
}

// After:
console.error(
  JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    method: c.req.method,
    url: c.req.url,
  }),
);
```

---

### #5 — Omit `status` from `NoteCreateSchema` & update test fixture

**Files:** `src/modules/note/note.entity.ts:17`, `src/modules/note/note.service.test.ts:26`

**Root cause:** `NoteCreateSchema` uses `NoteSchema.omit({ id: true })`, which leaves `status` in the schema. However, `NoteService.createNote` always forces `status: 'pending'`, silently overriding any client input.

**Changes:**

- [ ] **`src/modules/note/note.entity.ts`** — Omit both `id` and `status` in `NoteCreateSchema`.
- [ ] **`src/modules/note/note.service.test.ts`** — Remove `status: 'pending'` from test input to match updated `NoteCreate` type.

```ts
// src/modules/note/note.entity.ts
// Before:
export const NoteCreateSchema = NoteSchema.omit({ id: true }).openapi('CreateNote')

// After:
export const NoteCreateSchema = NoteSchema.omit({ id: true, status: true }).openapi('CreateNote')
```

```ts
// src/modules/note/note.service.test.ts
// Before:
const note = await NoteService.createNote({
  date: '2024-01-01',
  vendor: 'Test Vendor',
  name: 'Test Note',
  amount: 10,
  unit: 'pcs',
  price: 1000,
  category: 'Test',
  totalPrice: 10000,
  status: 'pending',
})

// After:
const note = await NoteService.createNote({
  date: '2024-01-01',
  vendor: 'Test Vendor',
  name: 'Test Note',
  amount: 10,
  unit: 'pcs',
  price: 1000,
  category: 'Test',
  totalPrice: 10000,
})
```

---

### #6 — Standardize Zod 4 syntax (`z.uuid()`, `z.email()`)

**Files:** `src/modules/user/user.entity.ts:6`, `src/utils/route.util.ts:8`, `src/modules/note/note.entity.ts:4`

**Root cause:** Mixed legacy Zod syntax (`z.string().uuid()`, `z.string().email()`) with Zod 4 top-level helpers.

**Changes:**

- [x] **`src/utils/route.util.ts`** — Converted `IdParamSchema` to `z.uuid()`.
- [x] **`src/modules/note/note.entity.ts`** — Uses `z.uuid()` and `z.iso.date()`.
- [x] **`src/modules/user/user.entity.ts`** — Converted `id` to `z.uuid()`.
- [ ] **`src/modules/user/user.entity.ts:6`** — Migrate `email` from `z.string().email()` to `z.email()`.

```ts
// src/modules/user/user.entity.ts
// Before:
email: z.string().email().openapi({ example: 'john@example.com' }),

// After:
email: z.email().openapi({ example: 'john@example.com' }),
```

---

## Phase 3 — Service Robustness & Database

### #7 — Rename `userTable` to `users` and remove unused imports

**Files:** `src/db/schema.ts:16`, `src/modules/user/user.service.ts:5-7`, `src/modules/user/user.service.test.ts:7`, `src/db/seed.ts:4`

**Root cause:** `src/db/schema.ts` exports `notes` (plural table name) alongside `userTable` (singular with `Table` suffix). `user.service.ts` also imports unused type `User`.

**Changes:**

- [ ] **`src/db/schema.ts`** — Rename export `userTable` to `users`.
- [ ] **`src/modules/user/user.service.ts`** — Update import from `userTable` to `users`; remove unused `User` type import; replace all occurrences of `userTable` with `users`.
- [ ] **`src/modules/user/user.service.test.ts`** — Update import from `userTable` to `users`; replace occurrences in table cleanup / queries.
- [ ] **`src/db/seed.ts`** — Remove unused `userTable` import.

```ts
// src/db/schema.ts
// Before:
export const userTable = pgTable("users", { ... });

// After:
export const users = pgTable("users", { ... });
```

```ts
// src/modules/user/user.service.ts
// Before:
import { userTable } from '../../db/schema.ts'
import type { User, UserCreate, UserUpdate } from './user.entity.ts'

// After:
import { users } from '../../db/schema.ts'
import type { UserCreate, UserUpdate } from './user.entity.ts'
```

---

### #8 — Guard empty update payloads

**Files:** `src/modules/note/note.service.ts:33-42`, `src/modules/user/user.service.ts:55-82`

**Root cause:** If a client sends `PUT` with `{}` (allowed by `.partial()` schemas), `db.update().set({})` generates invalid SQL (`UPDATE ... SET WHERE id = ...`), triggering a database error.

**Changes:**

- [ ] **`src/modules/note/note.service.ts`** — Check if `updatedNote` has keys; if empty, return `await this.getNoteById(id)` directly.
- [ ] **`src/modules/user/user.service.ts`** — Check if `values` has keys; if empty, return `await this.getUserById(id)` directly.

```ts
// src/modules/note/note.service.ts
// Before:
static async updateNote(id: string, updatedNote: NoteUpdate) {
  const result = await db.update(notes).set(updatedNote).where(eq(notes.id, id)).returning()

  if (result.length === 0) throw new HTTPException(
    404,
    { message: `Note with id ${id} is not found` }
  )

  return result[0]
}

// After:
static async updateNote(id: string, updatedNote: NoteUpdate) {
  if (Object.keys(updatedNote).length === 0) {
    return await this.getNoteById(id)
  }

  const result = await db.update(notes).set(updatedNote).where(eq(notes.id, id)).returning()

  if (result.length === 0) throw new HTTPException(
    404,
    { message: `Note with id ${id} is not found` }
  )

  return result[0]
}
```

```ts
// src/modules/user/user.service.ts (inside updateUser)
// After constructing values:
if (Object.keys(values).length === 0) {
  return await this.getUserById(id)
}
```

---

### #9 — Eliminate email uniqueness TOCTOU race (Postgres error 23505)

**File:** `src/modules/user/user.service.ts:33-82`

**Root cause:** Pre-insert and pre-update `SELECT` queries for email duplicates do not prevent race conditions between concurrent requests. Catching Postgres error `23505` (`unique_violation`) at the database driver level ensures atomic uniqueness enforcement and eliminates redundant `SELECT` round-trips.

**Changes:**

- [ ] **`src/modules/user/user.service.ts`** — In `createUser`, remove the pre-select check; catch error code `23505` on insert and throw `HTTPException(400)`.
- [ ] **`src/modules/user/user.service.ts`** — In `updateUser`, remove the pre-select duplicate check; catch error code `23505` on update and throw `HTTPException(400)`.

```ts
// src/modules/user/user.service.ts — createUser
// Before:
static async createUser(user: UserCreate) {
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

// After:
static async createUser(user: UserCreate) {
  const hashedPassword = await hashPassword(user.password)

  try {
    const result = await db.insert(users).values({
      username: user.username,
      email: user.email,
      password: hashedPassword,
    }).returning({
      id: users.id,
      username: users.username,
      email: users.email,
    })

    return result[0]
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw new HTTPException(400, { message: `User with email ${user.email} already exists` })
    }
    throw err
  }
}
```

```ts
// src/modules/user/user.service.ts — updateUser
// After:
static async updateUser(id: string, updatedUser: UserUpdate) {
  const values: Partial<typeof users.$inferInsert> = {}
  if (updatedUser.username !== undefined) values.username = updatedUser.username
  if (updatedUser.email !== undefined) values.email = updatedUser.email
  if (updatedUser.password !== undefined) values.password = await hashPassword(updatedUser.password)

  if (Object.keys(values).length === 0) {
    return await this.getUserById(id)
  }

  try {
    const result = await db.update(users).set(values).where(eq(users.id, id)).returning({
      id: users.id,
      username: users.username,
      email: users.email,
    })

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `User with id ${id} is not found` }
    )

    return result[0]
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw new HTTPException(400, { message: `User with email ${updatedUser.email} already exists` })
    }
    throw err
  }
}
```

---

### ~~#11 — Fix type safety in `updateNote`~~

**File:** `src/modules/note/note.service.ts:33`

**Changes (completed):**

- [x] **`src/modules/note/note.service.ts`** — `updateNote` signature accepts `updatedNote: NoteUpdate` directly without `Record<string, unknown>`.

---

### #10 — Seed script connection teardown

**File:** `src/db/seed.ts:1-38`

**Root cause:** Running `drizzle(process.env.DATABASE_URL!)` creates an internal pool that stays open after `main()` completes, hanging process exit. `main()` is also called as an unhandled promise.

**Changes:**

- [ ] **`src/db/seed.ts`** — Instantiate a `pg.Pool`, pass into `drizzle(pool)`, and ensure `pool.end()` is invoked in a `.finally()` block.

```ts
// src/db/seed.ts
// Before:
const db = drizzle(process.env.DATABASE_URL!);
...
main();

// After:
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const db = drizzle(pool);

async function main() {
  // seed operations...
}

main()
  .catch(console.error)
  .finally(async () => {
    await pool.end();
  });
```

---

## Execution Order

| Step | Issue | Files | Depends on |
| --- | --- | --- | --- |
| 1 | ~~#2~~ | `src/modules/user/user.service.ts`, `src/utils/hash.util.ts` | — |
| 2 | ~~#1~~ | `src/modules/note/note.service.ts`, `src/modules/note/note.service.test.ts` | — |
| 3 | ~~#4~~ | `src/modules/app.module.ts` | — |
| 4 | ~~#3~~ | `src/modules/note/note.controller.ts`, `src/modules/user/user.controller.ts` | — |
| 5 | ~~#11~~ | `src/modules/note/note.service.ts` | — |
| 6 | #5 | `src/modules/note/note.entity.ts`, `src/modules/note/note.service.test.ts` | — |
| 7 | #6 | `src/modules/user/user.entity.ts` | — |
| 8 | #7 | `src/db/schema.ts`, `src/modules/user/user.service.ts`, `src/modules/user/user.service.test.ts`, `src/db/seed.ts` | — |
| 9 | #8 | `src/modules/note/note.service.ts`, `src/modules/user/user.service.ts` | #7 (table naming) |
| 10 | #9 | `src/modules/user/user.service.ts` | #7, #8 |
| 11 | #10 | `src/db/seed.ts` | #7 |

---
