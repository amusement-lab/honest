import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'

import { db } from '../../db/index.ts'
import { notes } from '../../db/schema.ts'
import type { NoteCreate, NoteUpdate } from './note.entity.ts'

class NoteService {
  static async getAllNote() {
    return await db.select().from(notes)
  }

  static async getNoteById(id: string) {
    const result = await db.select().from(notes).where(eq(notes.id, id)).limit(1)

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `Note with id ${id} is not found` }
    )

    return result[0]
  }

  static async createNote(note: NoteCreate) {
    const result = await db.insert(notes).values({
      ...note,
      status: 'pending',
    }).returning()

    return result[0]
  }

  static async updateNote(id: string, updatedNote: NoteUpdate) {
    const result = await db.update(notes).set(updatedNote).where(eq(notes.id, id)).returning()

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `Note with id ${id} is not found` }
    )

    return result[0]
  }

  static async deleteNote(id: string) {
    const result = await db.delete(notes).where(eq(notes.id, id)).returning()

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `Note with id ${id} is not found` }
    )

    return result[0]
  }
}

export { NoteService }
