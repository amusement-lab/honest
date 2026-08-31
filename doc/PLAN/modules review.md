# Modules Review — Fix Plan

---

## Scope

Fixes for 11 issues identified in `src/modules/` review.

---

## File Index

| File                                      | Issues              |
| ----------------------------------------- | ------------------- |
| `src/modules/app.module.ts`               | ~~#6~~              |
| `src/utils/route.util.ts`                 | ~~#2, #3~~          |
| `src/modules/common/common.controller.ts` | ~~#11~~             |
| `src/modules/note/note.entity.ts`         | ~~#1~~              |
| `src/modules/note/note.service.ts`        | ~~#1, #7, #8, #10~~ |
| `src/modules/note/note.controller.ts`     | ~~#2, #3, #9, #10~~ |
| `src/modules/note/note.service.test.ts`   | ~~#1, #4, #10~~     |
| `src/modules/user/user.service.ts`        | ~~#5, #10~~         |
| `src/modules/user/user.controller.ts`     | ~~#2, #3, #9, #10~~ |
| `src/modules/user/user.service.test.ts`   | ~~#10~~             |

---

## Phase 1 — Security + Bugs

### ~~#5 — Hash passwords~~

**Files:** `src/modules/user/user.service.ts`, `src/utils/hash.util.ts`

**Changes (completed):**

- [x] **`src/utils/hash.util.ts`** — Implemented Scrypt password hashing via `@noble/hashes` (`hashPassword` with 16-byte random salt and constant-time `verifyPassword`).
- [x] **`src/modules/user/user.service.ts`** — `createUser` hashes password on insert with `await hashPassword(user.password)`; `updateUser` hashes password if provided in update payload.

---

### ~~#1 — Fix note status silently ignored~~

**Files:** `src/modules/note/note.entity.ts`, `src/modules/note/note.service.ts`, `src/modules/note/note.service.test.ts`

**Root cause:** DB schema defaults `status` to `'pending'` (`schema.ts:13`). `createNote` hardcoded both insert and response to different values, ignoring input.

**Changes (completed):**

- [x] **`note.service.ts`** — Response `status: 'active'` now returns the actual stored value (`return result[0]` directly; no more hardcoded override in the response)
- [x] **`note.service.test.ts:30`** — Test assertion changed from `toBe('active')` to `toBe('pending')`, matching actual behavior
- [x] **`src/db/schema.ts`** — Changed `amount`/`price`/`totalPrice` from `numeric` to `integer`, eliminating the `String()`/`Number()` conversion gap that caused the original confusion around the return shape

---

### ~~#6 — Don't leak error details to client~~

**File:** `src/modules/app.module.ts:33-59`

```ts
// Before:
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status);
  }

  if (err instanceof Error) {
    console.error(err.cause);
    return c.json({ message: err.message }, 500);
  }

  return c.json({ message: "Internal Server Error" }, 500);
});

// After:
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

  /* Future: Zod validation errors
  if (err instanceof ZodError) {
    return c.json({
      message: err.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", "),
    }, 400);
  }
  */

  /* Future: Drizzle/Postgres constraint violations
  if (err instanceof PostgresError) {
    if (err.code === "23505") return c.json({ message: "Resource already exists" }, 409);
    if (err.code === "23503") return c.json({ message: "Referenced resource not found" }, 400);
    return c.json({ message: "Database error" }, 500);
  }
  */

  return c.json({ message: "Internal Server Error" }, 500);
});
```

- [x] Single structured `JSON.stringify` log — works on Node.js and Cloudflare Workers.
- [x] Each branch customizes its own client message — `HTTPException` returns its message, fallback returns generic `"Internal Server Error"`.
- [x] Comment stubs for future ZodError / PostgresError handlers with per-error-code messages.
- [x] `err.message` + `err.stack` replaces `err.cause` (often `undefined`).
- [x] `c.req.method` + `c.req.url` — request context for tracing.

---

## Phase 2 — Code Quality

### ~~#8 — Extract shared numeric conversion helpers~~

**Obsolete.** `src/db/schema.ts` was changed from `numeric` to `integer` for `amount`, `price`, and `totalPrice`. No `String()`/`Number()` conversions exist anywhere in the service anymore, so helper extraction is unnecessary.

---

### ~~#7 — Fix type hole in updateNote~~

**Fixed.** The `Record<string, unknown>` type hole was removed. `updateNote` now passes `updatedNote` (typed as `NoteUpdate`) directly to `db.update().set()`, thanks to the `numeric` → `integer` schema change making the `String()` conversions unnecessary.

---

### ~~#2 — Eliminate double body parsing~~

**Files:** `src/modules/note/note.controller.ts`, `src/modules/user/user.controller.ts`, `src/utils/route.util.ts`

**Changes (completed):**

- [x] **`src/utils/route.util.ts`** — `CreateRouteUtil.createRouteUtil` made generic (`TParamsSchema`, `TQuerySchema`, `THeadersSchema`, `TBodySchema`) so the exact schema type flows into `createRoute`. The type-erasing `Record<string, unknown>` accumulator was replaced with a single `request` object literal (conditional spreads), asserted to a `RouteRequest<...>` type whose conditional `body` keeps `body` **required** when a schema is provided — this is what lets `c.req.valid("json")` infer correctly. Detailed explanatory comments added.
- [x] **`note.controller.ts` / `user.controller.ts`** — POST and PUT handlers replaced `Schema.parse(await c.req.json())` with `c.req.valid("json")` (4 occurrences); unused `type NoteCreate`/`NoteUpdate`/`UserCreate`/`UserUpdate` imports removed.

**Note:** invalid bodies now produce zod-openapi's automatic structured 400 response instead of a thrown `ZodError` → 500.

```ts
// Before:
const body: NoteCreate = NoteCreateSchema.parse(await c.req.json());
const note: Note = await NoteService.createNote(body);

// After:
const body = c.req.valid("json");
const note: Note = await NoteService.createNote(body);
```

---

### ~~#3 — Replace non-null assertions on params~~

**Files:** `src/modules/note/note.controller.ts:52,66,80`, `src/modules/user/user.controller.ts:52,66,80`, `src/utils/route.util.ts`

3 occurrences per controller (6 total).

**Changes (completed):**

- [x] **`src/utils/route.util.ts`** — Updated `RouteRequest` conditional type mapping so `params`, `query`, and `headers` are non-optional when their schemas are supplied (mirroring the `body` fix), ensuring `c.req.valid("param")` correctly infers without `undefined`.
- [x] **`note.controller.ts` / `user.controller.ts`** — GET `/{id}`, PUT `/{id}`, and DELETE `/{id}` handlers replaced `c.req.param("id")!` with `const { id } = c.req.valid("param")`.

```ts
// Before:
const id = c.req.param("id")!;

// After:
const { id } = c.req.valid("param");
```

---

## Phase 3 — Polish

### ~~#10 — Pluralize method names~~

**Files:** `src/modules/note/note.service.ts`, `src/modules/note/note.controller.ts`, `src/modules/note/note.service.test.ts`, `src/modules/user/user.service.ts`, `src/modules/user/user.controller.ts`, `src/modules/user/user.service.test.ts`

- [x] Renamed `getAllNote()` &rarr; `getAllNotes()` and `getAllUser()` &rarr; `getAllUsers()` across all services, controllers, and test files.

| File                          | Before                      | After                        |
| ----------------------------- | --------------------------- | ---------------------------- |
| Both services                 | `static async getAllNote()` | `static async getAllNotes()` |
| Both services                 | `static async getAllUser()` | `static async getAllUsers()` |
| Both controllers (line 26)    | `NoteService.getAllNote()`  | `NoteService.getAllNotes()`  |
| Both controllers (line 26)    | `UserService.getAllUser()`  | `UserService.getAllUsers()`  |
| Both test files (line ~38-42) | `NoteService.getAllNote()`  | `NoteService.getAllNotes()`  |
| Both test files (line ~38-42) | `UserService.getAllUser()`  | `UserService.getAllUsers()`  |

---

### ~~#9 — Controller duplication (review only — no action)~~

Both controllers are 85 lines of near-identical CRUD boilerplate.

- [x] **Decision (Confirmed):** Keep as-is for now. At 85 lines the duplication is tolerable and the explicitness is valuable for future feature flexibility without premature abstraction. Revisit if a third module is added.

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

### ~~#4 — Remove unused import~~

**File:** `src/modules/note/note.service.test.ts:1`

- [x] Removed unused `beforeAll` from vitest import.

```ts
// Before:
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// After:
import { describe, it, expect, afterAll } from "vitest";
```

---

### ~~#11 — Use OpenAPIHono in common controller~~

**File:** `src/modules/common/common.controller.ts:1,3`

- [x] Converted `common.controller.ts` to `OpenAPIHono` with `CreateRouteUtil` and `WelcomeResponseSchema`, so the root route appears in OpenAPI docs consistently with other controllers.

```ts
// Before:
import { Hono } from "hono";
const app = new Hono();

// After:
import { OpenAPIHono } from "@hono/zod-openapi";
const app = new OpenAPIHono();
```

---

## Execution Order

| Step | Issue                | Files                                          | Depends on |
| ---- | -------------------- | ---------------------------------------------- | ---------- |
| 1    | ~~Install hash lib~~ | `package.json`                                 | —          |
| 2    | ~~#5~~               | `user.service.ts`, `src/utils/hash.util.ts`    | Step 1     |
| 3    | ~~#6~~               | `app.module.ts`                                | —          |
| 4    | ~~#2~~               | `route.util.ts` + both controllers             | —          |
| 5    | ~~#3~~               | both controllers + `route.util.ts`             | #2 (types) |
| 6    | ~~#10~~              | services + controllers + tests (6 files)       | —          |
| 7    | ~~#4, #11~~          | `note.service.test.ts`, `common.controller.ts` | —          |

~~#1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11~~ completed. All 11 issues resolved.
