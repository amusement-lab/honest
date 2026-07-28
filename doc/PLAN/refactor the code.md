# Code Review & Fix Plan

Review of the current codebase state (last two commits: `feat: add user service and user test`, `feat: add note service`).

---

## Bugs

### 1. `createNote` returns a fake status

**File:** `src/modules/note/note.service.ts:44,53`

The note is inserted with `status: 'pending'`, but the returned object hardcodes `status: 'active'`:

```ts
status: 'pending',   // line 44 — what's stored
...
status: 'active',    // line 53 — what's returned
```

The API response misrepresents the actual DB state. The test codifies the bug: `src/modules/note/note.service.test.ts:15` is named _"should create a note with pending status"_ but line 30 asserts `note.status === 'active'` — the name and assertion contradict each other.

**Fix:** Return `r.status` in the service; fix the test assertion to `'pending'`.

### 2. Plaintext passwords

**Files:** `src/modules/user/user.service.ts:42,70`, `src/db/schema.ts:20`

Passwords are inserted/updated as-is, with no hashing. Even for a template, baking plaintext storage in is a pattern that will get copied.

**Decision:** Deferred — not implementing hashing at this time. Revisit when authentication is added.

---

## Design issues

### 3. `NoteCreateSchema` advertises `status`, then silently ignores it

**Files:** `src/modules/note/note.entity.ts:17`, `src/modules/note/note.service.ts:44`

`NoteSchema.omit({ id: true })` leaves `status` in the create schema, but `createNote` always overrides it with `'pending'`. A client can send `status: 'done'` and get silently corrected.

**Fix:** Omit `status` from the create schema (line 17: change `.omit({ id: true })` to `.omit({ id: true, status: true })`).

### 4. Redundant manual parsing in controllers

**Files:** `src/modules/note/note.controller.ts:39,67`, `src/modules/user/user.controller.ts:39,67`

`Schema.parse(await c.req.json())` duplicates what `zod-openapi` already does via the route's `requestSchema`. The `defaultHook` in `app.module.ts` already returns a 400 on validation failure. The manual parse is dead code on the happy path — and if it ever _did_ throw, the `ZodError` would fall into `app.onError` and return a **500** instead of 400.

**Fix:** Use `const body = c.req.valid('json')` — typed and already validated. Replace in all four POST/PUT handlers across both controllers.

### 5. `console.error(err.cause)` logs nothing useful

**File:** `src/modules/app.module.ts:39`

`err.cause` is usually `undefined`, so 500s get logged as nothing — no stack trace, no error message.

**Fix:** Change to `console.error(err)`.

---

## Minor / cleanup

- **Unused imports:**
  - `Note` in `src/modules/note/note.service.ts:6` — imported but never used as a type annotation
  - `User` in `src/modules/user/user.service.ts:6` — same
  - `beforeAll` in `src/modules/note/note.service.test.ts:1` — imported but never called
  - `userTable` in `src/db/seed.ts:4` — imported but `main()` only uses `notes`
- **`updateUser` (`src/modules/user/user.service.ts:52`)** runs an UPDATE even when `values` is empty (`PUT /user/{id}` with `{}`) — add an early return when `values` has no keys.
- **`updateNote` (`src/modules/note/note.service.ts:58`)** uses `Record<string, unknown>` — use `Partial<typeof notes.$inferInsert>` to restore type safety.
- **Inconsistent zod style:** uses `z.string().uuid()` (deprecated in Zod 4) in both controllers' `IdParamSchema` and `z.string().email()` (deprecated in Zod 4) in `user.entity.ts`. The note entity already uses the Zod 4 top-level APIs (`z.uuid()`, `z.iso.date()`). Migrate all to the Zod 4 top-level forms: `z.uuid()`, `z.email()`.
- **Email uniqueness check-then-act race (`src/modules/user/user.service.ts:33,60`):** two concurrent requests can both pass the pre-insert check; the DB unique constraint then throws → 500. Idiomatic fix: skip the pre-check, catch PG error `23505`, map to 400/409.
- **Tests are order-dependent:** `createdId` set by the first test is consumed by later tests; the duplicate-email test depends on the first test's user existing. Works with vitest's in-file sequential execution, but brittle — accepted for now, not fixing.
- **`src/db/seed.ts`:** `main()` is a floating promise with no `.catch()`, and the pg connection is never closed (process hangs until timeout).
- **Naming inconsistency:** `notes` vs `userTable` exports in `src/db/schema.ts`. Rename `userTable` to `users` for consistency.

---

## What's good (keep as-is)

- Clean controller/service/entity layering, consistent across modules.
- `CreateRouteUtil` removes OpenAPI boilerplate; standard error responses on every route.
- Services never select/return `password`.
- Separate test database + `docker-compose` setup; error-path tests (404/400) for both services.

---

## Fix plan (batched execution order)

### Batch 1: Status bug

| #   | File                                     | Change                                                                                   |
|-----|------------------------------------------|------------------------------------------------------------------------------------------|
| 1.1 | `src/modules/note/note.service.ts:53`    | Replace `status: 'active'` with `status: r.status` so the API returns what the DB stores |
| 1.2 | `src/modules/note/note.service.test.ts`  | — Change assertion on line 30 from `note.status === 'active'` to `note.status === 'pending'` |
|     |                                          | — Update test name on line 15 (the name already says "pending", so it's now correct)     |

**Verify:** `pnpm test`

---

### Batch 2: Validation fixes (controller double-parse + schema leak)

| #   | File                                          | Change                                                                                                        |
|-----|-----------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| 2.1 | `src/modules/note/note.controller.ts:39,67`   | POST: replace `NoteCreateSchema.parse(await c.req.json())` with `const body = c.req.valid('json')`            |
|     |                                               | PUT: replace `NoteUpdateSchema.parse(await c.req.json())` with `const body = c.req.valid('json')`             |
| 2.2 | `src/modules/user/user.controller.ts:39,67`   | POST: replace `UserCreateSchema.parse(await c.req.json())` with `const body = c.req.valid('json')`            |
|     |                                               | PUT: replace `UserUpdateSchema.parse(await c.req.json())` with `const body = c.req.valid('json')`             |
| 2.3 | `src/modules/note/note.entity.ts:17`          | Change `NoteSchema.omit({ id: true })` to `NoteSchema.omit({ id: true, status: true })`                      |
|     |                                               | This removes `status` from the create schema so clients cannot send it                                        |

After batch 2, remove unused type imports from controller files:
- `src/modules/note/note.controller.ts`: remove `NoteCreate`, `NoteUpdate` from the type-only import (no longer needed after switching to `c.req.valid`)
- `src/modules/user/user.controller.ts`: remove `UserCreate`, `UserUpdate` from the type-only import

**Verify:** `pnpm test`

---

### Batch 3: Error handling + unused imports + empty-update guard

| #   | File                                          | Change                                                                           |
|-----|-----------------------------------------------|----------------------------------------------------------------------------------|
| 3.1 | `src/modules/app.module.ts:39`                | Change `console.error(err.cause)` to `console.error(err)`                        |
| 3.2 | `src/modules/note/note.service.ts:6`          | Remove `Note` from the type import (only `NoteCreate`, `NoteUpdate` are used)    |
| 3.3 | `src/modules/user/user.service.ts:6`          | Remove `User` from the type import (only `UserCreate`, `UserUpdate` are used)    |
| 3.4 | `src/modules/note/note.service.test.ts:1`     | Remove `beforeAll` from the vitest import                                        |
| 3.5 | `src/db/seed.ts:4`                            | Remove `userTable` from the import (only `notes` is used)                        |
| 3.6 | `src/modules/user/user.service.ts:76`         | Add early return before the UPDATE when `Object.keys(values).length === 0`      |
|     |                                               | (after populating `values` from `updatedUser` fields, line ~71)                  |

**Verify:** `pnpm test` + `tsc --noEmit`

---

### Batch 4: Type safety + consistency

| #   | File                                          | Change                                                                                                 |
|-----|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|
| 4.1 | `src/modules/note/note.service.ts:58`         | Replace `Record<string, unknown>` with `Partial<typeof notes.$inferInsert>` in `updateNote`           |
| 4.2 | `src/modules/note/note.controller.ts:21`      | Change `z.string().uuid()` to `z.uuid()` in `IdParamSchema`                                           |
| 4.3 | `src/modules/user/user.controller.ts:21`      | Change `z.string().uuid()` to `z.uuid()` in `IdParamSchema`                                           |
| 4.4 | `src/modules/user/user.entity.ts:10`          | Change `z.string().email()` to `z.email()` in `UserSchema`                                            |
| 4.5 | `src/db/schema.ts:13`                         | Rename `userTable` → `users`                                                                          |
|     | `src/modules/user/user.service.ts:5`          | Update import: `userTable` → `users`                                                                  |
|     | `src/modules/user/user.service.test.ts:6`     | Update import: `userTable` → `users`                                                                  |
|     | `src/db/seed.ts:4`                            | Update import: `userTable` → `users` (already touched in batch 3; apply rename here)                  |

**Verify:** `pnpm test` + `tsc --noEmit`

---

### Batch 5: Robustness (email race condition + seed script)

| #   | File                                          | Change                                                                                                  |
|-----|-----------------------------------------------|---------------------------------------------------------------------------------------------------------|
| 5.1 | `src/modules/user/user.service.ts:33-37`      | In `createUser`: remove the pre-insert email duplicate check (lines 33-37). Catch PG error `23505`      |
|     |                                               | (unique violation) in the `insert` call and throw `HTTPException(400, ...)`                             |
| 5.2 | `src/modules/user/user.service.ts:58-63`      | In `updateUser`: remove the pre-update email duplicate check (lines 58-63). Catch PG error `23505`      |
|     |                                               | in the `update` call and throw `HTTPException(400, ...)`                                                |
| 5.3 | `src/db/seed.ts    `                          | — Wrap `main()` call in `main().catch(console.error)`                                                   |
|     |                                               | — Close the pg connection after `main()` completes (or use `pg` pool drain)                             |

The PG error code `23505` maps to `unique_violation`. Catch it like:

```ts
try {
  const result = await db.insert(userTable).values({ ... }).returning(...)
  return result[0]
} catch (err: unknown) {
  if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
    throw new HTTPException(400, { message: `User with email ${user.email} already exists` })
  }
  throw err
}
```

Apply the same pattern in `updateUser` for the `db.update(...)` call.

**Verify:** `pnpm test` — run twice to confirm no order-dependency or flaky failures.

