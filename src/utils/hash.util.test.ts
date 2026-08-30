import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './hash.util.ts'

describe('hash utility', () => {
  it('should hash a password and return salt:hash format', async () => {
    const password = 'mySecretPassword123'
    const hash = await hashPassword(password)

    expect(hash).toBeDefined()
    expect(hash).toContain(':')
    const parts = hash.split(':')
    expect(parts.length).toBe(2)
    expect(parts[0].length).toBe(32) // 16 bytes hex
    expect(parts[1].length).toBe(64) // 32 bytes hex
  })

  it('should verify a valid password against its hash', async () => {
    const password = 'mySecretPassword123'
    const hash = await hashPassword(password)

    const isValid = await verifyPassword(password, hash)
    expect(isValid).toBe(true)
  })

  it('should reject an incorrect password', async () => {
    const password = 'mySecretPassword123'
    const hash = await hashPassword(password)

    const isValid = await verifyPassword('wrongPassword', hash)
    expect(isValid).toBe(false)
  })

  it('should return false for invalid hash formats', async () => {
    expect(await verifyPassword('password', 'invalidhash')).toBe(false)
    expect(await verifyPassword('password', ':')).toBe(false)
    expect(await verifyPassword('password', 'nothex:nothex')).toBe(false)
  })

  it('should produce different hashes for the same password due to random salt', async () => {
    const password = 'samePassword'
    const hash1 = await hashPassword(password)
    const hash2 = await hashPassword(password)

    expect(hash1).not.toBe(hash2)
    expect(await verifyPassword(password, hash1)).toBe(true)
    expect(await verifyPassword(password, hash2)).toBe(true)
  })
})

