import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'

import { db } from '../../db/index.ts'
import { notes } from '../../db/schema.ts'
import type { Note, NoteCreate, NoteUpdate } from './note.entity.ts'

class NoteService {
  static async getAllNote() {
    const result = await db.select().from(notes)
    return result.map(r => ({
      ...r,
      amount: Number(r.amount),
      price: Number(r.price),
      totalPrice: Number(r.totalPrice),
      status: r.status,
    }))
  }

  static async getNoteById(id: string) {
    const result = await db.select().from(notes).where(eq(notes.id, id)).limit(1)

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `Note with id ${id} is not found` }
    )

    const r = result[0]
    return {
      ...r,
      amount: Number(r.amount),
      price: Number(r.price),
      totalPrice: Number(r.totalPrice),
      status: r.status,
    }
  }

  static async createNote(note: NoteCreate) {
    const result = await db.insert(notes).values({
      ...note,
      amount: String(note.amount),
      price: String(note.price),
      totalPrice: String(note.totalPrice),
      status: 'pending',
    }).returning()

    const r = result[0]
    return {
      ...r,
      amount: Number(r.amount),
      price: Number(r.price),
      totalPrice: Number(r.totalPrice),
      status: 'active',
    }
  }

  static async updateNote(id: string, updatedNote: NoteUpdate) {
    const values: Record<string, unknown> = { ...updatedNote }
    if (values.amount !== undefined) values.amount = String(values.amount)
    if (values.price !== undefined) values.price = String(values.price)
    if (values.totalPrice !== undefined) values.totalPrice = String(values.totalPrice)

    const result = await db.update(notes).set(values).where(eq(notes.id, id)).returning()

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `Note with id ${id} is not found` }
    )

    const r = result[0]
    return {
      ...r,
      amount: Number(r.amount),
      price: Number(r.price),
      totalPrice: Number(r.totalPrice),
      status: r.status,
    }
  }

  static async deleteNote(id: string) {
    const result = await db.delete(notes).where(eq(notes.id, id)).returning()

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `Note with id ${id} is not found` }
    )

    const r = result[0]
    return {
      ...r,
      amount: Number(r.amount),
      price: Number(r.price),
      totalPrice: Number(r.totalPrice),
      status: r.status,
    }
  }
}

export { NoteService }
