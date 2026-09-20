### About

I love NestJS and their workflow, but sadly, Cloudflare is not compatible with NestJS.
This project is a template to mimic the NestJS workflow.

### Architecture

This template mimics NestJS's **folder structure** and **separation of concerns** (controllers, services, entities) while staying lightweight and modular.

#### Currently Implemented

- Module-based folder structure (`src/modules/`)
- Separation of concerns: controllers, services, entities
- Auto-generated OpenAPI/Swagger docs (`/doc-ui`)
- Global error handling (including SQLite constraint violations)
- Drizzle ORM + SQLite (`better-sqlite3`)
- Route utility (`CreateRouteUtil`) for standardized route definitions
- User module (full CRUD with hashed passwords)
- Note module (full CRUD)
- Automated Vitest test suite with global SQLite setup/teardown

#### Planned Enhancements

- Dependency Injection / IoC container
- Decorator-based routing (`@Get`, `@Post`, `@Controller`, `@Injectable`)
- Guards (authentication, role-based access)
- Interceptors (logging, response transformation)
- Pipes (automatic Zod validation)
- Exception filters (per-controller error handling)

### Dependencies Version

- `nodejs` >= `22.0.0`
- `pnpm` >= `10.0.0`
- `hono` >= `4.13.0`
- `zod` >= `4.0.0`

### Getting Started

#### Installation

```bash
pnpm install
```

#### Environment Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Contents of `.env`:

```env
DATABASE_URL=./sqlite.db
DATABASE_URL_TEST=./sqlite.test.db
```

#### Database Setup

This project uses `drizzle-orm` with `better-sqlite3` and `drizzle-kit` for schema management:

1. **Push schema to local SQLite database:**

   ```bash
   pnpm run db:push
   ```

2. **(Optional) Generate migration files:**

   ```bash
   pnpm run db:generate
   ```

3. **(Optional) Seed sample data:**

   ```bash
   pnpm run db:seed
   ```

4. **(Optional) Open Drizzle Studio UI:**
   ```bash
   pnpm run db:studio
   ```

For more options, refer to the [Drizzle ORM SQLite Documentation](https://orm.drizzle.team/docs/get-started/sqlite-new).

#### Development & Testing

- **Start development server:**
  ```bash
  pnpm run dev
  ```
- **Run test suite:**
  ```bash
  pnpm test
  ```
- **Interactive Swagger Documentation:**
  Open `http://localhost:3000/doc-ui` in your browser.
