# Modules Review — Fix Plan

---

## Scope

Fixes for 11 issues identified in `src/modules/` review.

---

## File Index

| File                                      | Issues              |
| ----------------------------------------- | ------------------- |
| `src/modules/app.module.ts`               | #6                  |
| `src/modules/common/common.controller.ts` | #11                 |
| `src/modules/note/note.entity.ts`         | #1                  |
| `src/modules/note/note.service.ts`        | ~~#1, #7, #8~~, #10 |
| `src/modules/note/note.controller.ts`     | #2, #3, #9, #10     |
| `src/modules/note/note.service.test.ts`   | ~~#1~~, #4, #10     |
| `src/modules/user/user.service.ts`        | #5, #10             |
| `src/modules/user/user.controller.ts`     | #2, #3, #9, #10     |
| `src/modules/user/user.service.test.ts`   | #10                 |

---

## Phase 1 — Security + Bugs

### #5 — Hash passwords

**Files:** `src/modules/user/user.service.ts`, `package.json`

**Install:** `bcrypt` (production) + `@types/bcrypt` (dev), or `@node-rs/bcrypt` for Bun compatibility.

**Changes:**

In `createUser` (`user.service.ts:42`):

```ts
// Before:
password: user.password,

// After:
password: await bcrypt.hash(user.password, 10),
```

In `updateUser` (`user.service.ts:70`):

```ts
// Before:
if (updatedUser.password !== undefined) values.password = updatedUser.password;

// After:
if (updatedUser.password !== undefined)
  values.password = await bcrypt.hash(updatedUser.password, 10);
```

**Verification:** Existing tests still pass (tests don't verify raw password value). Consider a future test that verifies stored password is not plaintext.

---

### ~~#1 — Fix note status silently ignored~~

**Files:** `src/modules/note/note.entity.ts`, `src/modules/note/note.service.ts`, `src/modules/note/note.service.test.ts`

**Root cause:** DB schema defaults `status` to `'pending'` (`schema.ts:13`). `createNote` hardcoded both insert and response to different values, ignoring input.

**Changes (completed):**

- [x] **`note.service.ts`** — Response `status: 'active'` now returns the actual stored value (`return result[0]` directly; no more hardcoded override in the response)
- [x] **`note.service.test.ts:30`** — Test assertion changed from `toBe('active')` to `toBe('pending')`, matching actual behavior
- [x] **`src/db/schema.ts`** — Changed `amount`/`price`/`totalPrice` from `numeric` to `integer`, eliminating the `String()`/`Number()` conversion gap that caused the original confusion around the return shape

---

### #6 — Don't leak error details to client

**File:** `src/modules/app.module.ts:38-41`

```ts
// Before:
if (err instanceof Error) {
  console.error(err.cause);
  return c.json({ message: err.message }, 500);
}

// After:
if (err instanceof Error) {
  console.error(err);
  return c.json({ message: "Internal Server Error" }, 500);
}
```

Note: `console.error(err)` logs the full error (including stack trace) server-side while returning a generic message to the client.

---

## Phase 2 — Code Quality

### ~~#8 — Extract shared numeric conversion helpers~~

**Obsolete.** `src/db/schema.ts` was changed from `numeric` to `integer` for `amount`, `price`, and `totalPrice`. No `String()`/`Number()` conversions exist anywhere in the service anymore, so helper extraction is unnecessary.

---

### ~~#7 — Fix type hole in updateNote~~

**Fixed.** The `Record<string, unknown>` type hole was removed. `updateNote` now passes `updatedNote` (typed as `NoteUpdate`) directly to `db.update().set()`, thanks to the `numeric` → `integer` schema change making the `String()` conversions unnecessary.

---

### #2 — Eliminate double body parsing

**Files:** `src/modules/note/note.controller.ts:39`, `src/modules/user/user.controller.ts:39`

Applies to both POST and PUT routes in both controllers (4 occurrences total).

```ts
// Before:
const body: NoteCreate = NoteCreateSchema.parse(await c.req.json());
const note: Note = await NoteService.createNote(body);

// After:
const body = c.req.valid("json");
const note: Note = await NoteService.createNote(body);
```

---

### #3 — Replace non-null assertions on params

**Files:** `src/modules/note/note.controller.ts:52,66,80`, `src/modules/user/user.controller.ts:52,66,80`

3 occurrences per controller (6 total).

```ts
// Before:
const id = c.req.param("id")!;

// After:
const { id } = c.req.valid("param");
```

---

## Phase 3 — Polish

### #10 — Pluralize method names

**Files:** `src/modules/note/note.service.ts`, `src/modules/note/note.controller.ts`, `src/modules/note/note.service.test.ts`, `src/modules/user/user.service.ts`, `src/modules/user/user.controller.ts`, `src/modules/user/user.service.test.ts`

| File                          | Before                      | After                        |
| ----------------------------- | --------------------------- | ---------------------------- |
| Both services                 | `static async getAllNote()` | `static async getAllNotes()` |
| Both services                 | `static async getAllUser()` | `static async getAllUsers()` |
| Both controllers (line 26)    | `NoteService.getAllNote()`  | `NoteService.getAllNotes()`  |
| Both controllers (line 26)    | `UserService.getAllUser()`  | `UserService.getAllUsers()`  |
| Both test files (line ~38-42) | `NoteService.getAllNote()`  | `NoteService.getAllNotes()`  |
| Both test files (line ~38-42) | `UserService.getAllUser()`  | `UserService.getAllUsers()`  |

---

### #9 — Controller duplication (review only — no action)

Both controllers are 85 lines of near-identical CRUD boilerplate.

**Decision:** Keep as-is for now. At 85 lines the duplication is tolerable and the explicitness is valuable. Revisit if a third module is added.

If extraction is desired later:

```ts
// shared/crud-routes.ts
export function defineCrudRoutes<T>(
  app: OpenAPIHono,
  opts: {
    tag: string;
    listSchema: z.ZodType;
    schema: z.ZodType;
    createSchema: z.ZodType;
    updateSchema: z.ZodType;
    getAll: () => Promise<T[]>;
    getById: (id: string) => Promise<T>;
    create: (body: any) => Promise<T>;
    update: (id: string, body: any) => Promise<T>;
    delete: (id: string) => Promise<T>;
  },
) {
  /* 5 route definitions */
}
```

---

### #4 — Remove unused import

**File:** `src/modules/note/note.service.test.ts:1`

```ts
// Before:
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// After:
import { describe, it, expect, afterAll } from "vitest";
```

---

### #11 — Use OpenAPIHono in common controller

**File:** `src/modules/common/common.controller.ts:1,3`

```ts
// Before:
import { Hono } from "hono";
const app = new Hono();

// After:
import { OpenAPIHono } from "@hono/zod-openapi";
const app = new OpenAPIHono();
```

So the root route appears in OpenAPI docs consistently with the other controllers.

---

## Execution Order

| Step | Issue          | Files                                          | Depends on |
| ---- | -------------- | ---------------------------------------------- | ---------- |
| 1    | Install bcrypt | `package.json`                                 | —          |
| 2    | #5             | `user.service.ts`                              | Step 1     |
| 3    | #6             | `app.module.ts`                                | —          |
| 4    | #2             | both controllers                               | —          |
| 5    | #3             | both controllers                               | —          |
| 6    | #10            | services + controllers + tests (6 files)       | —          |
| 7    | #4 + #11       | `note.service.test.ts`, `common.controller.ts` | —          |

~~#1, #7, #8~~ completed. Steps 1, 3, 4, 5, 6, 7 are independent and can run in parallel.
