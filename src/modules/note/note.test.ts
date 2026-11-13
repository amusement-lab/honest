import { eq } from 'drizzle-orm'
import { describe, it, expect, beforeEach } from 'vitest'

import { db } from '../../db/index.ts'
import { notes } from '../../db/schema.ts'
import { app, jsonRequest, rawRequest, readJson } from '../../test/http.ts'
import { resetDatabase } from '../../test/db.ts'
import type { Note } from './note.entity.ts'

const MISSING_ID = '550e8400-e29b-41d4-a716-446655440000'

/** The `{ message }` envelope produced by `app.onError`. */
type ErrorBody = { message: string }

function notePayload(overrides: Record<string, unknown> = {}) {
  return {
    date: '2024-01-01',
    vendor: 'Test Vendor',
    name: 'Test Note',
    amount: 10,
    unit: 'pcs',
    price: 1000,
    category: 'Test',
    totalPrice: 10_000,
    ...overrides,
  }
}

async function createNote(overrides: Record<string, unknown> = {}) {
  const res = await jsonRequest('POST', '/note', notePayload(overrides))
  return { res, body: await readJson<Note>(res) }
}

beforeEach(async () => {
  await resetDatabase()
})

describe('POST /note', () => {
  it('should create a note with pending status', async () => {
    const { res, body } = await createNote()

    expect(res.status).toBe(201)
    expect(body).toMatchObject({
      vendor: 'Test Vendor',
      name: 'Test Note',
      status: 'pending',
    })
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof body.amount).toBe('number')
    expect(typeof body.price).toBe('number')
    expect(typeof body.totalPrice).toBe('number')
  })

  it('should ignore a client-supplied status and force pending', async () => {
    const { body } = await createNote({ status: 'approved' })
    expect(body.status).toBe('pending')
  })

  it('should return 400 when a required field is missing', async () => {
    const res = await jsonRequest('POST', '/note', { vendor: 'Only Vendor' })

    expect(res.status).toBe(400)
    expect((await readJson<ErrorBody>(res)).message).toContain('date')
  })

  it('should return 400 when amount is not positive', async () => {
    const { res } = await createNote({ amount: 0 })
    expect(res.status).toBe(400)
  })

  it('should return 400 when price is negative', async () => {
    const { res } = await createNote({ price: -1 })
    expect(res.status).toBe(400)
  })

  it('should return 400 when the date is not ISO formatted', async () => {
    const { res } = await createNote({ date: '01-01-2024' })
    expect(res.status).toBe(400)
  })

  it('should return 415 when the content type is not JSON', async () => {
    const res = await rawRequest('POST', '/note', 'text/plain', 'not json')
    expect(res.status).toBe(415)
  })

  it('should return 400 when the JSON body is empty', async () => {
    const res = await jsonRequest('POST', '/note', undefined)
    expect(res.status).toBe(400)
  })

  it('should return 400 when there is no body and no Content-Type header', async () => {
    // Regression: without `required: true` on the route body, zod-openapi
    // skipped validation and the empty object reached the database, which
    // surfaced as a 500 instead of a 400.
    const res = await app.request('/note', { method: 'POST' })

    expect(res.status).toBe(400)
    expect((await readJson<ErrorBody>(res)).message).toContain('date')
  })
})

describe('GET /note', () => {
  it('should return an empty list when there are no notes', async () => {
    const res = await jsonRequest('GET', '/note')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([])
  })

  it('should return all notes', async () => {
    await createNote()
    await createNote({ name: 'Second Note', vendor: 'Vendor B' })

    const res = await jsonRequest('GET', '/note')
    const body = await readJson<Note[]>(res)

    expect(res.status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body.map(n => n.name).sort()).toEqual(['Second Note', 'Test Note'])
  })
})

describe('GET /note/{id}', () => {
  it('should return the requested note', async () => {
    const { body: created } = await createNote()

    const res = await jsonRequest('GET', `/note/${created.id}`)
    const body = await readJson<Note>(res)

    expect(res.status).toBe(200)
    expect(body).toEqual(created)
  })

  it('should return 404 when the note does not exist', async () => {
    const res = await jsonRequest('GET', `/note/${MISSING_ID}`)
    const body = await readJson<ErrorBody>(res)

    expect(res.status).toBe(404)
    expect(body.message).toContain(MISSING_ID)
  })

  it('should return 400 when the id is not a UUID', async () => {
    const res = await jsonRequest('GET', '/note/not-a-uuid')

    expect(res.status).toBe(400)
    expect((await readJson<ErrorBody>(res)).message).toContain('id')
  })
})

describe('PUT /note/{id}', () => {
  it('should update only the provided fields', async () => {
    const { body: created } = await createNote()

    const res = await jsonRequest('PUT', `/note/${created.id}`, { vendor: 'Updated Vendor' })
    const body = await readJson<Note>(res)

    expect(res.status).toBe(200)
    expect(body.vendor).toBe('Updated Vendor')
    expect(body.name).toBe('Test Note')
    expect(body.status).toBe('pending')
  })

  it('should persist the update in the database', async () => {
    const { body: created } = await createNote()

    await jsonRequest('PUT', `/note/${created.id}`, { amount: 42 })

    const [row] = await db.select().from(notes).where(eq(notes.id, created.id))
    expect(row.amount).toBe(42)
  })

  it('should return 404 when the note does not exist', async () => {
    const res = await jsonRequest('PUT', `/note/${MISSING_ID}`, { vendor: 'Ghost' })

    expect(res.status).toBe(404)
  })

  it('should return 400 when the body is invalid', async () => {
    const { body: created } = await createNote()

    const res = await jsonRequest('PUT', `/note/${created.id}`, { amount: -5 })

    expect(res.status).toBe(400)
  })

  it('should return 400 when the body is empty', async () => {
    // Regression: `db.update().set({})` throws "No values to set", which used
    // to surface as a 500 instead of a 400.
    const { body: created } = await createNote()

    const res = await jsonRequest('PUT', `/note/${created.id}`, {})
    const body = await readJson<ErrorBody>(res)

    expect(res.status).toBe(400)
    expect(body.message).toContain('No fields to update')
  })

  it('should return 400 for an empty body even when the note does not exist', async () => {
    const res = await jsonRequest('PUT', `/note/${MISSING_ID}`, {})

    expect(res.status).toBe(400)
    expect((await readJson<ErrorBody>(res)).message).toContain('No fields to update')
  })

  it('should leave the row unchanged after an empty-body update', async () => {
    const { body: created } = await createNote()

    await jsonRequest('PUT', `/note/${created.id}`, {})

    const [row] = await db.select().from(notes).where(eq(notes.id, created.id))
    expect(row).toEqual(created)
  })
})

describe('DELETE /note/{id}', () => {
  it('should delete the note and remove the row', async () => {
    const { body: created } = await createNote()

    const res = await jsonRequest('DELETE', `/note/${created.id}`)
    const body = await readJson<Note>(res)

    expect(res.status).toBe(200)
    expect(body.id).toBe(created.id)

    const remaining = await db.select().from(notes).where(eq(notes.id, created.id))
    expect(remaining).toHaveLength(0)
  })

  it('should return 404 when deleting the same note twice', async () => {
    const { body: created } = await createNote()

    await jsonRequest('DELETE', `/note/${created.id}`)
    const res = await jsonRequest('DELETE', `/note/${created.id}`)

    expect(res.status).toBe(404)
  })

  it('should return 400 when the id is not a UUID', async () => {
    const res = await jsonRequest('DELETE', '/note/123')

    expect(res.status).toBe(400)
  })
})
