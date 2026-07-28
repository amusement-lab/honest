import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NoteService } from './note.service.ts'
import { db } from '../../db/index.ts'
import { notes } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'

describe('NoteService', () => {
  let createdId: string

  afterAll(async () => {
    await db.delete(notes)
  })

  it('should create a note with pending status', async () => {
    const note = await NoteService.createNote({
      date: '2024-01-01',
      vendor: 'Test Vendor',
      name: 'Test Note',
      amount: 10,
      unit: 'pcs',
      price: 1000,
      category: 'Test',
      totalPrice: 10000,
      status: 'pending',
    })

    expect(note).toHaveProperty('id')
    expect(note.vendor).toBe('Test Vendor')
    expect(note.status).toBe('pending')
    expect(typeof note.amount).toBe('number')
    expect(typeof note.price).toBe('number')
    expect(typeof note.totalPrice).toBe('number')

    createdId = note.id
  })

  it('should get all notes', async () => {
    const allNotes = await NoteService.getAllNote()
    expect(allNotes.length).toBeGreaterThan(0)
    expect(allNotes[0]).toHaveProperty('id')
    expect(typeof allNotes[0].status).toBe('string')
  })

  it('should get note by id', async () => {
    const note = await NoteService.getNoteById(createdId)
    expect(note.id).toBe(createdId)
    expect(note.vendor).toBe('Test Vendor')
    expect(typeof note.status).toBe('string')
  })

  it('should throw 404 when note not found', async () => {
    await expect(NoteService.getNoteById('550e8400-e29b-41d4-a716-446655440000')).rejects.toBeInstanceOf(HTTPException)
  })

  it('should update a note', async () => {
    const updated = await NoteService.updateNote(createdId, {
      vendor: 'Updated Vendor',
    })

    expect(updated.vendor).toBe('Updated Vendor')
    expect(typeof updated.status).toBe('string')
  })

  it('should delete a note', async () => {
    const deleted = await NoteService.deleteNote(createdId)
    expect(deleted.id).toBe(createdId)

    const remaining = await db.select().from(notes).where(eq(notes.id, createdId))
    expect(remaining.length).toBe(0)
  })
})
