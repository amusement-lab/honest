import { OpenAPIHono } from '@hono/zod-openapi'

import { NoteService } from './note.service.ts'
import { NoteSchema, NotesSchema, NoteCreateSchema, NoteUpdateSchema, type Note } from './note.entity.ts'
import { CreateRouteUtil, IdParamSchema } from '../../utils/route.util.ts'

const app = new OpenAPIHono()

const noteRoute = new CreateRouteUtil(['Note'])

app.openapi(
  noteRoute.createRouteUtil({
    method: 'get',
    path: '/',
    responseSchema: NotesSchema,
  }),
  async (c) => {
    const notes = await NoteService.getAllNotes()
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
    const body = c.req.valid('json')
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
    const { id } = c.req.valid('param')
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
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
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
    const { id } = c.req.valid('param')
    const note: Note = await NoteService.deleteNote(id)
    return c.json(note)
  })

export default app
