import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INTERFACE_LOCALES, LOCALE_CODES } from '../locales'

const MESSAGES = join(__dirname, '../../../../messages')

describe('INTERFACE_LOCALES', () => {
  it('lists exactly the locales that have a messages bundle', () => {
    const bundles = readdirSync(MESSAGES)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
    expect([...INTERFACE_LOCALES].sort()).toEqual(bundles)
  })

  it('is a subset of the platform locales', () => {
    for (const code of INTERFACE_LOCALES) expect(LOCALE_CODES).toContain(code)
  })
})
