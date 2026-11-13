# History

## 2026-11-13 — Test Infrastructure Refactor & HTTP Integration Tests (`test` branch)

### Context & Motivation

The `test` branch replaced the service-level unit tests with HTTP integration tests that exercise the full Hono stack: routing, Zod validation, controllers, `app.onError`, and Drizzle/SQLite. The previous setup had several gaps:

- Test database setup ran `drizzle-kit push` from `src/db/vitest-global-setup.ts`, bypassing the SQL migrations in `drizzle/`. Tests could pass against a schema that the dev database never applied.
- The test database defaulted to the repository root (`./sqlite.test.db`), and `DATABASE_URL_TEST` was hardcoded in `vitest.config.ts`'s worker environment instead of being resolved consistently by `globalSetup` and the test workers.
- Service tests called `NoteService` / `UserService` directly, so HTTP concerns — validation errors, `Content-Type` handling, status codes, 404/400 behavior — were never exercised.
- Empty `PUT` payloads reached `db.update().set({})`, which throws `No values to set` and surfaced as a 500 instead of a 400.
- Route bodies were not marked `required: true`, so zod-openapi skipped validation when a request had no `Content-Type` header; the empty body then reached the database and failed as a 500.
- `NoteCreateSchema` still accepted `status` even though `NoteService.createNote` always forces it to `pending`.

### Solution

1. **HTTP Integration Tests**: Replaced `note.service.test.ts` and `user.service.test.ts` with co-located HTTP tests in `src/modules/note/note.test.ts` and `src/modules/user/user.test.ts`, plus a new `src/modules/common/common.test.ts` for the root route, OpenAPI document, Swagger UI, and unknown routes. Tests call `app.request()` directly (no network server) and cover create/read/update/delete, validation, status codes, persistence, password hashing, and regression cases.

2. **Shared Test Helpers**: Added `src/utils/test.util.ts` with `app`, `jsonRequest`, `rawRequest`, `readJson`, and `resetDatabase`. `resetDatabase()` empties both tables before each test and refuses to run outside test mode.

3. **Migration-Based Test Database**: Replaced `src/db/vitest-global-setup.ts` with `src/utils/test-setup.util.ts`. The global setup deletes stale test database/journal/WAL/SHM files, creates `db/data/`, applies the migrations in `drizzle/` through `drizzle-orm/better-sqlite3/migrator`, and deletes the throwaway database on teardown. `setupSucceeded` prevents teardown from deleting anything after a failed setup.

4. **Test Database Guards & Paths**: Moved the default database paths to `./db/data/sqlite.db` and `./db/data/sqlite.test.db` in `.env.example`, `drizzle.config.ts`, `src/db/index.ts`, and the test setup. `src/db/index.ts` now refuses to open the development database when running in test mode, and the test setup refuses to delete it.

5. **Vitest Configuration**: Updated `vitest.config.ts` for Vitest 5: explicit `src/**/*.test.ts` include, `fileParallelism: false` because all test files share one SQLite file, `isolate: true`, and explicit `VITEST` / `NODE_ENV` test env. Removed `globals: true`; tests import Vitest APIs explicitly.

6. **Regression Fixes**: Marked route request bodies as `required: true` in `CreateRouteUtil`, omitted `status` from `NoteCreateSchema`, and added empty-payload guards to `NoteService.updateNote` and `UserService.updateUser` so both return 400 instead of a Drizzle 500. Controllers now return explicit `c.json(value, 200)` responses to satisfy the typed success-status generics.

7. **Route Utility Typing**: Added `ResponseSchema` and `Status` generics (constrained to Hono's `SuccessStatusCode`), plus `SuccessResponse` / `RouteResponses` types, so the route's success status and response schema are type-checked together. Request bodies are always `required: true`.

8. **Dependencies & Tooling**: Removed the `db:push` script and added `typecheck` (`tsc --noEmit`). Upgraded Vitest to `^5.1.0`, `@types/better-sqlite3` to `^9.6.0`, and refreshed Hono, Zod, Drizzle, better-sqlite3, dotenv, tsx, and related packages. Cleaned up `pnpm-workspace.yaml` and added `db/data/` plus `coverage/` to `.gitignore`.

9. **Documentation**: Updated `README.md` with the current tech stack, migration-first database setup, the removed `db:push` script, and the `typecheck` command. Updated `doc/plan/refactor the code 2.md` to reflect completed items and the move from service tests to HTTP tests.

### Files Changed

#### Tests

##### `src/modules/note/note.test.ts` (NEW, replaces `src/modules/note/note.service.test.ts`)

- HTTP coverage for `POST`, `GET`, `GET /{id}`, `PUT /{id}`, and `DELETE /{id}`
- Covers forced `pending` status, required fields, numeric validation, ISO dates, UUID params, 404s, empty updates, non-JSON content types, and missing bodies

##### `src/modules/user/user.test.ts` (NEW, replaces `src/modules/user/user.service.test.ts`)

- HTTP coverage for user CRUD
- Verifies passwords are hashed in the database and never returned in responses
- Covers duplicate emails, malformed emails, short passwords, re-hashing on update, 404s, empty updates, and content-type handling

##### `src/modules/common/common.test.ts` (NEW)

- Verifies `GET /`, the OpenAPI document at `/doc`, the Swagger UI at `/doc-ui`, and 404s for unknown paths/methods

##### `src/modules/note/note.service.test.ts` & `src/modules/user/user.service.test.ts` (DELETED)

- Replaced by the HTTP integration tests above

##### `src/utils/test.util.ts` (NEW)

- Exports `app`, `jsonRequest`, `rawRequest`, `readJson`, and `resetDatabase`
- `resetDatabase` guards against running outside test mode

##### `src/utils/test-setup.util.ts` (NEW, replaces `src/db/vitest-global-setup.ts`)

- Recreates the test database from `drizzle/` migrations
- Deletes the test database and journal/WAL/SHM files on teardown
- Refuses to touch the development database

##### `src/db/vitest-global-setup.ts` (DELETED)

- Replaced by the migration-based setup above

#### Application Code

##### `src/modules/note/note.entity.ts`

- `NoteCreateSchema` now omits both `id` and `status`

##### `src/modules/note/note.service.ts`

- `updateNote` rejects an empty payload with `400 No fields to update`

##### `src/modules/user/user.service.ts`

- `updateUser` rejects an empty payload with `400 No fields to update` before the existence lookup

##### `src/modules/note/note.controller.ts` & `src/modules/user/user.controller.ts`

- Success responses now return explicit `200` status codes

##### `src/utils/route.util.ts`

- Added `required: true` to JSON request bodies
- Added `ResponseSchema` / `Status` generics and typed success/error response maps
- Documented why `required: true` and omitted success `content` matter

##### `src/db/index.ts`

- Defaults to `./db/data/sqlite.db` and `./db/data/sqlite.test.db`
- Exports `isTest`
- Throws if test mode resolves to the development database
- Removed the explicit `journal_mode = WAL` pragma

##### `src/modules/app.module.ts`

- Commented out the structured `console.error` logging in `app.onError` (left in place for later re-enablement)

#### Configuration & Tooling

##### `package.json` & `pnpm-lock.yaml`

- Removed `db:push`
- Added `typecheck`
- Upgraded `vitest` to `^5.1.0`, `@types/better-sqlite3` to `^9.6.0`, `hono` to `^4.13.18`, `zod` to `4.6.7`, `drizzle-orm` to `^0.45.4`, `better-sqlite3` to `^13.1.1`, `drizzle-kit` to `^0.31.11`, `dotenv` to `^18.0.10`, `@hono/node-server` to `^2.1.8`, `@hono/swagger-ui` to `^0.6.2`, `tsx` to `^4.23.15`, and `npm-check-updates` to `^23.1.1`

##### `vitest.config.ts`

- Added explicit test include, serial file execution, and test-mode env
- Removed `globals: true` and the hardcoded `DATABASE_URL_TEST`

##### `.env.example`, `drizzle.config.ts`, & `.gitignore`

- Moved database paths under `db/data/`
- Added `db/data/` and `coverage/` ignore rules

##### `pnpm-workspace.yaml`

- Removed the obsolete `better-sqlite3: false` allow-list entry and `onlyBuiltDependencies`
- Updated `minimumReleaseAgeExclude`

#### Documentation

##### `README.md`

- Updated tech stack, database setup (migrations instead of `db:push`), test setup, and `typecheck` command

##### `doc/plan/refactor the code 2.md`

- Updated statuses and test file references after the HTTP test migration

##### `doc/HISTORY.md`

- Added this entry

---

## 2026-09-20 — Database Migration from PostgreSQL to SQLite (`better-sqlite3`)

### Context & Motivation

Running PostgreSQL in local development and test environments required external Docker containers (`docker-compose.yml`, `honest_pg`, `honest_pg_test`), introducing operational overhead, service dependencies, and network isolation complexities.

To achieve an embedded, zero-configuration local development setup, the database layer was migrated to SQLite using `better-sqlite3` and `drizzle-orm/better-sqlite3`.

### Solution

1. **Database Driver & Dialect**: Replaced `pg` / `@types/pg` with `better-sqlite3` and `@types/better-sqlite3`. Configured Drizzle Kit dialect to `sqlite` targeting local file database paths (`./sqlite.db` and `./sqlite.test.db`).
2. **Schema Migration**: Converted table definitions in `src/db/schema.ts` from `drizzle-orm/pg-core` to `drizzle-orm/sqlite-core`. Changed `uuid` primary keys to `text` with `$defaultFn(() => crypto.randomUUID())`, and replaced `date`/`varchar` with `text`.
3. **Connection & WAL Mode**: Updated `src/db/index.ts` to instantiate `better-sqlite3` and enabled Write-Ahead Logging (`WAL`) mode for non-test environments to improve concurrent read/write performance.
4. **Error Handling**: Updated global error handling in `src/modules/app.module.ts` and service-level constraint checks in `src/modules/user/user.service.ts` to catch SQLite constraint violations (`SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_CONSTRAINT_PRIMARYKEY`, `SQLITE_CONSTRAINT_FOREIGNKEY`) and return appropriate HTTP 409 and 400 responses.
5. **Automated Test DB Lifecycle**: Updated `src/db/vitest-global-setup.ts` to automatically unlink stale `./sqlite.test.db` instances before pushing the schema, and clean up the file on `teardown()`.
6. **Prebuilt Binaries & Zero-Build Setup**: Upgraded `better-sqlite3` to `^13.0.3` which bundles prebuilt Node-API (N-API) binaries for all platforms across Node `>= 22`, and added `allowBuilds.better-sqlite3: false` to `pnpm-workspace.yaml`. This eliminated the need for native C++ build tools (`make`, `g++`, `python`) and allowed removing `.nvmrc`.
7. **Decommissioned Docker & Cleaned Docs**: Deleted `docker-compose.yml`, updated `README.md` to reflect the SQLite architecture and npm scripts, and moved the completed migration plan to `doc/plan/done/migrate to sqlite.md`.

### Files Changed

#### `package.json` & `pnpm-lock.yaml`

- Removed `pg` and `@types/pg`
- Added `better-sqlite3` (`^13.0.3`) and `@types/better-sqlite3`
- Added standard Drizzle scripts (`db:generate`, `db:push`, `db:migrate`, `db:seed`, `db:studio`)

#### `pnpm-workspace.yaml`

- Added `allowBuilds: better-sqlite3: false` to bypass unnecessary native compilation

#### `drizzle.config.ts`

- Changed `dialect` from `postgresql` to `sqlite`
- Updated `dbCredentials.url` to use `process.env.DATABASE_URL ?? './sqlite.db'`

#### `.env` & `.env.example`

- Replaced PostgreSQL connection strings and container credentials with `DATABASE_URL=./sqlite.db` and `DATABASE_URL_TEST=./sqlite.test.db`

#### `.gitignore`

- Added patterns for SQLite database and journal files (`*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`)

#### `src/db/schema.ts`

- Migrated `notes` and `userTable` to `drizzle-orm/sqlite-core`
- Used `text` with Web Crypto `crypto.randomUUID()` for primary keys

#### `src/db/index.ts`

- Replaced `drizzle-orm/node-postgres` with `better-sqlite3` and `drizzle-orm/better-sqlite3`
- Enabled WAL journal mode in non-test mode
- Exported both `db` and `client`

#### `src/db/seed.ts`

- Updated to use SQLite client with explicit `client.close()` in `.finally()`

#### `src/modules/app.module.ts`

- Added constraint violation handling for SQLite errors (`SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_CONSTRAINT_FOREIGNKEY`, etc.)

#### `src/modules/user/user.service.ts`

- Updated `createUser` and `updateUser` catch blocks to detect SQLite unique constraint violations

#### `src/db/vitest-global-setup.ts` & `vitest.config.ts`

- Automated SQLite test database creation via `drizzle-kit push` and cleanup in `teardown()`

#### `drizzle/`

- Removed PostgreSQL migration `0000_wandering_wolfpack.sql`
- Generated fresh SQLite migration `0000_dashing_anita_blake.sql` and updated snapshot journal

#### `docker-compose.yml` (DELETED)

- Removed deprecated PostgreSQL container specifications

#### `.nvmrc` (DELETED)

- Removed Node 22 pin as `better-sqlite3@13.0.3` runs natively across Node `>= 22`

#### `README.md`

- Updated documentation for SQLite architecture, environment setup, and npm scripts

#### `doc/plan/done/migrate to sqlite.md` (MOVED)

- Moved completed migration plan to `doc/plan/done/` and marked all tasks as completed

---

## 2026-08-31 — Route Utility Generics, Type Safety & Module Standardization

### Context & Motivation

Following the modules review in `doc/PLAN/modules review.md`, several developer experience, typing, and architectural inconsistencies remained across the codebase:

- `CreateRouteUtil.createRouteUtil()` lost TypeScript schema types due to type widening, requiring manual `.parse()` calls or `c.req.param('id')!` non-null assertions in controller handlers.
- `common.controller.ts` used plain `Hono` instead of `OpenAPIHono`, leaving the root `/` endpoint undocumented in Swagger UI / OpenAPI schemas.
- Method naming across services, controllers, and tests was inconsistent (singular `getAllNote()` and `getAllUser()` instead of standard plural conventions).
- Path parameter validation for UUID identifiers (`IdParamSchema`) was duplicated in individual controllers.

### Solution

1. **Generic Route Utility (`CreateRouteUtil`)**: Overhauled `src/utils/route.util.ts` with generic schema parameters (`ParamsSchema`, `QuerySchema`, `HeadersSchema`, `BodySchema`) and conditional intersection types in `RouteRequest`. Now `c.req.valid('json')` and `c.req.valid('param')` return fully typed objects without manual type assertions.
2. **Centralized UUID Path Parameter**: Extracted `IdParamSchema` with `z.uuid().openapi(...)` into `src/utils/route.util.ts` and reused it across `user.controller.ts` and `note.controller.ts`.
3. **OpenAPI Integration for Common Controller**: Converted `common.controller.ts` to `OpenAPIHono` and `CreateRouteUtil`, bringing root `/` route documentation into Swagger.
4. **Method Pluralization & Code Polish**: Renamed `getAllNote()` → `getAllNotes()` and `getAllUser()` → `getAllUsers()` across all services, controllers, and test suites. Cleaned up unused test imports.
5. **Next Refactoring Phase Plan**: Added `doc/PLAN/refactor the code 2.md` outlining upcoming fixes for create schemas, race conditions, and table naming consistency.

### Files Changed

#### `src/utils/route.util.ts`

- Added generic type parameters to `CreateRouteUtil.createRouteUtil` to preserve schema types
- Updated `RouteRequest` conditional intersection type mapping for `params`, `query`, `headers`, and `body`
- Added centralized `IdParamSchema` with `z.uuid()`

#### `src/modules/common/common.controller.ts`

- Converted to `OpenAPIHono` and `CreateRouteUtil`

#### `src/modules/note/note.controller.ts` & `src/modules/user/user.controller.ts`

- Replaced `Schema.parse(await c.req.json())` with `c.req.valid('json')`
- Replaced `c.req.param('id')!` with `const { id } = c.req.valid('param')`
- Replaced duplicated local param schemas with shared `IdParamSchema`
- Updated controller calls to use `getAllNotes()` and `getAllUsers()`

#### `src/modules/note/note.service.ts` & `src/modules/user/user.service.ts`

- Renamed methods to `getAllNotes()` and `getAllUsers()`

#### `src/modules/note/note.service.test.ts` & `src/modules/user/user.service.test.ts`

- Updated test cases to use pluralized service method names
- Removed unused imports (`beforeAll`)

#### `src/db/seed.ts`

- Updated seed data to use integer types for note amount and pricing

#### `doc/PLAN/modules review.md`

- Marked all 11 action items as completed

#### `doc/PLAN/refactor the code 2.md` (NEW)

- Detailed implementation plan for Phase 2 refactoring

---

## 2026-08-30 — Password Hashing with Scrypt (`@noble/hashes`)

### Context & Motivation

User passwords in `UserService` were previously stored and updated as plaintext strings, introducing a critical security vulnerability. A pure-JavaScript/WebCrypto/WASM hashing solution was required to maintain compatibility with both Node.js and Cloudflare Workers runtime environments without native C++ compilation dependencies.

### Solution

Implemented Scrypt password hashing and verification using `@noble/hashes/scrypt`:

- Generates a 16-byte cryptographically secure random salt per password.
- Serializes hashes in `${saltHex}:${derivedKeyHex}` format.
- Implements constant-time comparison in `verifyPassword` to prevent timing attack vulnerabilities.
- Integrated `hashPassword` during user creation (`createUser`) and user update (`updateUser`).
- Added comprehensive unit test suite in `src/utils/hash.util.test.ts`.

### Files Changed

#### `src/utils/hash.util.ts` (NEW)

- Exports `hashPassword` / `hash` and `verifyPassword` / `verify` using Scrypt (`N: 16384, r: 8, p: 1, dkLen: 32`)

#### `src/utils/hash.util.test.ts` (NEW)

- Unit tests covering salt generation, valid verification, wrong password rejection, malformed hash rejection, and salt uniqueness

#### `src/modules/user/user.service.ts`

- Hashed passwords before saving on `createUser` and `updateUser`

#### `package.json` & `pnpm-lock.yaml`

- Added `@noble/hashes` dependency

---

## 2026-08-29 — Drizzle Migration Metadata Tracking & Schema Column Types

### Context & Motivation

Drizzle Kit metadata files in `drizzle/meta/` were ignored by `.gitignore`, causing migration tracking discrepancies across development environments. Furthermore, PostgreSQL `numeric` columns in `notes` returned string values via `node-postgres`, requiring manual string/number casting throughout services.

### Solution

- Updated `notes` schema in `src/db/schema.ts` to use `integer` for `amount`, `price`, and `totalPrice`.
- Removed `drizzle/meta/` from `.gitignore` and tracked `0000_snapshot.json` and `_journal.json`.
- Generated migration `0000_wandering_wolfpack.sql` reflecting integer column types.

### Files Changed

#### `.gitignore`

- Removed `drizzle/meta/` ignore rule

#### `drizzle/meta/0000_snapshot.json` & `drizzle/meta/_journal.json` (NEW)

- Tracked Drizzle migration snapshots and journal in version control

#### `drizzle/0000_wandering_wolfpack.sql`

- Initial migration with integer column types for note amounts and pricing

#### `src/db/schema.ts`

- Changed `amount`, `price`, and `totalPrice` column types from `numeric` to `integer`

---

## 2026-08-03 — Structured Error Logging & Secure Error Handling

### Context & Motivation

The global error handler previously logged `err.cause` (which was often undefined) and directly returned `err.message` to clients on uncaught exceptions, potentially leaking sensitive internal error details.

### Solution

- Updated `app.onError` in `src/modules/app.module.ts` to log structured JSON containing `error`, `stack`, `method`, and `url` to standard error, ensuring compatibility with Node.js and Cloudflare Workers (`wrangler tail`).
- Sanitized client error responses: uncaught exceptions now return a generic `{ message: "Internal Server Error" }` with HTTP status 500, while `HTTPException` instances preserve their explicit status codes and messages.
- Added structured comment stubs for future Zod and PostgreSQL error code handling.

### Files Changed

#### `src/modules/app.module.ts`

- Structured JSON logging in `app.onError`
- Generic 500 error response for uncaught exceptions

---

## 2026-07-28 — Documentation Reorganization & Schema Simplification

### Context & Motivation

Project documentation, architecture notes, and migration plans were spread across root-level markdown files (`PLAN.md`, `HISTORY.md`, `NOTE.md`). Furthermore, `NoteService` contained manual type casting logic to deal with legacy string numbers.

### Solution

- Reorganized all documentation into the `doc/` directory, splitting migration plans into `doc/PLAN/migrate-to-d1-and-miniflare.md` and `doc/PLAN/refactor the code.md`.
- Simplified `NoteService` by returning raw Drizzle query results directly.
- Added `pnpm-workspace.yaml` and updated core dependencies (`drizzle-orm`, `hono`, `vitest`).

### Files Changed

#### `doc/HISTORY.md` & `doc/NOTE.md` (MOVED)

- Relocated from repository root to `doc/`

#### `doc/PLAN/migrate-to-d1-and-miniflare.md` & `doc/PLAN/refactor the code.md` (NEW)

- Created dedicated planning documents for Cloudflare D1/Miniflare migration and codebase refactoring

#### `src/modules/note/note.service.ts`

- Removed manual `Number()` and `String()` conversions

#### `pnpm-workspace.yaml` (NEW)

- Added pnpm workspace configuration

---

## 2026-07-25 — Automated test DB setup via vitest globalSetup

### Context & Motivation

Running `pnpm test` required a manual pre-step (`pnpm test:setup`) to push the Drizzle schema to the test database. If you forgot this step, tests would fail with missing-table errors. The `test:setup` script also used a fragile `grep | cut` shell pipeline to extract `DATABASE_URL_TEST` from `.env`.

### Solution

Replaced the manual script with a vitest `globalSetup` file that runs `drizzle-kit push` targeting the test database automatically before any test files execute. Uses `dotenv`-loaded `process.env.DATABASE_URL_TEST` instead of fragile shell-based `.env` parsing. The drizzle-kit CLI is invoked via `execSync` because `drizzle-kit/api`'s ESM bundle contains dynamic `require()` calls that crash in ESM environments (known upstream bug).

### Files Changed

#### `src/db/vitest-global-setup.ts` (NEW)

- Exports `setup()` — loads `dotenv`, runs `drizzle-kit push` with `DATABASE_URL` overridden to `DATABASE_URL_TEST`
- Source of truth for the DB URL is `dotenv`, not a `grep | cut` shell pipeline

#### `vitest.config.ts`

- Added `globalSetup: ['./src/db/vitest-global-setup.ts']`
- Removed dead `DATABASE_URL` env line (always resolved to `''` since dotenv hadn't loaded yet)

#### `package.json`

- Removed `test:setup` script — no longer needed (setup is now automatic)

#### `HISTORY.md` (THIS FILE)

- Added this entry

---

## 2026-05-27 — OpenAPI & Architecture Overhaul

### Context & Motivation

This project is a Hono-based template that mimics NestJS's folder structure and separation of concerns (controllers, services, entities) while staying lightweight and compatible with Cloudflare Workers. The original OpenAPI implementation had several gaps:

- `user.controller.ts` used plain `Hono` instead of `OpenAPIHono`, so its routes never appeared in Swagger UI
- `note.controller.ts` used manual `NoteSchema.parse(await c.req.json())` for validation — no integration with `@hono/zod-openapi`'s built-in validation
- `CreateRouteUtil` only supported `requestSchema` (body) — no support for `params`, `query`, or `headers`
- Error responses (400, 404, 500) were commented out in the utility file and never documented
- No consistent error response format across routes

### OpenAPI Implementation — Detailed Approach

#### 1. Evaluating `nestjs-zod-openapi` as Reference

The project author previously used [wahyubucil/nestjs-zod-openapi](https://github.com/wahyubucil/nestjs-zod-openapi) in a NestJS project. We analyzed it to understand what features needed to be adapted for Hono:

| NestJS Feature                      | Hono Equivalent                   | Notes                                         |
| ----------------------------------- | --------------------------------- | --------------------------------------------- |
| `.openapi('Name')` → `$ref` schemas | Same `.openapi('Name')`           | Already built into `@hono/zod-openapi`        |
| `ZodValidationPipe` auto-validation | `app.openapi()` + `c.req.valid()` | Built-in, just needed to be wired up          |
| `createZodDto(schema)`              | `z.infer<typeof Schema>`          | No class needed — Hono takes schemas directly |
| `@ApiOkResponse({ type: Dto })`     | `responses: { 200: { schema } }`  | Already in `createRoute`                      |
| `patchNestjsSwagger`                | N/A                               | `@hono/zod-openapi` handles it natively       |

**Conclusion:** `@hono/zod-openapi` already provides the core functionality. The gap was developer ergonomics — the `CreateRouteUtil` wrapper and consistent error response utilities.

#### 2. The `c.req.valid()` Type Inference Problem

`@hono/zod-openapi` provides `c.req.valid('json')`, `c.req.valid('param')`, etc. — a convenient way to get validated, typed request data. However, this only works when `createRoute` receives schemas **directly**. When schemas pass through a wrapper function like `CreateRouteUtil.createRouteUtil()`, TypeScript loses the type connection and `c.req.valid()` returns `never`.

We explored three approaches:

**Option A: Type assertions in handlers**

```typescript
const body = c.req.valid("json") as NoteCreate;
```

- Pros: Clean `CreateRouteUtil` API, maximum readability
- Cons: Manual type assertions needed, loses compile-time safety if schemas change

**Option B: Partial config pattern**

```typescript
app.openapi(
  createRoute({
    ...noteRoute.routeConfig({ method: 'post', path: '/' }),
    request: { body: { content: { 'application/json': { schema: NoteCreateSchema } } } },
    responses: { ... },
  }),
  ...
)
```

- Pros: Full type safety, `c.req.valid()` works
- Cons: More verbose, schemas defined inline in controller instead of through utility

**Option C: Use `c.req.json()` with manual `.parse()`**

```typescript
const body: NoteCreate = NoteCreateSchema.parse(await c.req.json());
```

- Pros: Clean `CreateRouteUtil` API, explicit and readable, full type safety via explicit type annotation
- Cons: Slightly more boilerplate than `c.req.valid()`

**Decision:** Option C was chosen. It preserves the clean `CreateRouteUtil` API the author wanted for readability, while maintaining type safety through explicit type annotations. The schemas are still defined once in `createRouteUtil` for OpenAPI docs, and the same schemas are used for `.parse()` validation in handlers — DRY is maintained at the schema level.

#### 3. `CreateRouteUtil` Rewrite

Rewrote `src/utils/route.util.ts` with a clean, readable API that supports:

- `method` — `get`, `post`, `put`, `patch`, `delete`
- `path` — route path with `{id}` syntax (OpenAPI spec, not Hono's `:id`)
- `requestSchema` — request body (auto-wrapped in `application/json` content type)
- `paramsSchema` — path parameters
- `querySchema` — query string parameters
- `headersSchema` — request headers
- `responseSchema` — response body schema
- `status` — custom HTTP status code (default `200`)
- `description` — route description for OpenAPI docs

The `tags` and `security` are set once in the constructor:

```typescript
const noteRoute = new CreateRouteUtil(["Note"]);
```

#### 4. Error Response Standardization

Added `ErrorResponseSchema` and `errorResponses` to `route.util.ts`:

```typescript
export const ErrorResponseSchema = z
  .object({
    message: z.string().openapi({ example: "Error message" }),
  })
  .openapi("ErrorResponse");
```

Every route automatically documents 400, 404, and 500 error responses with this schema. The `defaultHook` in `app.module.ts` handles validation errors consistently:

```typescript
const app = new OpenAPIHono({
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
```

This is equivalent to NestJS's `ZodValidationPipe` — automatic validation error handling without manual try/catch in every handler.

### Files Changed

#### `src/utils/route.util.ts`

- Removed unused `createRouteUtil2` function
- Added `ErrorResponseSchema` with `.openapi('ErrorResponse')` registration
- Rewrote `CreateRouteUtil.createRouteUtil()` to support `paramsSchema`, `querySchema`, `headersSchema`, `status`, and `description`
- Path syntax changed from `:id` (Hono) to `{id}` (OpenAPI spec)

#### `src/module/app.module.ts`

- Added `defaultHook` to `OpenAPIHono` constructor for automatic Zod validation error handling

#### `src/module/note/note.entity.ts`

- Added `.openapi({ example: '...' })` to all fields for better Swagger documentation

#### `src/module/note/note.controller.ts`

- Converted to use `CreateRouteUtil` with all new options
- Uses `NoteCreateSchema.parse(await c.req.json())` with explicit type annotation
- Uses `c.req.param('id')!` for path parameters
- POST returns `201` status code

#### `src/module/note/note.service.ts`

- Replaced in-memory array with Drizzle ORM queries
- Handles numeric string conversion (PostgreSQL `numeric` type stores as strings)
- Converts `status` boolean to `'active'`/`'inactive'` string for API responses
- Uses `HTTPException` for consistent error handling

#### `src/module/user/user.entity.ts` (NEW)

- Created `UserSchema`, `UsersSchema`, `UserCreateSchema`, `UserUpdateSchema`
- Password field excluded from response schemas (security)
- All schemas registered with `.openapi()` for Swagger `$ref` support

#### `src/module/user/user.controller.ts`

- Converted from plain `Hono` to `OpenAPIHono`
- Full CRUD: GET all, POST create, GET by ID, PUT update, DELETE
- All routes documented in Swagger UI

#### `src/module/user/user.service.ts`

- Replaced dummy data with Drizzle ORM queries
- Email uniqueness validation on create and update
- Password excluded from all responses
- Uses `HTTPException` for 400/404 errors

#### `src/db/index.ts` (NEW)

- Centralized Drizzle client export with schema import

#### `src/db/schema.ts`

- Added `status` boolean column to `notes` table (was missing)

#### `src/db/seed.ts`

- Fixed table references (`notes` instead of `noteTable`)
- Updated seed data to match actual schema fields
