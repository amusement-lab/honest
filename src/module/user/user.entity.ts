import { z } from '@hono/zod-openapi'

export const UserSchema = z.object({
  id: z.uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  username: z.string().min(1).max(100).openapi({ example: 'johndoe' }),
  email: z.string().email().openapi({ example: 'john@example.com' }),
}).openapi('User')

export const UsersSchema = z.array(UserSchema).openapi('Users')

export const UserCreateSchema = UserSchema.omit({ id: true }).extend({
  password: z.string().min(6).openapi({ example: 'secret123' }),
}).openapi('CreateUser')

export const UserUpdateSchema = UserSchema.omit({ id: true }).partial().extend({
  password: z.string().min(6).optional().openapi({ example: 'secret123' }),
}).openapi('UpdateUser')

export type User = z.infer<typeof UserSchema>
export type Users = z.infer<typeof UsersSchema>
export type UserCreate = z.infer<typeof UserCreateSchema>
export type UserUpdate = z.infer<typeof UserUpdateSchema>
