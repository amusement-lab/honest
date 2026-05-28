import { z } from '@hono/zod-openapi'

export const NoteSchema = z.object({
  id: z.uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  date: z.iso.date().openapi({ example: '2024-01-15' }),
  vendor: z.string().min(1).openapi({ example: 'Vendor A' }),
  name: z.string().min(1).openapi({ example: 'Item Name' }),
  amount: z.number().positive().openapi({ example: 10 }),
  unit: z.string().min(1).openapi({ example: 'pcs' }),
  price: z.number().nonnegative().openapi({ example: 1000 }),
  category: z.string().min(1).openapi({ example: 'Electronics' }),
  totalPrice: z.number().nonnegative().openapi({ example: 10000 }),
  status: z.string().min(1).openapi({ example: 'active' }),
}).openapi('Note')

export const NotesSchema = z.array(NoteSchema).openapi('Notes')
export const NoteCreateSchema = NoteSchema.omit({ id: true }).openapi('CreateNote')
export const NoteUpdateSchema = NoteSchema.omit({ id: true }).partial().openapi('UpdateNote')

export type Note = z.infer<typeof NoteSchema>
export type Notes = z.infer<typeof NotesSchema>
export type NoteCreate = z.infer<typeof NoteCreateSchema>
export type NoteUpdate = z.infer<typeof NoteUpdateSchema>
