/** Render smoke test: the resolved CTA renders heading, text and the right button. */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useParams: () => ({ locale: 'it', tenant: 'hoffmann' }), useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/sanity/client', () => ({ tenantClient: () => ({ fetchForTenant: async () => [] }) }))

import { PostCallToAction, PostCallToActionView } from '@/components/blog/PostCallToAction'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'

const tenant = asUrlProjectSegment('hoffmann')

describe('PostCallToAction', () => {
  it('renders a phone CTA as a tel: link with the site button classes', () => {
    const html = renderToStaticMarkup(
      <PostCallToActionView
        tenantSlug={tenant}
        locale="it"
        cta={{
          id: 'cta-call',
          internalName: 'Call',
          heading: 'Chiamami',
          text: 'Rispondo sempre.',
          buttonLabel: 'Chiama',
          target: { kind: 'link', href: 'tel:+390541123456', internal: false, external: false },
        }}
      />
    )
    expect(html).toContain('Chiamami')
    expect(html).toContain('Rispondo sempre.')
    expect(html).toContain('href="tel:+390541123456"')
    expect(html).toContain('--btn-primary-bg')
  })

  it('internal links get the locale/tenant prefix; a form CTA renders a pop-up trigger', () => {
    const link = renderToStaticMarkup(
      <PostCallToActionView
        tenantSlug={tenant}
        locale="it"
        cta={{ id: 'cta-p', internalName: 'p', heading: 'H', text: null, buttonLabel: 'Vai', target: { kind: 'link', href: '/contatti', internal: true, external: false } }}
      />
    )
    expect(link).toContain('href="/it/hoffmann/contatti"')
    const form = renderToStaticMarkup(
      <PostCallToActionView
        tenantSlug={tenant}
        locale="it"
        form={{ formId: 'contact', title: 'Contatto' } as never}
        cta={{ id: 'cta-f', internalName: 'f', heading: 'H', text: null, buttonLabel: 'Scrivimi', target: { kind: 'form', formId: 'contact' } }}
      />
    )
    expect(form).toMatch(/<button[^>]*type="button"[^>]*>Scrivimi<\/button>/)
  })

  it('"none" and a site without CTAs render nothing', async () => {
    expect(await PostCallToAction({ tenantSlug: tenant, locale: 'it', cta: { mode: 'none' } })).toBeNull()
    expect(await PostCallToAction({ tenantSlug: tenant, locale: 'it', cta: null })).toBeNull()
    expect(await PostCallToAction({ tenantSlug: tenant, locale: 'it', cta: null, ctas: [] })).toBeNull()
  })
})
