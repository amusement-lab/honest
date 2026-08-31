import { OpenAPIHono } from '@hono/zod-openapi'
import { CreateRouteUtil } from '../../utils/route.util.ts'

const app = new OpenAPIHono()

const commonRoute = new CreateRouteUtil(['Common'])

app.openapi(
  commonRoute.createRouteUtil({
    method: 'get',
    path: '/',
  }),
  (c) => {
    return c.json({ message: 'Hono API is starting' })
  })

export default app

