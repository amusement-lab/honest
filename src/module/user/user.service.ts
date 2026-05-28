import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'

import { db } from '../../db/index.ts'
import { userTable } from '../../db/schema.ts'
import type { User, UserCreate, UserUpdate } from './user.entity.ts'

class UserService {
  static async getAllUser() {
    return db.select({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    }).from(userTable)
  }

  static async getUserById(id: string) {
    const result = await db.select({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    }).from(userTable).where(eq(userTable.id, id)).limit(1)

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `User with id ${id} is not found` }
    )

    return result[0]
  }

  static async createUser(user: UserCreate) {
    const existing = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, user.email)).limit(1)
    if (existing.length > 0) throw new HTTPException(
      400,
      { message: `User with email ${user.email} already exists` }
    )

    const result = await db.insert(userTable).values({
      username: user.username,
      email: user.email,
      password: user.password,
    }).returning({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    })

    return result[0]
  }

  static async updateUser(id: string, updatedUser: UserUpdate) {
    const existing = await db.select({ id: userTable.id, email: userTable.email }).from(userTable).where(eq(userTable.id, id)).limit(1)
    if (existing.length === 0) throw new HTTPException(
      404,
      { message: `User with id ${id} is not found` }
    )

    if (updatedUser.email && updatedUser.email !== existing[0].email) {
      const duplicate = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, updatedUser.email)).limit(1)
      if (duplicate.length > 0) throw new HTTPException(
        400,
        { message: `User with email ${updatedUser.email} already exists` }
      )
    }

    const values: Partial<typeof userTable.$inferInsert> = {}
    if (updatedUser.username !== undefined) values.username = updatedUser.username
    if (updatedUser.email !== undefined) values.email = updatedUser.email
    if (updatedUser.password !== undefined) values.password = updatedUser.password

    const result = await db.update(userTable).set(values).where(eq(userTable.id, id)).returning({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    })

    return result[0]
  }

  static async deleteUser(id: string) {
    const result = await db.delete(userTable).where(eq(userTable.id, id)).returning({
      id: userTable.id,
      username: userTable.username,
      email: userTable.email,
    })

    if (result.length === 0) throw new HTTPException(
      404,
      { message: `User with id ${id} is not found` }
    )

    return result[0]
  }
}

export { UserService }
