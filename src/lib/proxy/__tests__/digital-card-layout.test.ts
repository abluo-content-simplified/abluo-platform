/**
 * ADR-049 D10 — the website layout's bare Digital Cards branch, read from the
 * source (the layout is an async server component with a dozen data reads;
 * rendering it here would test the fakes). Pins: the marker is the proxy's
 * header, the branch runs before every per-tenant branch, and it mounts
 * nothing that sets cookies, loads trackers or draws site chrome.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const src = readFileSync(resolve(__dirname, '../../../app/[locale]/(website)/[tenant]/layout.tsx'), 'utf8')

function bareBranch(): string {
  const start = src.indexOf('if (digitalCard) {')
  expect(start).toBeGreaterThan(0)
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error('unbalanced')
}

describe('bare Digital Cards layout', () => {
  it('is keyed on the proxy marker', () => {
    expect(src).toMatch(/import \{ DIGITAL_CARD_HEADER \} from '@\/lib\/proxy\/digital-card'/)
    expect(src).toMatch(/const digitalCard = requestHeaders\.get\(DIGITAL_CARD_HEADER\) === '1'/)
  })

  it('runs after the design system is resolved and before the Livener and generic branches', () => {
    const at = src.indexOf('if (digitalCard) {')
    expect(src.indexOf('resolveDesignSystemInheritance(rawDesignSystem')).toBeLessThan(at)
    expect(at).toBeLessThan(src.indexOf("if (tenantId === 'livener')"))
    expect(at).toBeLessThan(src.indexOf('// ── Generic layout'))
  })

  it('renders only the design system, the page gradient and the card', () => {
    const branch = bareBranch()
    expect(branch).toContain('<DesignSystemHead')
    expect(branch).toContain('<PageGradientBackdrop')
    expect(branch).toContain('<main>{children}</main>')
    for (const forbidden of ['ConsentProvider', 'TrackingScripts', 'FirstTouchRecorder', '<Footer', 'NavClient', 'Masthead', 'whatsAppFab', 'MembersStatusBar', 'FormOverlayWrapper']) {
      expect(branch, forbidden).not.toContain(forbidden)
    }
  })
})
