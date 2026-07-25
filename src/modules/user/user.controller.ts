import { OpenAPIHono } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'

import { UserService } from './user.service.ts'
import { UserSchema, UsersSchema, UserCreateSchema, UserUpdateSchema, type User, type UserCreate, type UserUpdate } from './user.entity.ts'
import { CreateRouteUtil } from '../../utils/route.util.ts'

const app = new OpenAPIHono()

const userRoute = new CreateRouteUtil(['User'])

const IdParamSchema = z.object({
  id: z.string().uuid().openapi({
    param: { name: 'id', in: 'path' },
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
})

app.openapi(
  userRoute.createRouteUtil({
    method: 'get',
    path: '/',
    responseSchema: UsersSchema,
  }),
  async (c) => {
    const users = await UserService.getAllUser()
    return c.json(users)
  })

app.openapi(
  userRoute.createRouteUtil({
    method: 'post',
    path: '/',
    requestSchema: UserCreateSchema,
    responseSchema: UserSchema,
    status: 201,
  }),
  async (c) => {
    const body: UserCreate = UserCreateSchema.parse(await c.req.json())
    const user: User = await UserService.createUser(body)
    return c.json(user, 201)
  })

app.openapi(
  userRoute.createRouteUtil({
    method: 'get',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const id = c.req.param('id')!
    const user: User = await UserService.getUserById(id)
    return c.json(user)
  })

app.openapi(
  userRoute.createRouteUtil({
    method: 'put',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    requestSchema: UserUpdateSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const id = c.req.param('id')!
    const body: UserUpdate = UserUpdateSchema.parse(await c.req.json())
    const user: User = await UserService.updateUser(id, body)
    return c.json(user)
  })

app.openapi(
  userRoute.createRouteUtil({
    method: 'delete',
    path: '/{id}',
    paramsSchema: IdParamSchema,
    responseSchema: UserSchema,
  }),
  async (c) => {
    const id = c.req.param('id')!
    const user: User = await UserService.deleteUser(id)
    return c.json(user)
  })

export default app
