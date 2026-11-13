import { describe, it, expect } from 'vitest'

import { app } from '../../utils/test.util.ts'

describe('GET /', () => {
  it('should return the API greeting', async () => {
    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    await expect(res.json()).resolves.toEqual({ message: 'Hono API is starting' })
  })
})

describe('OpenAPI docs', () => {
  it('should serve the OpenAPI document', async () => {
    const res = await app.request('/doc')

    expect(res.status).toBe(200)
    const doc = await res.json() as { openapi: string; info: { title: string }; paths: Record<string, unknown> }

    expect(doc.openapi).toBe('3.0.0')
    expect(doc.info.title).toBe('My API')
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/', '/user', '/user/{id}', '/note', '/note/{id}']),
    )
  })

  it('should serve the Swagger UI page', async () => {
    const res = await app.request('/doc-ui')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})

describe('Unknown routes', () => {
  it('should return 404 for an unregistered path', async () => {
    const res = await app.request('/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('should return 404 for an unsupported method on a known path', async () => {
    const res = await app.request('/note', { method: 'PATCH' })
    expect(res.status).toBe(404)
  })
})
