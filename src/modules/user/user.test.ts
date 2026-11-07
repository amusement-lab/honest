import { eq } from 'drizzle-orm'
import { describe, it, expect, beforeEach } from 'vitest'

import { db } from '../../db/index.ts'
import { userTable } from '../../db/schema.ts'
import { verifyPassword } from '../../utils/hash.util.ts'
import { app, jsonRequest, rawRequest, readJson } from '../../test/http.ts'
import { resetDatabase } from '../../test/db.ts'

const MISSING_ID = '550e8400-e29b-41d4-a716-446655440000'

type UserBody = { id: string; username: string; email: string; password?: string }
/** Success payload or the `{ message }` error envelope. */
type UserResponse = UserBody & { message?: string }

function userPayload(overrides: Record<string, unknown> = {}) {
  return {
    username: 'johndoe',
    email: 'john@example.com',
    password: 'secret123',
    ...overrides,
  }
}

async function createUser(overrides: Record<string, unknown> = {}) {
  const res = await jsonRequest('POST', '/user', userPayload(overrides))
  return { res, body: await readJson<UserResponse>(res) }
}

beforeEach(async () => {
  await resetDatabase()
})

describe('POST /user', () => {
  it('should create a user and return 201 without the password', async () => {
    const { res, body } = await createUser()

    expect(res.status).toBe(201)
    expect(body).toMatchObject({ username: 'johndoe', email: 'john@example.com' })
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body).not.toHaveProperty('password')
  })

  it('should store the password hashed, never in plain text', async () => {
    const { body } = await createUser()

    const [row] = await db.select().from(userTable).where(eq(userTable.id, body.id))
    expect(row.password).not.toBe('secret123')
    expect(row.password).toContain(':')
    await expect(verifyPassword('secret123', row.password)).resolves.toBe(true)
  })

  it('should return 400 when the email is already registered', async () => {
    await createUser()

    const { res, body } = await createUser({ username: 'janedoe' })

    expect(res.status).toBe(400)
    expect(body.message).toContain('already exists')
  })

  it('should return 400 when the email is malformed', async () => {
    const { res, body } = await createUser({ email: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(body.message).toContain('email')
  })

  it('should return 400 when the password is shorter than 6 characters', async () => {
    const { res, body } = await createUser({ password: '123' })

    expect(res.status).toBe(400)
    expect(body.message).toContain('password')
  })

  it('should return 400 when a required field is missing', async () => {
    const res = await jsonRequest('POST', '/user', { email: 'a@b.com', password: 'secret123' })

    expect(res.status).toBe(400)
    expect((await readJson(res)).message).toContain('username')
  })

  it('should return 415 when the content type is not JSON', async () => {
    const res = await rawRequest('POST', '/user', 'text/plain', 'not json')
    expect(res.status).toBe(415)
  })

  it('should return 400 when there is no body and no Content-Type header', async () => {
    // Regression: see note.http.test.ts for the full explanation.
    const res = await app.request('/user', { method: 'POST' })

    expect(res.status).toBe(400)
    expect((await readJson(res)).message).toContain('username')
  })
})

describe('GET /user', () => {
  it('should return an empty list when there are no users', async () => {
    const res = await jsonRequest('GET', '/user')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([])
  })

  it('should return all users without passwords', async () => {
    await createUser()
    await createUser({ username: 'janedoe', email: 'jane@example.com' })

    const res = await jsonRequest('GET', '/user')
    const body = await readJson<UserBody[]>(res)

    expect(res.status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body.map(u => u.email).sort()).toEqual(['jane@example.com', 'john@example.com'])
    for (const user of body) expect(user).not.toHaveProperty('password')
  })
})

describe('GET /user/{id}', () => {
  it('should return the requested user', async () => {
    const { body: created } = await createUser()

    const res = await jsonRequest('GET', `/user/${created.id}`)
    const body = await readJson<UserBody>(res)

    expect(res.status).toBe(200)
    expect(body).toEqual({ id: created.id, username: 'johndoe', email: 'john@example.com' })
  })

  it('should return 404 when the user does not exist', async () => {
    const res = await jsonRequest('GET', `/user/${MISSING_ID}`)
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body.message).toContain(MISSING_ID)
  })

  it('should return 400 when the id is not a UUID', async () => {
    const res = await jsonRequest('GET', '/user/not-a-uuid')

    expect(res.status).toBe(400)
    expect((await readJson(res)).message).toContain('id')
  })
})

describe('PUT /user/{id}', () => {
  it('should update the username', async () => {
    const { body: created } = await createUser()

    const res = await jsonRequest('PUT', `/user/${created.id}`, { username: 'johndoe_updated' })
    const body = await readJson<UserBody>(res)

    expect(res.status).toBe(200)
    expect(body).toEqual({
      id: created.id,
      username: 'johndoe_updated',
      email: 'john@example.com',
    })
  })

  it('should re-hash the password when it is updated', async () => {
    const { body: created } = await createUser()

    const res = await jsonRequest('PUT', `/user/${created.id}`, { password: 'newSecret456' })
    expect(res.status).toBe(200)

    const [row] = await db.select().from(userTable).where(eq(userTable.id, created.id))
    await expect(verifyPassword('newSecret456', row.password)).resolves.toBe(true)
    await expect(verifyPassword('secret123', row.password)).resolves.toBe(false)
  })

  it('should return 400 when the new email belongs to another user', async () => {
    const { body: first } = await createUser()
    await createUser({ username: 'janedoe', email: 'jane@example.com' })

    const res = await jsonRequest('PUT', `/user/${first.id}`, { email: 'jane@example.com' })

    expect(res.status).toBe(400)
    expect((await readJson(res)).message).toContain('already exists')
  })

  it('should return 404 when the user does not exist', async () => {
    const res = await jsonRequest('PUT', `/user/${MISSING_ID}`, { username: 'ghost' })

    expect(res.status).toBe(404)
  })

  it('should return 400 when the body is invalid', async () => {
    const { body: created } = await createUser()

    const res = await jsonRequest('PUT', `/user/${created.id}`, { email: 'nope' })

    expect(res.status).toBe(400)
    expect((await readJson(res)).message).toContain('email')
  })
})

describe('DELETE /user/{id}', () => {
  it('should delete the user and remove the row', async () => {
    const { body: created } = await createUser()

    const res = await jsonRequest('DELETE', `/user/${created.id}`)
    const body = await readJson<UserBody>(res)

    expect(res.status).toBe(200)
    expect(body.id).toBe(created.id)

    const remaining = await db.select().from(userTable).where(eq(userTable.id, created.id))
    expect(remaining).toHaveLength(0)
  })

  it('should return 404 when deleting the same user twice', async () => {
    const { body: created } = await createUser()

    await jsonRequest('DELETE', `/user/${created.id}`)
    const res = await jsonRequest('DELETE', `/user/${created.id}`)

    expect(res.status).toBe(404)
  })

  it('should return 400 when the id is not a UUID', async () => {
    const res = await jsonRequest('DELETE', '/user/123')

    expect(res.status).toBe(400)
  })
})
