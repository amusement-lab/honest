# Code Refactoring — Fix Plan (v2)

---

## Status at a glance

| #   | Issue                                     | Status     |
| --- | ----------------------------------------- | ---------- |
| #1  | Omit `status` from `NoteCreateSchema`     | ✅ Done    |
| #2  | Standardize Zod 4 syntax in `UserSchema`  | ⬜ Pending |
| #3  | Rename `userTable` → `users`              | ⬜ Pending |
| #4  | Guard empty update payloads               | ⬜ Pending |
| #5  | Remove email uniqueness TOCTOU pre-checks | ⬜ Pending |
| #6  | Seed script connection teardown           | ✅ Done    |
| #7  | Mark request bodies `required: true`      | ✅ Done    |

---

## Scope

Fixes for the remaining issues identified across entity schemas, database table naming, update guards, race conditions, and script lifecycle management following the initial modules review.

**Two corrections to the original plan:**

1. **The database is SQLite, not Postgres.** The project uses `better-sqlite3` + `drizzle-orm/better-sqlite3` (see `src/db/index.ts`). So the "Postgres error `23505`" in #5 and the "`pg.Pool`" in #6 do not apply. SQLite equivalents are used below.
2. **The service-level tests no longer exist.** They were replaced by HTTP integration tests in `src/test/`, so every "update the test fixture" step now points at the HTTP tests.

---

## File Index

| File                               | Issues           |
| ---------------------------------- | ---------------- |
| `src/modules/note/note.entity.ts`  | #1 ✅            |
| `src/test/note.http.test.ts`       | #1 ✅, #4, #7 ✅ |
| `src/modules/user/user.entity.ts`  | #2               |
| `src/db/schema.ts`                 | #3               |
| `src/modules/user/user.service.ts` | #3, #4, #5       |
| `src/modules/note/note.service.ts` | #4               |
| `src/db/seed.ts`                   | #3 ✅, #6 ✅     |
| `src/test/helpers/db.ts`           | #3               |
| `src/test/user.http.test.ts`       | #3, #4, #7 ✅    |
| `src/utils/route.util.ts`          | #7 ✅            |

---

## Phase 1 — Schemas & Entity Cleanups

### #1 — Omit `status` from `NoteCreateSchema` & update test fixture ✅ DONE

**Files:** `src/modules/note/note.entity.ts:17`, `src/test/note.http.test.ts:22-34`

**Root cause:** `NoteCreateSchema` used `NoteSchema.omit({ id: true })`, which left `status` in the create schema. However, `NoteService.createNote` always forces `status: 'pending'`, silently overriding any client input. Worse, because `status` was _required_ by the schema, a client that omitted it got a `400` even though the value was ignored anyway.

**Changes:**

- [x] **`src/modules/note/note.entity.ts`** — Omit both `id` and `status` in `NoteCreateSchema`.
- [x] **`src/test/note.http.test.ts`** — The `notePayload()` fixture already omits `status`, so no change was needed. The "force pending" behavior is covered by `should ignore a client-supplied status and force pending`.

```ts
// src/modules/note/note.entity.ts
// Before:
export const NoteCreateSchema = NoteSchema.omit({ id: true }).openapi(
  "CreateNote",
);

// After:
// `status` is omitted because NoteService always forces it to 'pending'.
export const NoteCreateSchema = NoteSchema.omit({
  id: true,
  status: true,
}).openapi("CreateNote");
```

> **Note:** `NoteUpdateSchema` still includes `status` (via `.partial()`), so `PUT /note/{id}` _can_ change the status. That is intentional and covered by the HTTP tests.

---

### #2 — Standardize Zod 4 syntax in `UserSchema`

**File:** `src/modules/user/user.entity.ts:6`

**Root cause:** `UserSchema` uses `z.string().email()`, whereas top-level IDs use `z.uuid()` and `note.entity.ts` uses `z.iso.date()`.

**Changes:**

- [ ] **`src/modules/user/user.entity.ts`** — Migrate to top-level `z.email()`.

```ts
// Before:
email: z.string().email().openapi({ example: 'john@example.com' }),

// After:
email: z.email().openapi({ example: 'john@example.com' }),
```

---

### #3 — Rename `userTable` to `users` and remove unused imports

**Files:** `src/db/schema.ts:18`, `src/modules/user/user.service.ts:5-7`, `src/test/helpers/db.ts:2`, `src/test/user.http.test.ts:5`, `src/db/seed.ts`

**Root cause:** `src/db/schema.ts` exports `notes` (plural table name) alongside `userTable` (singular with `Table` suffix). `user.service.ts` also imports the unused type `User`.

**Changes:**

- [ ] **`src/db/schema.ts`** — Rename export `userTable` to `users`.
- [ ] **`src/modules/user/user.service.ts`** — Update import from `userTable` to `users`; remove unused `User` type import; replace all 20 occurrences of `userTable` with `users`.
- [ ] **`src/test/helpers/db.ts`** — Update import and the `db.delete(userTable)` call.
- [ ] **`src/test/user.http.test.ts`** — Update import and the 3 query sites.
- [x] **`src/db/seed.ts`** — Already done: the file no longer imports `userTable` at all (it only imports `notes`).

```ts
// src/db/schema.ts
// Before:
export const userTable = sqliteTable('users', { ... });

// After:
export const users = sqliteTable('users', { ... });
```

```ts
// src/modules/user/user.service.ts
// Before:
import { userTable } from "../../db/schema.ts";
import type { User, UserCreate, UserUpdate } from "./user.entity.ts";

// After:
import { users } from "../../db/schema.ts";
import type { UserCreate, UserUpdate } from "./user.entity.ts";
```

> **Note:** the original plan wrote `pgTable`. The actual code uses `sqliteTable`, so the rename must keep that call.

---

## Phase 2 — Service Reliability & Error Handling

### #4 — Guard empty update payloads

**Files:** `src/modules/note/note.service.ts:33-42`, `src/modules/user/user.service.ts:79-95`, `src/test/note.http.test.ts`, `src/test/user.http.test.ts`

**Root cause:** If a client sends `PUT` with `{}` (allowed by `.partial()` schemas), `db.update().set({})` throws. Verified against the real SQLite driver:

```
EMPTY SET THREW -> Error | No values to set
```

Because `app.onError` has no branch for this error, the client receives a **`500 Internal Server Error`** instead of a `200` with the unchanged record. Verified end-to-end:

```
create -> 201
PUT {} -> 500 {"message":"Internal Server Error"}
create user -> 201
PUT user {} -> 500 {"message":"Internal Server Error"}
```

**Changes:**

- [ ] **`src/modules/note/note.service.ts`** — Check if `updatedNote` has keys; if empty, return `await this.getNoteById(id)` directly.
- [ ] **`src/modules/user/user.service.ts`** — Check if `values` has keys; if empty, return `await this.getUserById(id)` directly.
- [ ] **`src/test/note.http.test.ts`** — Add a regression test under `PUT /note/{id}` asserting `PUT {}` returns `200` with the unchanged note.
- [ ] **`src/test/user.http.test.ts`** — Add a regression test under `PUT /user/{id}` asserting `PUT {}` returns `200` with the unchanged user.

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
  return await this.getUserById(id);
}
```

---

### #5 — Eliminate email uniqueness TOCTOU race (SQLite constraint error)

**File:** `src/modules/user/user.service.ts:33-95`

**Root cause:** Pre-insert and pre-update `SELECT` queries for email duplicates do not prevent race conditions between concurrent requests. Catching the database's unique-constraint error at the driver level ensures atomic uniqueness enforcement and eliminates redundant `SELECT` round-trips.

**Correction:** the original plan targeted Postgres error `23505`. This project runs **SQLite** (`better-sqlite3`), where the equivalent is a `SqliteError` whose `code` is `SQLITE_CONSTRAINT_UNIQUE` and whose message contains `UNIQUE constraint failed: users.email`.

**Current state:** the code already catches the SQLite error in both `createUser` and `updateUser`, but it _also_ still runs the redundant pre-checks. So the race is already closed — the remaining work is deleting the dead pre-checks.

**Changes:**

- [ ] **`src/modules/user/user.service.ts`** — In `createUser`, remove the pre-select duplicate check (lines 34-38); keep the existing `try/catch`.
- [ ] **`src/modules/user/user.service.ts`** — In `updateUser`, remove the pre-select existence check and the duplicate-email check (lines 66-77); keep the existing `try/catch`.
- [ ] **`src/modules/user/user.service.ts`** — In `updateUser`, add the empty-payload guard from #4 _before_ the `try` block.
- [ ] **`src/modules/user/user.service.ts`** — In `updateUser`, add the `404` check after the update, since removing the pre-select means `result.length === 0` is now the only signal that the row is missing.

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
  // ...insert with try/catch...
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
    if (isUniqueViolation(err)) {
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

  // #4 — empty payload: return the current row instead of throwing "No values to set".
  if (Object.keys(values).length === 0) {
    return await this.getUserById(id)
  }

  try {
    const result = await db.update(users).set(values).where(eq(users.id, id)).returning({
      id: users.id,
      username: users.username,
      email: users.email,
    })

    // No pre-select anymore, so this is the only 404 signal.
    if (result.length === 0) throw new HTTPException(
      404,
      { message: `User with id ${id} is not found` }
    )

    return result[0]
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new HTTPException(400, { message: `User with email ${updatedUser.email} already exists` })
    }
    throw err
  }
}
```

**Suggested helper** (avoids repeating the two-condition check in both methods):

```ts
// src/modules/user/user.service.ts
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Error && err.message.includes("UNIQUE constraint failed"))
    return true;
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}
```

> **Behavior change to watch:** `PUT /user/{id}` with an unknown id and an empty body will now return `404` (from `getUserById`) instead of `500`. That is the desired outcome, but the existing test `should return 404 when the user does not exist` sends a non-empty body, so add a case for the empty-body variant.

---

## Phase 3 — Database & Script Lifecycle

### #6 — Seed script connection teardown ✅ DONE

**File:** `src/db/seed.ts:1-42`

**Root cause:** The original plan assumed a Postgres pool. In reality the script imports the shared `db` and `client` from `src/db/index.ts`, where `client` is a `better-sqlite3` handle. That handle keeps the process alive, and `main()` was called as an unhandled promise.

**Changes:**

- [x] **`src/db/seed.ts`** — Import `client` alongside `db`, and close it in a `.finally()` block. `main()` is now handled with `.catch(console.error)`.

```ts
// src/db/seed.ts
// Before:
import { db } from './index.ts';
...
main();

// After:
import { db, client } from './index.ts';
...
main()
  .catch(console.error)
  .finally(() => {
    client.close();
  });
```

> **Note:** `client.close()` is synchronous for `better-sqlite3`, so no `await` is needed. The original plan's `pg.Pool` / `pool.end()` approach does not apply here.

---

## Phase 4 — Request Validation (added during HTTP test work)

### #7 — Mark request bodies `required: true` ✅ DONE

**Files:** `src/utils/route.util.ts:18-27,169`, `src/test/note.http.test.ts`, `src/test/user.http.test.ts`

**Root cause:** `createRouteUtil` built the body config without a `required` flag. `@hono/zod-openapi` treats a body as optional when that flag is absent, and its optional-body middleware **skips validation entirely** when the request has no `Content-Type` header, injecting `{}` as the "validated" body. The handler then passed `{}` straight to the database.

**Symptom:** `POST /note` and `POST /user` with no body and no `Content-Type` returned **`500 Internal Server Error`** instead of `400`. Verified:

```
POST /note no body, no content-type
  -> 500 {"message":"Internal Server Error"}
"error":"NOT NULL constraint failed: notes.date"
```

**Changes:**

- [x] **`src/utils/route.util.ts`** — Add `required: true` to the generated body config and document why it must stay.
- [x] **`src/test/note.http.test.ts`** — Add `should return 400 when there is no body and no Content-Type header`.
- [x] **`src/test/user.http.test.ts`** — Add the same regression test.

```ts
// src/utils/route.util.ts
...(option.requestSchema && {
  body: {
    // Always required: without this, zod-openapi skips validation when the
    // request has no Content-Type header and the handler receives `{}`.
    required: true,
    content: {
      "application/json": { schema: option.requestSchema },
    },
  },
}),
```

**Verified result:**

| Request                          | Before  | After  |
| -------------------------------- | ------- | ------ |
| `POST /note`, no body, no header | `500`   | `400`  |
| `POST /user`, no body, no header | `500`   | `400`  |
| OpenAPI `requestBody.required`   | `false` | `true` |

---

## Execution Order

| Step | Issue | Files                                                                                                          | Depends on        | Status     |
| ---- | ----- | -------------------------------------------------------------------------------------------------------------- | ----------------- | ---------- |
| 1    | #1    | `src/modules/note/note.entity.ts`                                                                              | —                 | ✅ Done    |
| 2    | #7    | `src/utils/route.util.ts`, `src/test/*.http.test.ts`                                                           | —                 | ✅ Done    |
| 3    | #6    | `src/db/seed.ts`                                                                                               | —                 | ✅ Done    |
| 4    | #2    | `src/modules/user/user.entity.ts`                                                                              | —                 | ⬜ Pending |
| 5    | #3    | `src/db/schema.ts`, `src/modules/user/user.service.ts`, `src/test/helpers/db.ts`, `src/test/user.http.test.ts` | —                 | ⬜ Pending |
| 6    | #4    | `src/modules/note/note.service.ts`, `src/modules/user/user.service.ts`, `src/test/*.http.test.ts`              | #3 (table naming) | ⬜ Pending |
| 7    | #5    | `src/modules/user/user.service.ts`                                                                             | #3, #4            | ⬜ Pending |

---

## Verification Checklist

Run after each step:

```bash
npx tsc --noEmit     # typecheck
pnpm test            # 52 tests currently passing
```

Current baseline: **52 tests passing**, typecheck clean.

---
