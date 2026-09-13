# Login, Authentication & Authorization — Implementation Plan

---

## Scope

Design and implement role-based authentication and authorization using Hono's native JWT capabilities (`hono/jwt`) and `@noble/hashes`:

- **Two Authorization Levels:** `admin` and `user`.
- **Public Gateway:** Unauthenticated `POST /auth/register` and `POST /auth/login` endpoints as public entry points.
- **Admin-Only User Module:** Complete access restriction on `src/modules/user/` (`/user/*`). Only users with `admin` role can list, view, create, update, or delete users. Regular users receive `403 Forbidden`. Unauthenticated requests receive `401 Unauthorized`.
- **User-Scoped Note Module:** Regular users can only access, create, update, and delete their own notes. Notes are linked to users via a `userId` foreign key. Admins can view and manage all notes.
- **OpenAPI & Swagger Integration:** Register `BearerAuth` security scheme in `@hono/zod-openapi` and update `CreateRouteUtil` to document `401 Unauthorized` and `403 Forbidden` responses.

---

## File Index

| File                                    | Tasks                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`                      | #1 (Add `role` to `userTable`), #2 (Add `userId` foreign key to `notes`)                    |
| `.env.example` / `.env`                 | #3 (Add `JWT_SECRET` and `JWT_EXPIRES_IN`)                                                  |
| `src/utils/jwt.util.ts`                 | #4 (Native `hono/jwt` sign, verify, token types) [NEW]                                      |
| `src/middleware/auth.middleware.ts`     | #5 (`authMiddleware`, `requireRole` middleware, Hono `Context` variables typing) [NEW]      |
| `src/utils/route.util.ts`               | #6 (Add 401 & 403 standard response schemas, Bearer security presets)                       |
| `src/modules/auth/auth.entity.ts`       | #7 (Register, login, and auth response Zod schemas) [NEW]                                   |
| `src/modules/auth/auth.service.ts`      | #8 (Registration, login credential verification, JWT generation) [NEW]                      |
| `src/modules/auth/auth.controller.ts`   | #9 (Public OpenAPI routes: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`) [NEW] |
| `src/modules/user/user.entity.ts`       | #10 (Include `role` enum in `UserSchema`, `UserCreateSchema`, `UserUpdateSchema`)           |
| `src/modules/user/user.service.ts`      | #11 (Support `role` field in queries, updates, and creation)                                |
| `src/modules/user/user.controller.ts`   | #12 (Protect all `/user` routes with `authMiddleware` and `requireRole('admin')`)           |
| `src/modules/note/note.entity.ts`       | #13 (Add `userId` to `NoteSchema`, omit `userId` from client `NoteCreateSchema`)            |
| `src/modules/note/note.service.ts`      | #14 (Enforce ownership filtering: users access own notes, admins access all)                |
| `src/modules/note/note.controller.ts`   | #15 (Pass authenticated `userId` and `role` to service methods)                             |
| `src/modules/app.module.ts`             | #16 (Mount `/auth` route, register OpenAPI `BearerAuth` security scheme)                    |
| `src/db/seed.ts`                        | #17 (Seed admin user, regular user, and linked notes)                                       |
| `src/modules/auth/auth.service.test.ts` | #18 (Unit & integration tests for registration, login, and JWT) [NEW]                       |
| `src/modules/user/user.service.test.ts` | #19 (Update tests for `role` field and admin operations)                                    |
| `src/modules/note/note.service.test.ts` | #20 (Update tests for `userId` foreign key and multi-user isolation)                        |

---

## Phase 1 — Database Schema & Migration

### #1 — Add role column to users table

**Files:** `src/db/schema.ts`

**Context / Rationale:**
The authorization model requires two distinct roles: `'admin'` and `'user'`. Users must default to `'user'` on creation. Only administrators should possess `'admin'`.

**Changes:**

- [ ] Define `userRoleEnum` as `['admin', 'user'] as const`.
- [ ] Add `role` column to `userTable` with `.default('user')` and `.notNull()`.

```ts
// src/db/schema.ts

export const userRoles = ["admin", "user"] as const;
export type UserRole = (typeof userRoles)[number];

export const userTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("user"),
});
```

---

### #2 — Add userId foreign key to notes table

**Files:** `src/db/schema.ts`

**Context / Rationale:**
Currently `notes` are unowned (global). To ensure "user can only access their note", each note must be linked to a specific user via `userId` referencing `userTable.id` with cascade deletion.

**Changes:**

- [ ] Add `userId` column referencing `userTable.id` with `{ onDelete: 'cascade' }`.

```ts
// src/db/schema.ts

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
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
```

---

## Phase 2 — Core Infrastructure & JWT Utilities

### #3 — Environment configuration & JWT secrets

**Files:** `.env`, `.env.example`

**Context / Rationale:**
JWT signing requires a secure secret key and standard expiration duration configured via environment variables.

**Changes:**

- [ ] Add `JWT_SECRET` and `JWT_EXPIRES_IN` to `.env` and `.env.example`.

```env
# Authentication
JWT_SECRET=super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d
```

---

### #4 — Native JWT helper utility

**Files:** `src/utils/jwt.util.ts`

**Context / Rationale:**
Hono provides native web-standard JWT helpers in `hono/jwt` (`sign`, `verify`, `decode`). Wrapping them in a centralized utility guarantees typed payloads and uniform token generation across the application.

**Changes:**

- [ ] Define `JwtPayload` interface (`sub`, `email`, `role`, `exp`, `iat`).
- [ ] Implement `generateToken(payload: Omit<JwtPayload, 'exp' | 'iat'>): Promise<string>`.
- [ ] Implement `verifyToken(token: string): Promise<JwtPayload>`.

```ts
// src/utils/jwt.util.ts
import { sign, verify } from "hono/jwt";
import type { UserRole } from "../db/schema.ts";

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  exp: number;
  iat: number;
}

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-dev-only";
const DEFAULT_EXP_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function generateToken(
  user: { id: string; email: string; role: UserRole },
  expiresInSeconds: number = DEFAULT_EXP_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: now,
    exp: now + expiresInSeconds,
  };

  return await sign(payload, JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  return (await verify(token, JWT_SECRET)) as unknown as JwtPayload;
}
```

---

### #5 — Authentication & Role authorization middleware

**Files:** `src/middleware/auth.middleware.ts`

**Context / Rationale:**
Hono middleware must:

1. Validate incoming `Authorization: Bearer <token>` headers.
2. Verify token validity and expiration.
3. Attach the authenticated user payload (`id`, `email`, `role`) to Hono `c.set('user', ...)`.
4. Provide a declarative `requireRole('admin')` guard that checks role hierarchy and returns `403 Forbidden` for unauthorized users.

**Changes:**

- [ ] Declare `AppEnv` with typed `Variables: { user: JwtPayload }` for full TypeScript inference across controllers.
- [ ] Implement `authMiddleware`: extracts token, validates via `verifyToken`, and populates `c.set('user')`.
- [ ] Implement `requireRole(...roles: UserRole[])`: verifies `user.role` matches allowed roles, returning 403 otherwise.

```ts
// src/middleware/auth.middleware.ts
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verifyToken, type JwtPayload } from "../utils/jwt.util.ts";
import type { UserRole } from "../db/schema.ts";

export type AppEnv = {
  Variables: {
    user: JwtPayload;
  };
};

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HTTPException(401, {
      message: "Unauthorized: Missing or invalid Authorization header",
    });
  }

  const token = authHeader.slice(7).trim();
  try {
    const payload = await verifyToken(token);
    c.set("user", payload);
    await next();
  } catch {
    throw new HTTPException(401, {
      message: "Unauthorized: Invalid or expired token",
    });
  }
});

export const requireRole = (...allowedRoles: UserRole[]) => {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user || !allowedRoles.includes(user.role)) {
      throw new HTTPException(403, {
        message: "Forbidden: Insufficient role permissions",
      });
    }
    await next();
  });
};
```

---

### #6 — OpenAPI route utility enhancements

**Files:** `src/utils/route.util.ts`

**Context / Rationale:**
Protected routes return `401 Unauthorized` and `403 Forbidden` responses. Documenting these automatically in OpenAPI and adding standard `BearerAuth` security tags ensures Swagger UI reflects accurate API contracts.

**Changes:**

- [ ] Add `UnauthorizedResponse` (401) and `ForbiddenResponse` (403) to default OpenAPI responses when security is specified.
- [ ] Export `BearerAuthSecurity` helper array `[{ BearerAuth: [] }]`.

```ts
// In src/utils/route.util.ts

export const BearerAuthSecurity = [{ BearerAuth: [] }];

// Inside CreateRouteUtil.createRouteUtil:
responses: {
  [status]: {
    content: option.responseSchema
      ? { "application/json": { schema: option.responseSchema } }
      : undefined,
    description: "Success",
  },
  400: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Bad Request",
  },
  ...(this.security && {
    401: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Unauthorized",
    },
    403: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Forbidden",
    },
  }),
  404: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Not Found",
  },
  500: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Internal Server Error",
  },
}
```

---

## Phase 3 — Gateway: Authentication Module (Register & Login)

### #7 — Auth schemas & entities

**Files:** `src/modules/auth/auth.entity.ts`

**Context / Rationale:**
The gateway module needs dedicated Zod schemas for user registration, user login, and token responses with OpenAPI metadata.

**Changes:**

- [ ] `RegisterSchema`: `username`, `email`, `password` (min 6 chars). Public registration defaults to role `'user'`.
- [ ] `LoginSchema`: `email`, `password`.
- [ ] `AuthResponseSchema`: contains `token` (JWT string) and `user` object (`id`, `username`, `email`, `role`).

```ts
// src/modules/auth/auth.entity.ts
import { z } from "@hono/zod-openapi";
import { UserSchema } from "../user/user.entity.ts";

export const RegisterSchema = z
  .object({
    username: z.string().min(1).max(100).openapi({ example: "johndoe" }),
    email: z.string().email().openapi({ example: "john@example.com" }),
    password: z.string().min(6).openapi({ example: "secret123" }),
  })
  .openapi("RegisterRequest");

export const LoginSchema = z
  .object({
    email: z.string().email().openapi({ example: "john@example.com" }),
    password: z.string().min(1).openapi({ example: "secret123" }),
  })
  .openapi("LoginRequest");

export const AuthResponseSchema = z
  .object({
    token: z
      .string()
      .openapi({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }),
    user: UserSchema,
  })
  .openapi("AuthResponse");

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
```

---

### #8 — Auth service implementation

**Files:** `src/modules/auth/auth.service.ts`

**Context / Rationale:**
Encapsulate authentication logic:

1. `register`: Validate email uniqueness, hash password via `hashPassword`, insert user with `role: 'user'`, generate JWT.
2. `login`: Locate user by email, verify password hash via `verifyPassword`, generate JWT.

**Changes:**

- [ ] Create `AuthService.register(data: RegisterInput)`.
- [ ] Create `AuthService.login(data: LoginInput)`.
- [ ] Return uniform `{ token, user }` object on success.

```ts
// src/modules/auth/auth.service.ts
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { userTable } from "../../db/schema.ts";
import { hashPassword, verifyPassword } from "../../utils/hash.util.ts";
import { generateToken } from "../../utils/jwt.util.ts";
import type { RegisterInput, LoginInput, AuthResponse } from "./auth.entity.ts";

export class AuthService {
  static async register(data: RegisterInput): Promise<AuthResponse> {
    const existing = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, data.email))
      .limit(1);

    if (existing.length > 0) {
      throw new HTTPException(400, {
        message: `User with email ${data.email} already exists`,
      });
    }

    const hashedPassword = await hashPassword(data.password);

    const [newUser] = await db
      .insert(userTable)
      .values({
        username: data.username,
        email: data.email,
        password: hashedPassword,
        role: "user", // Public registration is strictly role: 'user'
      })
      .returning({
        id: userTable.id,
        username: userTable.username,
        email: userTable.email,
        role: userTable.role,
      });

    const token = await generateToken({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role as "admin" | "user",
    });

    return { token, user: newUser as any };
  }

  static async login(data: LoginInput): Promise<AuthResponse> {
    const users = await db
      .select({
        id: userTable.id,
        username: userTable.username,
        email: userTable.email,
        password: userTable.password,
        role: userTable.role,
      })
      .from(userTable)
      .where(eq(userTable.email, data.email))
      .limit(1);

    if (users.length === 0) {
      throw new HTTPException(401, { message: "Invalid email or password" });
    }

    const user = users[0];
    const isPasswordValid = await verifyPassword(data.password, user.password);

    if (!isPasswordValid) {
      throw new HTTPException(401, { message: "Invalid email or password" });
    }

    const token = await generateToken({
      id: user.id,
      email: user.email,
      role: user.role as "admin" | "user",
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role as "admin" | "user",
      },
    };
  }
}
```

---

### #9 — Auth controller (Public Gateway)

**Files:** `src/modules/auth/auth.controller.ts`

**Context / Rationale:**
As required: "user login and register no need authentication, because both of them is the gateway".
These routes are publicly accessible without `authMiddleware`. An optional `GET /auth/me` endpoint allows authenticated clients to fetch their active profile.

**Changes:**

- [ ] Mount `POST /register` with `RegisterSchema` -> 201 Created.
- [ ] Mount `POST /login` with `LoginSchema` -> 200 OK.
- [ ] Mount `GET /me` (protected) -> returns current user from context.

```ts
// src/modules/auth/auth.controller.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { AuthService } from "./auth.service.ts";
import {
  RegisterSchema,
  LoginSchema,
  AuthResponseSchema,
} from "./auth.entity.ts";
import { UserSchema } from "../user/user.entity.ts";
import { CreateRouteUtil, BearerAuthSecurity } from "../../utils/route.util.ts";
import {
  authMiddleware,
  type AppEnv,
} from "../../middleware/auth.middleware.ts";
import { UserService } from "../user/user.service.ts";

const app = new OpenAPIHono<AppEnv>();
const publicRoute = new CreateRouteUtil(["Auth"]);
const protectedRoute = new CreateRouteUtil(["Auth"], BearerAuthSecurity);

// Gateway: Register (No Auth)
app.openapi(
  publicRoute.createRouteUtil({
    method: "post",
    path: "/register",
    requestSchema: RegisterSchema,
    responseSchema: AuthResponseSchema,
    status: 201,
    description: "Public gateway: Register a new user account",
  }),
  async (c) => {
    const body = c.req.valid("json");
    const result = await AuthService.register(body);
    return c.json(result, 201);
  },
);

// Gateway: Login (No Auth)
app.openapi(
  publicRoute.createRouteUtil({
    method: "post",
    path: "/login",
    requestSchema: LoginSchema,
    responseSchema: AuthResponseSchema,
    status: 200,
    description: "Public gateway: Login with email and password",
  }),
  async (c) => {
    const body = c.req.valid("json");
    const result = await AuthService.login(body);
    return c.json(result, 200);
  },
);

// Protected: Current user profile
app.use("/me", authMiddleware);
app.openapi(
  protectedRoute.createRouteUtil({
    method: "get",
    path: "/me",
    responseSchema: UserSchema,
    description: "Get profile of current authenticated user",
  }),
  async (c) => {
    const userPayload = c.get("user");
    const user = await UserService.getUserById(userPayload.sub);
    return c.json(user);
  },
);

export default app;
```

---

## Phase 4 — Protect User Module (Admin Authorization)

### #10 — Expose role in User Entity

**Files:** `src/modules/user/user.entity.ts`

**Context / Rationale:**
The user entity must include `role` in the public API schemas so administrators can inspect and manage user privileges.

**Changes:**

- [ ] Add `role: z.enum(['admin', 'user'])` to `UserSchema`.
- [ ] Support optional `role` in `UserCreateSchema` and `UserUpdateSchema` for administrative user provisioning.

```ts
// src/modules/user/user.entity.ts
import { z } from "@hono/zod-openapi";

export const UserSchema = z
  .object({
    id: z.uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    username: z.string().min(1).max(100).openapi({ example: "johndoe" }),
    email: z.string().email().openapi({ example: "john@example.com" }),
    role: z.enum(["admin", "user"]).openapi({ example: "user" }),
  })
  .openapi("User");

export const UsersSchema = z.array(UserSchema).openapi("Users");

export const UserCreateSchema = UserSchema.omit({ id: true })
  .extend({
    password: z.string().min(6).openapi({ example: "secret123" }),
    role: z
      .enum(["admin", "user"])
      .default("user")
      .openapi({ example: "user" }),
  })
  .openapi("CreateUser");

export const UserUpdateSchema = UserSchema.omit({ id: true })
  .partial()
  .extend({
    password: z.string().min(6).optional().openapi({ example: "secret123" }),
    role: z.enum(["admin", "user"]).optional().openapi({ example: "admin" }),
  })
  .openapi("UpdateUser");
```

---

### #11 — Update User Service for role persistence

**Files:** `src/modules/user/user.service.ts`

**Context / Rationale:**
`UserService` selects, creates, and updates must persist and return the `role` field.

**Changes:**

- [ ] Include `role: userTable.role` in `getAllUsers()`, `getUserById()`, `createUser()`, `updateUser()`, and `deleteUser()`.
- [ ] In `createUser`, default `role` to `'user'` if not explicitly passed by admin.

---

### #12 — Restrict User Controller to Admin Only

**Files:** `src/modules/user/user.controller.ts`

**Context / Rationale:**
Requirement: "Only admin can access user module, user can only access their note, cannot access the user module".
By applying `authMiddleware` and `requireRole('admin')` to the entire controller, every `/user` endpoint is strictly guarded.

**Changes:**

- [ ] Initialize `OpenAPIHono<AppEnv>()`.
- [ ] Add `BearerAuthSecurity` to `CreateRouteUtil(['User'], BearerAuthSecurity)`.
- [ ] Attach `app.use('*', authMiddleware, requireRole('admin'))` at the root of the controller.

```ts
// src/modules/user/user.controller.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { UserService } from "./user.service.ts";
import {
  UserSchema,
  UsersSchema,
  UserCreateSchema,
  UserUpdateSchema,
  type User,
} from "./user.entity.ts";
import {
  CreateRouteUtil,
  IdParamSchema,
  BearerAuthSecurity,
} from "../../utils/route.util.ts";
import {
  authMiddleware,
  requireRole,
  type AppEnv,
} from "../../middleware/auth.middleware.ts";

const app = new OpenAPIHono<AppEnv>();

// Lock entire User module to Admin only
app.use("*", authMiddleware, requireRole("admin"));

const userRoute = new CreateRouteUtil(["User"], BearerAuthSecurity);

app.openapi(
  userRoute.createRouteUtil({
    method: "get",
    path: "/",
    responseSchema: UsersSchema,
    description: "Admin only: Get all users",
  }),
  async (c) => {
    const users = await UserService.getAllUsers();
    return c.json(users);
  },
);

app.openapi(
  userRoute.createRouteUtil({
    method: "post",
    path: "/",
    requestSchema: UserCreateSchema,
    responseSchema: UserSchema,
    status: 201,
    description: "Admin only: Create a new user (with role)",
  }),
  async (c) => {
    const body = c.req.valid("json");
    const user: User = await UserService.createUser(body);
    return c.json(user, 201);
  },
);

app.openapi(
  userRoute.createRouteUtil({
    method: "get",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
    description: "Admin only: Get user by ID",
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const user: User = await UserService.getUserById(id);
    return c.json(user);
  },
);

app.openapi(
  userRoute.createRouteUtil({
    method: "put",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    requestSchema: UserUpdateSchema,
    responseSchema: UserSchema,
    description: "Admin only: Update user",
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const user: User = await UserService.updateUser(id, body);
    return c.json(user);
  },
);

app.openapi(
  userRoute.createRouteUtil({
    method: "delete",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
    description: "Admin only: Delete user",
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const user: User = await UserService.deleteUser(id);
    return c.json(user);
  },
);

export default app;
```

---

## Phase 5 — Scoped Note Module (User Ownership)

### #13 — Update Note Entity with userId

**Files:** `src/modules/note/note.entity.ts`

**Context / Rationale:**
Notes must show their owner's `userId`. However, when clients create a note via `POST /note`, they should not manually pass `userId` in the body — it must be securely bound from the authenticated JWT session.

**Changes:**

- [ ] Add `userId: z.uuid()` to `NoteSchema`.
- [ ] Update `NoteCreateSchema` to omit `{ id: true, userId: true }`.

```ts
// src/modules/note/note.entity.ts
import { z } from "@hono/zod-openapi";

export const NoteSchema = z
  .object({
    id: z.uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    userId: z
      .uuid()
      .openapi({ example: "550e8400-e29b-41d4-a716-446655440001" }),
    date: z.iso.date().openapi({ example: "2024-01-15" }),
    vendor: z.string().min(1).openapi({ example: "Vendor A" }),
    name: z.string().min(1).openapi({ example: "Item Name" }),
    amount: z.number().positive().openapi({ example: 10 }),
    unit: z.string().min(1).openapi({ example: "pcs" }),
    price: z.number().nonnegative().openapi({ example: 1000 }),
    category: z.string().min(1).openapi({ example: "Electronics" }),
    totalPrice: z.number().nonnegative().openapi({ example: 10000 }),
    status: z.string().min(1).openapi({ example: "active" }),
  })
  .openapi("Note");

export const NotesSchema = z.array(NoteSchema).openapi("Notes");
export const NoteCreateSchema = NoteSchema.omit({
  id: true,
  userId: true,
}).openapi("CreateNote");
export const NoteUpdateSchema = NoteSchema.omit({ id: true, userId: true })
  .partial()
  .openapi("UpdateNote");
```

---

### #14 — Enforce Ownership in Note Service

**Files:** `src/modules/note/note.service.ts`

**Context / Rationale:**
Requirement: "user can only access their note".

- Regular users (`role === 'user'`): operations are strictly scoped to `userId`. Attempting to read, update, or delete another user's note throws `404 Not Found` (preferred over 403 to prevent resource ID enumeration).
- Administrators (`role === 'admin'`): can view and manage all notes across the system.

**Changes:**

- [ ] `getAllNotes(userId: string, role: UserRole)`: filter by `userId` if user; all notes if admin.
- [ ] `getNoteById(id: string, userId: string, role: UserRole)`: enforce ownership.
- [ ] `createNote(note: NoteCreate, userId: string)`: insert note with authenticated `userId`.
- [ ] `updateNote(id: string, updatedNote: NoteUpdate, userId: string, role: UserRole)`: enforce ownership before update.
- [ ] `deleteNote(id: string, userId: string, role: UserRole)`: enforce ownership before delete.

```ts
// src/modules/note/note.service.ts
import { HTTPException } from "hono/http-exception";
import { eq, and } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { notes } from "../../db/schema.ts";
import type { NoteCreate, NoteUpdate } from "./note.entity.ts";
import type { UserRole } from "../../db/schema.ts";

export class NoteService {
  static async getAllNotes(userId: string, role: UserRole) {
    if (role === "admin") {
      return await db.select().from(notes);
    }
    return await db.select().from(notes).where(eq(notes.userId, userId));
  }

  static async getNoteById(id: string, userId: string, role: UserRole) {
    const condition =
      role === "admin"
        ? eq(notes.id, id)
        : and(eq(notes.id, id), eq(notes.userId, userId));

    const result = await db.select().from(notes).where(condition).limit(1);

    if (result.length === 0) {
      throw new HTTPException(404, {
        message: `Note with id ${id} is not found`,
      });
    }

    return result[0];
  }

  static async createNote(note: NoteCreate, userId: string) {
    const result = await db
      .insert(notes)
      .values({
        ...note,
        userId,
        status: "pending",
      })
      .returning();

    return result[0];
  }

  static async updateNote(
    id: string,
    updatedNote: NoteUpdate,
    userId: string,
    role: UserRole,
  ) {
    // Check ownership first
    await this.getNoteById(id, userId, role);

    const result = await db
      .update(notes)
      .set(updatedNote)
      .where(eq(notes.id, id))
      .returning();
    return result[0];
  }

  static async deleteNote(id: string, userId: string, role: UserRole) {
    // Check ownership first
    await this.getNoteById(id, userId, role);

    const result = await db.delete(notes).where(eq(notes.id, id)).returning();
    return result[0];
  }
}
```

---

### #15 — Connect Authenticated Session in Note Controller

**Files:** `src/modules/note/note.controller.ts`

**Context / Rationale:**
`NoteController` must apply `authMiddleware` to all routes and pass `user.sub` (user ID) and `user.role` into `NoteService`.

**Changes:**

- [ ] Initialize `OpenAPIHono<AppEnv>()`.
- [ ] Apply `app.use('*', authMiddleware)`.
- [ ] Update route handlers to read `c.get('user')` and pass `userId` and `role` to service methods.

```ts
// src/modules/note/note.controller.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { NoteService } from "./note.service.ts";
import {
  NoteSchema,
  NotesSchema,
  NoteCreateSchema,
  NoteUpdateSchema,
  type Note,
} from "./note.entity.ts";
import {
  CreateRouteUtil,
  IdParamSchema,
  BearerAuthSecurity,
} from "../../utils/route.util.ts";
import {
  authMiddleware,
  type AppEnv,
} from "../../middleware/auth.middleware.ts";

const app = new OpenAPIHono<AppEnv>();

// All note endpoints require valid authentication
app.use("*", authMiddleware);

const noteRoute = new CreateRouteUtil(["Note"], BearerAuthSecurity);

app.openapi(
  noteRoute.createRouteUtil({
    method: "get",
    path: "/",
    responseSchema: NotesSchema,
    description: "Get notes (User sees own notes; Admin sees all)",
  }),
  async (c) => {
    const user = c.get("user");
    const notes = await NoteService.getAllNotes(user.sub, user.role);
    return c.json(notes);
  },
);

app.openapi(
  noteRoute.createRouteUtil({
    method: "post",
    path: "/",
    requestSchema: NoteCreateSchema,
    responseSchema: NoteSchema,
    status: 201,
    description: "Create a new note for the authenticated user",
  }),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const note: Note = await NoteService.createNote(body, user.sub);
    return c.json(note, 201);
  },
);

app.openapi(
  noteRoute.createRouteUtil({
    method: "get",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    responseSchema: NoteSchema,
    description: "Get note by ID (Owner or Admin only)",
  }),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const note: Note = await NoteService.getNoteById(id, user.sub, user.role);
    return c.json(note);
  },
);

app.openapi(
  noteRoute.createRouteUtil({
    method: "put",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    requestSchema: NoteUpdateSchema,
    responseSchema: NoteSchema,
    description: "Update note (Owner or Admin only)",
  }),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const note: Note = await NoteService.updateNote(
      id,
      body,
      user.sub,
      user.role,
    );
    return c.json(note);
  },
);

app.openapi(
  noteRoute.createRouteUtil({
    method: "delete",
    path: "/{id}",
    paramsSchema: IdParamSchema,
    responseSchema: NoteSchema,
    description: "Delete note (Owner or Admin only)",
  }),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const note: Note = await NoteService.deleteNote(id, user.sub, user.role);
    return c.json(note);
  },
);

export default app;
```

---

## Phase 6 — OpenAPI, App Mounting & Testing

### #16 — Mount Auth Route & Register BearerAuth in App Module

**Files:** `src/modules/app.module.ts`

**Context / Rationale:**
Mount the new `/auth` gateway module. In addition, register the OpenAPI `BearerAuth` component with `@hono/zod-openapi` so the Swagger UI at `/doc-ui` shows the authorization modal.

**Changes:**

- [ ] Import `auth` controller from `./auth/auth.controller.ts`.
- [ ] Mount `app.route('/auth', auth)`.
- [ ] Register `securitySchemes` in `app.openAPIRegistry`.

```ts
// src/modules/app.module.ts (Snippet)
import auth from "./auth/auth.controller.ts";
import common from "./common/common.controller.ts";
import note from "./note/note.controller.ts";
import user from "./user/user.controller.ts";

// Register BearerAuth component for Swagger UI
app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Enter your JWT token to authorize requests",
});

// Routes
app.route("/auth", auth);
app.route("/user", user);
app.route("/note", note);
app.route("/", common);
```

---

### #17 — Database Seed Updates

**Files:** `src/db/seed.ts`

**Context / Rationale:**
The seed script must create both an admin user and a standard user with valid Scrypt-hashed passwords, and link sample notes to the created users.

**Changes:**

- [ ] Insert default admin user: `admin@example.com` (`role: 'admin'`).
- [ ] Insert default regular user: `user@example.com` (`role: 'user'`).
- [ ] Seed notes linked with `userId: user.id`.

---

### #18 — Auth Service Unit & Integration Tests

**Files:** `src/modules/auth/auth.service.test.ts` [NEW]

**Test Scenarios:**

- [ ] Register new user & verify hashed password in DB and valid returned JWT.
- [ ] Reject registration on duplicate email with 400.
- [ ] Successful login with correct credentials & verify valid JWT with matching role.
- [ ] Reject login on incorrect password with 401.
- [ ] Reject login on non-existent email with 401.

---

### #19 — User Service & Controller Tests Updates

**Files:** `src/modules/user/user.service.test.ts`

**Test Scenarios:**

- [ ] Verify `role` defaults to `'user'` when created.
- [ ] Verify admin can create user with `role: 'admin'`.
- [ ] Verify endpoint returns 401 when unauthenticated.
- [ ] Verify endpoint returns 403 when authenticated as a regular `'user'`.
- [ ] Verify endpoint returns 200/201 when authenticated as `'admin'`.

---

### #20 — Note Ownership Isolation Tests

**Files:** `src/modules/note/note.service.test.ts`

**Test Scenarios:**

- [ ] Note creation associates note with authenticated `userId`.
- [ ] User A cannot see User B's notes in `getAllNotes`.
- [ ] User A gets 404 when trying to read User B's note by ID.
- [ ] User A cannot update or delete User B's note.
- [ ] Admin can view, update, and delete notes belonging to any user.

---

## Execution Order

| Step | Task                                                  | Files                                                | Depends on  |
| ---- | ----------------------------------------------------- | ---------------------------------------------------- | ----------- |
| 1    | Update database schema (`role` and `userId`)          | `src/db/schema.ts`                                   | —           |
| 2    | Push schema changes to test/dev database              | Shell (`npx drizzle-kit push`)                       | Step 1      |
| 3    | Add environment variables                             | `.env`, `.env.example`                               | —           |
| 4    | Implement JWT utility                                 | `src/utils/jwt.util.ts`                              | Step 3      |
| 5    | Implement Auth & RBAC Middleware                      | `src/middleware/auth.middleware.ts`                  | Step 4      |
| 6    | Enhance `CreateRouteUtil` (401/403 & BearerAuth)      | `src/utils/route.util.ts`                            | —           |
| 7    | Implement Auth Entity, Service & Controller (Gateway) | `src/modules/auth/*`                                 | Steps 4, 5  |
| 8    | Update User Entity & Service for role                 | `src/modules/user/user.entity.ts`, `user.service.ts` | Step 1      |
| 9    | Lock User Controller to Admin                         | `src/modules/user/user.controller.ts`                | Steps 5, 8  |
| 10   | Update Note Entity & Service for user ownership       | `src/modules/note/note.entity.ts`, `note.service.ts` | Step 1      |
| 11   | Scope Note Controller to authenticated session        | `src/modules/note/note.controller.ts`                | Steps 5, 10 |
| 12   | Mount Auth module & configure OpenAPI Swagger         | `src/modules/app.module.ts`                          | Steps 7, 9  |
| 13   | Update database seeds                                 | `src/db/seed.ts`                                     | Steps 1, 8  |
| 14   | Implement and run comprehensive test suite            | `*.test.ts` (Auth, User, Note)                       | All steps   |

---
