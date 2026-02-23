import { z } from '@hono/zod-openapi'

export const NoteSchema = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  vendor: z.string().min(1),
  name: z.string().min(1),
  amount: z.number().positive(),
  unit: z.string().min(1),
  price: z.number().nonnegative(),
  category: z.string().min(1),
  totalPrice: z.number().nonnegative(),
}).openapi('Note')

export const NotesSchema = z.array(NoteSchema).openapi('Notes');
export const NoteCreateSchema = NoteSchema.omit({ id: true }).openapi('CreateNote');
export const NoteUpdateSchema = NoteSchema.omit({ id: true }).partial().openapi('UpdateNote');

export type Note = z.infer<typeof NoteSchema>;
export type Notes = z.infer<typeof NotesSchema>;
export type NoteCreate = z.infer<typeof NoteCreateSchema>;
export type NoteUpdate = z.infer<typeof NoteUpdateSchema>;
