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
DATABASE_URL=./db/data/sqlite.db
DATABASE_URL_TEST=./db/data/sqlite.test.db
```

#### Database Setup

This project uses `drizzle-orm` with `better-sqlite3` and `drizzle-kit` for schema management. `src/db/schema.ts` is the schema you edit; the SQL files in `drizzle/` are the history that tests and production apply.

1. **Create the database folder and apply migrations:**

   ```bash
   mkdir -p db/data
   pnpm run db:migrate
   ```

   > `db/data/` is gitignored, so it does not exist on a fresh clone. `drizzle-kit`
   > cannot create the folder, and the app no longer creates it for you.

2. **After changing `src/db/schema.ts`, generate and apply a migration:**

   ```bash
   pnpm run db:generate
   pnpm run db:migrate
   ```

   Commit the new files in `drizzle/`. Tests rebuild their database by applying these migrations, so a schema change that was never generated will not reach them.

3. **(Optional) Seed sample data:**

   ```bash
   pnpm run db:seed
   ```

4. **(Optional) Open Drizzle Studio UI:**
   ```bash
   pnpm run db:studio
   ```

##### Direct schema sync (test/scratch databases only)

There is no `db:push` script. To inject `schema.ts` straight into a throwaway database without creating migration files, run `drizzle-kit` directly:

```bash
DATABASE_URL=./db/data/sqlite.test.db pnpm exec drizzle-kit push
```

This introspects the target database, diffs it against `schema.ts`, and executes the DDL immediately. It writes no migration files and no `__drizzle_migrations` history, so `db:migrate` will not know what it did. Point `DATABASE_URL` at a scratch database — never at `db/data/sqlite.db` — and use `--verbose` to inspect the SQL before it runs. Avoid `--force`, which auto-approves data-loss statements.

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
- **Typecheck the project:**
  ```bash
  pnpm run typecheck
  ```
- **Interactive Swagger Documentation:**
  Open `http://localhost:3000/doc-ui` in your browser.
