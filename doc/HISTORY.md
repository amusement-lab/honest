# History

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
