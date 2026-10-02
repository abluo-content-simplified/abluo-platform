import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { buildFormCtaHandler } from '../useFormCtaHandler'
import type { ResolvedCta } from '@/lib/sanity/types'

const formCta = {
  type: 'form',
  label: 'Request early access',
  internalName: 'Steps closing — Early Access',
  formId: 'early-access',
} as ResolvedCta

function overlay() {
  return { open: vi.fn(), close: vi.fn(), request: null, tenantSlug: 'abluo', locale: 'en', forms: [] }
}

describe('buildFormCtaHandler', () => {
  it('opens the CTA form in the overlay with source attribution', () => {
    const o = overlay()
    const handler = buildFormCtaHandler(formCta, o as never, 'steps_section')
    expect(handler).toBeTypeOf('function')
    handler!()
    expect(o.open).toHaveBeenCalledWith({
      formId: 'early-access',
      source: {
        source: 'steps_section',
        cta_internal_name: 'Steps closing — Early Access',
        cta_label_snapshot: 'Request early access',
      },
    })
  })

  it('forwards authored context only when present', () => {
    const o = overlay()
    buildFormCtaHandler({ ...formCta, context: { plan: 'pro' } } as ResolvedCta, o as never, 's')!()
    expect(o.open.mock.calls[0][0].context).toEqual({ plan: 'pro' })
  })

  it('no handler for link CTAs, missing CTAs, or pages without an overlay', () => {
    const link = { type: 'link', label: 'x', internalName: 'x', href: '/x', external: false } as ResolvedCta
    expect(buildFormCtaHandler(link, overlay() as never, 's')).toBeUndefined()
    expect(buildFormCtaHandler(null, overlay() as never, 's')).toBeUndefined()
    expect(buildFormCtaHandler(formCta, null, 's')).toBeUndefined()
  })
})

// The bug class: a section renders <CtaButton> for a form CTA but never passes
// onFormClick, so the button renders and does nothing (the Steps section's
// closing CTA, QA 2026-10-02). Every <CtaButton> in a component must be wired.
describe('every CtaButton is wired to the form overlay', () => {
  const root = resolve(__dirname, '../..')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (name !== '__tests__') walk(p)
      } else if (p.endsWith('.tsx') && !p.endsWith('CtaButton.tsx')) files.push(p)
    }
  }
  walk(root)

  const users = files.filter((f) => readFileSync(f, 'utf8').includes('<CtaButton'))

  it('finds the components that render CtaButton', () => {
    expect(users.length).toBeGreaterThanOrEqual(7)
  })

  it.each(users.map((f) => [f.slice(root.length + 1), f]))('%s passes onFormClick to every CtaButton', (_n, file) => {
    const src = readFileSync(file as string, 'utf8')
    const openings = src.split('<CtaButton').slice(1).map((b) => b.slice(0, b.search(/\/>|\n\s*>/)))
    expect(openings.length).toBeGreaterThan(0)
    for (const tag of openings) expect(tag).toContain('onFormClick=')
  })
})
