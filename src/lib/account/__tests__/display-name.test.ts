import { describe, expect, it } from 'vitest'
import { DISPLAY_NAME_MAX, normalizeDisplayName } from '@/lib/account/display-name'

describe('normalizeDisplayName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeDisplayName('  Paolo   Martegani ')).toEqual({ ok: true, name: 'Paolo Martegani' })
    expect(normalizeDisplayName('Anna\tMaria\nRossi')).toEqual({ ok: true, name: 'Anna Maria Rossi' })
  })

  it('refuses empty and whitespace-only names, and non-strings', () => {
    for (const raw of ['', '   ', '\n\t', undefined, null, 42]) {
      expect(normalizeDisplayName(raw)).toEqual({ ok: false, error: 'empty' })
    }
  })

  it('accepts 1 to 80 characters, counted as characters (not UTF-16 units)', () => {
    expect(normalizeDisplayName('A')).toEqual({ ok: true, name: 'A' })
    expect(normalizeDisplayName('a'.repeat(DISPLAY_NAME_MAX))).toMatchObject({ ok: true })
    expect(normalizeDisplayName('a'.repeat(DISPLAY_NAME_MAX + 1))).toEqual({ ok: false, error: 'tooLong' })
    // 80 emoji = 160 UTF-16 units, still 80 characters.
    expect(normalizeDisplayName('😀'.repeat(DISPLAY_NAME_MAX))).toMatchObject({ ok: true })
    // Surrounding whitespace does not count.
    expect(normalizeDisplayName(`  ${'b'.repeat(DISPLAY_NAME_MAX)}  `)).toMatchObject({ ok: true })
  })

  it('keeps accents, apostrophes and non-Latin scripts', () => {
    for (const name of ['José Álvarez', "Dott. D'Angelo", 'Zoë Müller-Lüdenscheidt', '山田 太郎', 'Ἀλέξανδρος']) {
      expect(normalizeDisplayName(name)).toEqual({ ok: true, name })
    }
  })

  it('refuses control characters and bidi overrides', () => {
    for (const raw of ['Tom\u0000', 'Tom\u0007x', 'Tom\u202Eevil', 'a\u2066b', 'x\u007f']) {
      expect(normalizeDisplayName(raw)).toEqual({ ok: false, error: 'invalid' })
    }
  })
})
