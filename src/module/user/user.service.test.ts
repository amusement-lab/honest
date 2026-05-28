import { describe, it, expect, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { UserService } from './user.service'
import { db } from '../../db/index.ts'
import { userTable } from '../../db/schema.ts'
import { HTTPException } from 'hono/http-exception'

describe('UserService', () => {
  let createdId: string

  afterAll(async () => {
    await db.delete(userTable)
  })

  it('should create a user', async () => {
    const user = await UserService.createUser({
      username: 'johndoe',
      email: 'john@example.com',
      password: 'secret123',
    })

    expect(user).toHaveProperty('id')
    expect(user.username).toBe('johndoe')
    expect(user.email).toBe('john@example.com')
    expect(user).not.toHaveProperty('password')

    createdId = user.id
  })

  it('should throw 400 when creating user with duplicate email', async () => {
    await expect(UserService.createUser({
      username: 'janedoe',
      email: 'john@example.com',
      password: 'secret456',
    })).rejects.toBeInstanceOf(HTTPException)
  })

  it('should get all users', async () => {
    const allUsers = await UserService.getAllUser()
    expect(allUsers.length).toBeGreaterThan(0)
    expect(allUsers[0]).toHaveProperty('id')
    expect(allUsers[0]).not.toHaveProperty('password')
  })

  it('should get user by id', async () => {
    const user = await UserService.getUserById(createdId)
    expect(user.id).toBe(createdId)
    expect(user.username).toBe('johndoe')
    expect(user).not.toHaveProperty('password')
  })

  it('should throw 404 when user not found', async () => {
    await expect(UserService.getUserById('550e8400-e29b-41d4-a716-446655440000')).rejects.toBeInstanceOf(HTTPException)
  })

  it('should update a user', async () => {
    const updated = await UserService.updateUser(createdId, {
      username: 'johndoe_updated',
    })

    expect(updated.username).toBe('johndoe_updated')
    expect(updated.email).toBe('john@example.com')
  })

  it('should throw 404 when updating non-existent user', async () => {
    await expect(UserService.updateUser('550e8400-e29b-41d4-a716-446655440000', {
      username: 'ghost',
    })).rejects.toBeInstanceOf(HTTPException)
  })

  it('should throw 400 when updating user with duplicate email', async () => {
    await UserService.createUser({
      username: 'janedoe',
      email: 'jane@example.com',
      password: 'secret789',
    })

    await expect(UserService.updateUser(createdId, {
      email: 'jane@example.com',
    })).rejects.toBeInstanceOf(HTTPException)
  })

  it('should delete a user', async () => {
    const { id: secondUserId } = await UserService.createUser({
      username: 'deleteme',
      email: 'delete@example.com',
      password: 'secret000',
    })

    const deleted = await UserService.deleteUser(secondUserId)
    expect(deleted.id).toBe(secondUserId)

    const remaining = await db.select().from(userTable).where(eq(userTable.id, secondUserId))
    expect(remaining.length).toBe(0)
  })

  it('should throw 404 when deleting non-existent user', async () => {
    await expect(UserService.deleteUser('550e8400-e29b-41d4-a716-446655440000')).rejects.toBeInstanceOf(HTTPException)
  })
})
