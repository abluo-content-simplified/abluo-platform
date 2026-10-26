/**
 * ADR-040 B2.5 / R9 — the Access screen as the server renders it: the groups list,
 * read-only for support visits and people without "Manage access", the
 * "almost ready" state while the tables are not installed, never a password
 * or a hash, and every message present in English, Italian and German.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlMessageFormat } from 'intl-messageformat'
import en from '../../../../../messages/en.json'
import it_ from '../../../../../messages/it.json'
import de from '../../../../../messages/de.json'

const BUNDLES: Record<string, unknown> = { en, it: it_, de }
const state = vi.hoisted(() => ({ locale: 'en', used: new Set<string>() }))

vi.mock('next-intl', () => ({
  useLocale: () => state.locale,
  useTranslations: (ns: string) => (key: string, args: Record<string, unknown> = {}) => {
    const full = `${ns}.${key}`
    state.used.add(full)
    const msg = full.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], BUNDLES[state.locale])
    if (typeof msg !== 'string') throw new Error(`missing message ${state.locale}:${full}`)
    return String(new IntlMessageFormat(msg, state.locale).format(args as never))
  },
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/[locale]/(client)/[tenant]/access/actions', () => ({}))

import { AccessScreen } from '../AccessScreen'
import type { AccessDashboardData } from '@/lib/access/dashboard'

const G1 = '11111111-1111-4111-8111-111111111111'
const G2 = '22222222-2222-4222-8222-222222222222'
const data: AccessDashboardData = {
  notReady: false,
  groups: [
    { id: G1, name: 'Genitori', archived: false, passwords: [{ id: 'c1', label: 'Genitori', inUse: true, changedAt: '2026-10-01T10:00:00Z' }], signedIn: 3, opens: { pages: 2, documents: 1 } },
    { id: G2, name: 'Consiglio', archived: false, passwords: [], signedIn: 0, opens: { pages: 0, documents: 0 } },
  ],
  signedInTotal: 3,
  limits: { passwordMinLength: 10, passwordMaxLength: 200, nameMax: 80 },
}

const render = (over: Partial<Parameters<typeof AccessScreen>[0]> = {}) =>
  renderToStaticMarkup(<AccessScreen projectSlug="site-a" data={data} canManage supportVisit={false} {...over} />)

describe('the Access screen', () => {
  it('lists the groups with what they open, the signed-in line and the actions an administrator needs — no tabs', () => {
    state.locale = 'en'
    const html = render()
    expect(html).toContain('Access')
    expect(html).not.toMatch(/role="tablist"/)
    expect(html).toContain('Genitori')
    expect(html).toContain('2 pages · 1 document')
    expect(html).toContain('3 visitors are signed in right now.')
    expect(html).toMatch(/>Sign out everyone<\/button>/)
    expect(html).toContain('New group')
    expect(html).toContain('No password') // Consiglio
    expect(html).not.toContain('Add document')
  })

  it('never renders a password or a hash', () => {
    const html = render()
    expect(html).not.toMatch(/scrypt\$|passwordHash/)
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/)
  })

  it('a support visit is read-only and says why', () => {
    const html = render({ canManage: false, supportVisit: true })
    expect(html).toContain('You are visiting as Abluo support')
    expect(html).not.toContain('New group')
    expect(html).not.toMatch(/>Sign out everyone<\/button>/)
    expect(html).not.toMatch(/>Set a password<\/button>/)
  })

  it('without Manage access: read-only, with who to ask', () => {
    const html = render({ canManage: false })
    expect(html).toContain('needs the Manage access permission')
    expect(html).not.toContain('New group')
  })

  it('while the tables are not installed: a calm "almost ready" notice and nothing else', () => {
    const html = render({ data: { notReady: true } })
    expect(html).toContain('Access is almost ready')
    expect(html).not.toContain('Genitori')
  })

  it('every message it uses exists in English, Italian and German', () => {
    for (const locale of ['en', 'it', 'de']) {
      state.locale = locale
      expect(() => render()).not.toThrow()
      expect(() => render({ canManage: false, supportVisit: true })).not.toThrow()
      expect(() => render({ data: { notReady: true } })).not.toThrow()
    }
    state.locale = 'en'
  })

  it('the three bundles carry exactly the same Access and Documents keys', () => {
    const keys = (o: unknown, p = ''): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
    for (const ns of ['access', 'documents'] as const) {
      const of = (b: unknown) => keys((b as { clientDashboard: Record<string, unknown> }).clientDashboard[ns]).sort()
      expect(of(it_)).toEqual(of(en))
      expect(of(de)).toEqual(of(en))
    }
  })
})
