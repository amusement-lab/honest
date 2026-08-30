import { scryptAsync } from '@noble/hashes/scrypt.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'

const SCRYPT_OPTS = {
  N: 16384, // 2**14 CPU/memory cost
  r: 8,     // block size
  p: 1,     // parallelization
  dkLen: 32, // derived key length
}

/**
 * Hashes a plaintext password using the Scrypt algorithm from @noble/hashes.
 * Returns a serialized string in the format `${saltHex}:${derivedKeyHex}`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derivedKey = await scryptAsync(password, salt, SCRYPT_OPTS)
  
  const saltHexString = String(bytesToHex(salt))
  const derivedKeyHexString = String(bytesToHex(derivedKey))
  
  return `${saltHexString}:${derivedKeyHexString}`
}


/**
 * Verifies a plaintext password against a stored Scrypt hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':')
  if (parts.length !== 2) return false

  const [saltHexString, derivedKeyHexString] = parts
  if (!saltHexString || !derivedKeyHexString) return false

  try {
    const salt = hexToBytes(saltHexString)
    const expectedKey = hexToBytes(derivedKeyHexString)

    const derivedKey = await scryptAsync(password, salt, {
      ...SCRYPT_OPTS,
      dkLen: expectedKey.length,
    })

    if (derivedKey.length !== expectedKey.length) return false

    // Constant-time comparison
    let diff = 0
    for (let i = 0; i < derivedKey.length; i++) {
      diff |= derivedKey[i] ^ expectedKey[i]
    }
    return diff === 0
  } catch {
    return false
  }
}

export const hash = hashPassword
export const verify = verifyPassword

