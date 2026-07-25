import { serve } from '@hono/node-server'

import app from './modules/app.module.ts'

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
