// Test helper: a well-formed link token and its hash, the way the real ones are made.
import { createHash } from 'crypto'
import { mintToken } from '../../service/types'
import { counterBytes } from '../../service/__tests__/fake-store'

export const mintManagementToken = (seed: number) => mintToken({ randomBytes: counterBytes(seed) }).token
export const hashToken = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
