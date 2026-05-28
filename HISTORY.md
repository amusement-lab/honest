# History

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

| NestJS Feature | Hono Equivalent | Notes |
|---|---|---|
| `.openapi('Name')` → `$ref` schemas | Same `.openapi('Name')` | Already built into `@hono/zod-openapi` |
| `ZodValidationPipe` auto-validation | `app.openapi()` + `c.req.valid()` | Built-in, just needed to be wired up |
| `createZodDto(schema)` | `z.infer<typeof Schema>` | No class needed — Hono takes schemas directly |
| `@ApiOkResponse({ type: Dto })` | `responses: { 200: { schema } }` | Already in `createRoute` |
| `patchNestjsSwagger` | N/A | `@hono/zod-openapi` handles it natively |

**Conclusion:** `@hono/zod-openapi` already provides the core functionality. The gap was developer ergonomics — the `CreateRouteUtil` wrapper and consistent error response utilities.

#### 2. The `c.req.valid()` Type Inference Problem

`@hono/zod-openapi` provides `c.req.valid('json')`, `c.req.valid('param')`, etc. — a convenient way to get validated, typed request data. However, this only works when `createRoute` receives schemas **directly**. When schemas pass through a wrapper function like `CreateRouteUtil.createRouteUtil()`, TypeScript loses the type connection and `c.req.valid()` returns `never`.

We explored three approaches:

**Option A: Type assertions in handlers**
```typescript
const body = c.req.valid('json') as NoteCreate
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
const body: NoteCreate = NoteCreateSchema.parse(await c.req.json())
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
const noteRoute = new CreateRouteUtil(['Note'])
```

#### 4. Error Response Standardization

Added `ErrorResponseSchema` and `errorResponses` to `route.util.ts`:

```typescript
export const ErrorResponseSchema = z.object({
  message: z.string().openapi({ example: "Error message" }),
}).openapi("ErrorResponse")
```

Every route automatically documents 400, 404, and 500 error responses with this schema. The `defaultHook` in `app.module.ts` handles validation errors consistently:

```typescript
const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        { message: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ') },
        400
      )
    }
  },
})
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
