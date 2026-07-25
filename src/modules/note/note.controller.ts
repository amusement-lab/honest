import { OpenAPIHono } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'

import { NoteService } from './note.service.ts'
import { NoteSchema, NotesSchema, NoteCreateSchema, NoteUpdateSchema, type Note, type NoteCreate, type NoteUpdate } from './note.entity.ts'
import { CreateRouteUtil } from '../../utils/route.util.ts'

const app = new OpenAPIHono()

const noteRoute = new CreateRouteUtil(['Note'])

const IdParamSchema = z.object({
  id: z.string().uuid().openapi({
    param: { name: 'id', in: 'path' },
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
})

app.openapi(
  noteRoute.createRouteUtil({
    method: 'get',
    path: '/',
    responseSchema: NotesSchema,
  }),
  async (c) => {
    const notes = await NoteService.getAllNote()
    return c.json(notes)
  })

app.openapi(
  noteRoute.createRouteUtil({
    method: 'post',
    path: '/',
    requestSchema: NoteCreateSchema,
    responseSchema: NoteSchema,
    status: 201,
  }),
  async (c) => {
    const body: NoteCreate = NoteCreateSchema.parse(await c.req.json())
    const note: Note = await NoteService.createNote(body)
    return c.json(note, 201)
  })

app.openapi(
  noteRoute.createRouteUtil({
    method: 'get',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: NoteSchema,
  }),
  async (c) => {
    const id = c.req.param('id')!
    const note: Note = await NoteService.getNoteById(id)
    return c.json(note)
  })

app.openapi(
  noteRoute.createRouteUtil({
    method: 'put',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    requestSchema: NoteUpdateSchema,
    responseSchema: NoteSchema,
  }),
  async (c) => {
    const id = c.req.param('id')!
    const body: NoteUpdate = NoteUpdateSchema.parse(await c.req.json())
    const note: Note = await NoteService.updateNote(id, body)
    return c.json(note)
  })

app.openapi(
  noteRoute.createRouteUtil({
    method: 'delete',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: NoteSchema,
  }),
  async (c) => {
    const id = c.req.param('id')!
    const note: Note = await NoteService.deleteNote(id)
    return c.json(note)
  })

export default app
