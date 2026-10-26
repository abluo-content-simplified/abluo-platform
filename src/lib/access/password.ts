/**
 * Site Access — shared-password hashing (ADR-040 §5). Server-only (Node crypto).
 *
 * scrypt, no new dependency. Stored self-describing so parameters can be raised
 * later and every row still verifies with the parameters it was made with:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
 *
 * The plaintext is received once, hashed, and discarded: never stored, never
 * logged, never returned, never shown again.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'crypto'
import { ACCESS_LIMITS } from './model'

export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const
/** Upper bounds accepted when READING a stored hash — a corrupt row cannot make us burn the CPU. */
const MAX_N = 2 ** 17
const MAX_R = 16
const MAX_P = 4

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, { ...options, maxmem: 256 * options.N! * options.r! }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  })
}

export type PasswordProblem = 'too_short' | 'too_long' | 'blank'

/** Policy for a NEW shared password. Members type it from an email, so length beats symbols. */
export function checkNewPassword(password: string): PasswordProblem | null {
  if (typeof password !== 'string' || password.trim().length === 0) return 'blank'
  if ([...password].length < ACCESS_LIMITS.passwordMinLength) return 'too_short'
  if ([...password].length > ACCESS_LIMITS.passwordMaxLength) return 'too_long'
  return null
}

/** Unicode-normalised so the same password typed on two devices hashes the same. */
function normalize(password: string): string {
  return password.normalize('NFKC')
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_PARAMS.saltLength)
  const { N, r, p, keyLength } = SCRYPT_PARAMS
  const key = await scrypt(normalize(password), salt, keyLength, { N, r, p })
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

type Parsed = { N: number; r: number; p: number; salt: Buffer; key: Buffer }

export function parsePasswordHash(stored: string): Parsed | null {
  if (typeof stored !== 'string') return null
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [N, r, p] = parts.slice(1, 4).map((x) => Number.parseInt(x, 10))
  if (![N, r, p].every(Number.isInteger)) return null
  if (N < 2 ** 14 || N > MAX_N || (N & (N - 1)) !== 0 || r < 1 || r > MAX_R || p < 1 || p > MAX_P) return null
  const salt = Buffer.from(parts[4], 'base64url')
  const key = Buffer.from(parts[5], 'base64url')
  if (salt.length < 16 || key.length < 32) return null
  return { N, r, p, salt, key }
}

/**
 * Constant-time verify. A malformed stored hash verifies false (after doing
 * the same amount of work), never throws to the caller.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored)
  if (!parsed || typeof password !== 'string' || [...password].length > ACCESS_LIMITS.passwordMaxLength) {
    await burnOneVerification()
    return false
  }
  const key = await scrypt(normalize(password), parsed.salt, parsed.key.length, { N: parsed.N, r: parsed.r, p: parsed.p })
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key)
}

/** The same work as one real verification — used when there is nothing to verify against. */
export async function burnOneVerification(): Promise<void> {
  const { N, r, p, keyLength } = SCRYPT_PARAMS
  await scrypt('abluo-site-access-dummy', DUMMY_SALT, keyLength, { N, r, p })
}
const DUMMY_SALT = Buffer.alloc(SCRYPT_PARAMS.saltLength, 7)
