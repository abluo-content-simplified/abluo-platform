/**
 * Interface translations — a WARNING, never a failure (Tom, 2026-10-22).
 *
 * Missing or outdated dashboard text in Italian/German is printed here so it
 * shows in the test output; scripts/i18n-translate.mjs fills it (release.sh
 * runs it) and the admin Translations page lists it. Until then the dashboard
 * shows English for that text, which is safe.
 *
 * What DOES fail: the shared core (hash, ICU signature, nesting) being wrong,
 * and the status file being malformed — those would make the page lie.
 */
import { describe, expect, it } from 'vitest'
import { interfaceBundles, interfaceTranslationStatus } from '../interface-messages'
import { buildTranslationReport, cellState } from '../translation-report'
import { flattenMessages, formatStatus, hashText, messageSignature, nestLike, parseStatus, serializeStatus } from '../translation-core.mjs'

describe('interface translations (warning only)', () => {
  it('reports missing, outdated and unchecked machine translations', () => {
    const report = buildTranslationReport(interfaceBundles(), interfaceTranslationStatus())
    for (const s of report.summary) {
      const open = s.missing + s.outdated
      if (open || s.machine) {
        const sample = report.rows
          .filter((r) => ['missing', 'outdated'].includes(r.cells[s.locale].state))
          .slice(0, 10)
          .map((r) => `${r.key} (${r.cells[s.locale].state})`)
        console.warn(
          `[i18n] ${s.locale}: ${s.missing} missing, ${s.outdated} outdated, ${s.machine} machine-translated (unchecked) of ${s.total}` +
            (sample.length ? `\n  ${sample.join('\n  ')}` : ''),
        )
      }
    }
    expect(report.rows.length).toBeGreaterThan(0)
  })

  it('every status entry is well-formed', () => {
    for (const [locale, entries] of Object.entries(interfaceTranslationStatus())) {
      for (const [key, value] of Object.entries(entries)) expect(parseStatus(value), `${locale} ${key}`).not.toBeNull()
    }
  })
})

describe('translation core', () => {
  it('hashes stably', () => {
    expect(hashText('Save')).toBe(hashText('Save'))
    expect(hashText('Save')).not.toBe(hashText('Save '))
    expect(hashText('')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('signature keeps arguments and tags, ignores words inside plural branches', () => {
    const en = '{shown} of {total, plural, one {# item} other {# items}}'
    const it = '{shown} di {total, plural, one {# elemento} other {# elementi}}'
    expect(messageSignature(en)).toBe(messageSignature(it))
    expect(messageSignature('{n, plural, one {one post} other {# posts by {author}}}')).toBe('author,n|')
    expect(messageSignature('Hello <b>{name}</b>')).toBe('name|b')
    expect(messageSignature('Hello {name}')).not.toBe(messageSignature('Ciao'))
    expect(messageSignature('{role, select, owner {Owner} other {Other}}')).toBe('role|')
  })

  it('nestLike follows the source order and keeps extra keys', () => {
    const source = { a: { x: '1', y: '2' }, b: '3' }
    const out = nestLike(source, { 'b': 'B', 'a.y': 'Y', 'a.x': 'X', 'z.q': 'Q' })
    expect(JSON.stringify(out)).toBe(JSON.stringify({ a: { x: 'X', y: 'Y' }, b: 'B', z: { q: 'Q' } }))
    expect(flattenMessages(out)).toEqual({ 'a.x': 'X', 'a.y': 'Y', b: 'B', 'z.q': 'Q' })
  })

  it('status round-trips', () => {
    expect(parseStatus(formatStatus('machine', 'Save'))).toEqual({ s: 'machine', h: hashText('Save') })
    expect(parseStatus('nonsense')).toBeNull()
    expect(JSON.parse(serializeStatus({ it: { b: 'original:00000000', a: 'machine:11111111' } }))).toEqual({
      it: { a: 'machine:11111111', b: 'original:00000000' },
    })
  })

  it('cell states: missing > outdated > machine > ok', () => {
    const h = hashText('Save')
    expect(cellState(null, 'Save', undefined)).toBe('missing')
    expect(cellState('', 'Save', { s: 'original', h })).toBe('missing')
    expect(cellState('Salva', 'Save changes', { s: 'machine', h })).toBe('outdated')
    expect(cellState('Salva', 'Save', { s: 'machine', h })).toBe('machine')
    expect(cellState('Salva', 'Save', { s: 'original', h })).toBe('ok')
    expect(cellState('Salva', 'Save', undefined)).toBe('ok')
  })
})
