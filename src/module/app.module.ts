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
  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status)
  }

  if (err instanceof Error) {
    console.error(err.cause)
    return c.json({ message: err.message }, 500)
  }

  return c.json({ message: 'Internal Server Error' }, 500)
})

export default app
