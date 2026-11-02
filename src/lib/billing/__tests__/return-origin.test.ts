import { describe, it, expect } from 'vitest'
import { trustedReturnOrigin } from '../return-origin'

describe('trustedReturnOrigin', () => {
  const env = { VERCEL_URL: 'abluo-git-dev-tmz.vercel.app' }
  it.each([
    ['https://admin.abluo.app', 'https://admin.abluo.app'],
    ['https://abluo.app', 'https://abluo.app'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['https://abluo-git-dev-tmz.vercel.app', 'https://abluo-git-dev-tmz.vercel.app'],
  ])('%s is trusted', (o, want) => expect(trustedReturnOrigin(o, env)).toBe(want))
  it.each([
    'https://evil.example', 'https://abluo.app.evil.example', 'https://evilabluo.app', 'http://admin.abluo.app',
    'https://other.vercel.app', 'https://admin.abluo.app:8443', 'https://u:p@admin.abluo.app', 'not a url', '', null,
  ])('%s is refused', (o) => expect(trustedReturnOrigin(o as string | null, env)).toBeNull())
})
