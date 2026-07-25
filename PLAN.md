# Code Review & Fix Plan

Review of the current codebase state (last two commits: `feat: add user service and user test`, `feat: add note service`).

---

## Bugs

### 1. `createNote` returns a fake status

**File:** `src/module/note/note.service.ts:44,53`

The note is inserted with `status: 'pending'`, but the returned object hardcodes `status: 'active'`:

```ts
status: 'pending',   // line 44 — what's stored
...
status: 'active',    // line 53 — what's returned
```

The API response misrepresents the actual DB state. The test codifies the bug: `src/module/note/note.service.test.ts:15` is named *"should create a note with pending status"* but line 30 asserts `note.status === 'active'` — the name and assertion contradict each other.

**Fix:** Return `r.status` in the service; fix the test assertion to `'pending'`.

### 2. Plaintext passwords

**Files:** `src/module/user/user.service.ts:42,70`, `src/db/schema.ts:20`

Passwords are inserted/updated as-is, with no hashing. Even for a template, baking plaintext storage in is a pattern that will get copied.

**Fix:** Hash with `argon2` or `bcryptjs` before insert/update; update tests accordingly. *(Adds a dependency — needs sign-off.)*

---

## Design issues

### 3. `NoteCreateSchema` advertises `status`, then silently ignores it

**Files:** `src/module/note/note.entity.ts:17`, `src/module/note/note.service.ts:44`

`NoteSchema.omit({ id: true })` leaves `status` in the create schema, but `createNote` always overrides it with `'pending'`. A client can send `status: 'done'` and get silently corrected.

**Fix:** Omit `status` from the create schema (or honor the client's value).

### 4. Redundant manual parsing in controllers

**Files:** `src/module/note/note.controller.ts:39,67`, `src/module/user/user.controller.ts:39,67`

`Schema.parse(await c.req.json())` duplicates what `zod-openapi` already does via the route's `requestSchema` (the `defaultHook` returns a 400 on failure). The manual parse is dead code on the happy path — and if it ever *did* throw, the `ZodError` would fall into `app.onError` and return a **500** instead of 400.

**Fix:** Use `const body = c.req.valid('json')` — typed and already validated.

### 5. Dead config in `vitest.config.ts:8`

`DATABASE_URL: process.env.DATABASE_URL_TEST || ''` is evaluated when vitest loads the config — *before* `dotenv/config` (imported in `src/db/index.ts`) has populated `process.env`. So this always sets `DATABASE_URL` to `''`. It is harmless only because `db/index.ts` reads `DATABASE_URL_TEST` directly when `VITEST=true`.

**Fix:** Remove the line.

### 6. `console.error(err.cause)` logs nothing useful

**File:** `src/module/app.module.ts:39`

`err.cause` is usually `undefined`, so 500s get logged as nothing.

**Fix:** Change to `console.error(err)`.

---

## Minor / cleanup

- **Unused imports:**
  - `Note` in `src/module/note/note.service.ts:6`
  - `User` in `src/module/user/user.service.ts:6`
  - `beforeAll` in `src/module/note/note.service.test.ts:1`
  - `userTable` in `src/db/seed.ts:4`
- **`updateUser` (`src/module/user/user.service.ts:52`)** runs an UPDATE even when `values` is empty (`PUT /user/{id}` with `{}`) — add an early return.
- **`updateNote` (`src/module/note/note.service.ts:58`)** uses `Record<string, unknown>` — use `Partial<typeof notes.$inferInsert>` to restore type safety.
- **Inconsistent zod style:** `z.uuid()` / `z.iso.date()` in entities vs deprecated `z.string().uuid()` in both controllers' `IdParamSchema` and `z.string().email()` in `user.entity.ts`. Use the Zod 4 top-level APIs consistently.
- **Email uniqueness check-then-act race (`src/module/user/user.service.ts:33,60`):** two concurrent requests can both pass the check; the DB unique constraint then throws → 500. Idiomatic fix: skip the pre-check, catch PG error `23505`, map to 400/409.
- **Tests are order-dependent:** `createdId` set by the first test is consumed by later tests; the duplicate-email test depends on the first test's user existing. Works with vitest's in-file sequential execution, but brittle — consider `beforeEach` seeding or self-contained tests.
- **`src/db/seed.ts`:** `main()` is a floating promise with no `.catch()`, and the pg connection is never closed (process hangs until timeout).
- **Naming inconsistency:** `notes` vs `userTable` exports in `src/db/schema.ts`.

---

## What's good (keep as-is)

- Clean controller/service/entity layering, consistent across modules.
- `CreateRouteUtil` removes OpenAPI boilerplate; standard error responses on every route.
- Services never select/return `password`.
- Separate test database + `docker-compose` setup; error-path tests (404/400) for both services.

---

## Fix plan (proposed order)

| # | Item | Scope |
|---|------|-------|
| 1 | Fix `createNote` status bug + correct test assertion | `note.service.ts`, `note.service.test.ts` |
| 2 | Replace manual `parse()` with `c.req.valid('json')` | both controllers |
| 3 | Omit `status` from `NoteCreateSchema` | `note.entity.ts` |
| 4 | Fix `console.error(err)`; remove dead `vitest.config.ts` env line | `app.module.ts`, `vitest.config.ts` |
| 5 | Remove unused imports; type `updateNote` values properly | assorted |
| 6 | Hash passwords (argon2/bcryptjs) | `user.service.ts`, tests — **adds a dependency, needs sign-off** |
