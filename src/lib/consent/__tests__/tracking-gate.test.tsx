import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/deployment', () => ({ isProduction: () => true }))

import { TrackingScripts } from '@/components/TrackingScripts'
import type { ProjectIntegrations } from '@/lib/sanity/types'

const data: ProjectIntegrations = {
  integrationConfigs: [
    { integrationId: 'google-analytics', enabled: true, values: { measurementId: 'G-TEST123' } },
    { integrationId: 'meta-pixel', enabled: true, values: { pixelId: '999' } },
    {
      integrationId: 'custom-scripts', enabled: true, values: { scripts: [
        { label: 'nec', code: 'window.NEC=1', enabled: true, consentCategory: 'necessary' },
        { label: 'ana', code: 'window.ANA=1', enabled: true, consentCategory: 'analytics' },
      ] },
    },
  ],
}

const html = (g?: { analytics: boolean; marketing: boolean; functional: boolean }) =>
  renderToStaticMarkup(<TrackingScripts data={data} grants={g} />)

describe('TrackingScripts × consent (ADR-021)', () => {
  it('no grants → nothing gated loads; necessary still does', () => {
    const out = html()
    expect(out).not.toContain('G-TEST123')
    expect(out).not.toContain('fbq')
    expect(out).not.toContain('window.ANA')
    expect(out).toContain('window.NEC')
  })
  it('analytics only → GA4 + analytics script, no Meta', () => {
    const out = html({ analytics: true, marketing: false, functional: false })
    expect(out).toContain('G-TEST123')
    expect(out).toContain('window.ANA')
    expect(out).not.toContain('fbq')
  })
  it('marketing only → Meta, no GA4', () => {
    const out = html({ analytics: false, marketing: true, functional: false })
    expect(out).toContain('fbq')
    expect(out).not.toContain('G-TEST123')
  })
  it('kill switch beats consent', () => {
    const out = renderToStaticMarkup(
      <TrackingScripts data={{ ...data, privacy: { trackingKillSwitch: true } }} grants={{ analytics: true, marketing: true, functional: true }} />
    )
    expect(out).toBe('')
  })
})
