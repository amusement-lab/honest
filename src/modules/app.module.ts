import { HTTPException } from 'hono/http-exception'
import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'

import common from './common/common.controller.ts'
import note from './note/note.controller.ts'
import user from './user/user.controller.ts'

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

app.doc('/doc', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'My API',
  },
})
app.get('/doc-ui', swaggerUI({ url: '/doc' }))

app.route('/user', user)
app.route('/note', note)
app.route('/', common)

app.onError((err, c) => {
  console.error(JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    method: c.req.method,
    url: c.req.url,
  }));

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

  // SQLite constraint violations (thrown by better-sqlite3)
  if (
    err instanceof Error &&
    ("code" in err || err.message.includes("UNIQUE constraint failed"))
  ) {
    const errorWithCode = err as Error & { code?: string };
    if (
      errorWithCode.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      errorWithCode.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      err.message.includes("UNIQUE constraint failed")
    ) {
      return c.json({ message: "Resource already exists" }, 409);
    }
    if (
      errorWithCode.code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
      err.message.includes("FOREIGN KEY constraint failed")
    ) {
      return c.json({ message: "Referenced resource not found" }, 400);
    }
  }

  return c.json({ message: "Internal Server Error" }, 500);
})

export default app
