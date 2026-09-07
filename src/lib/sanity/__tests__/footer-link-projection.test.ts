import { describe, it, expect } from 'vitest'
import { websiteSiteConfigQuery } from '@/lib/sanity/queries'

// The defect: footerLinks[] carried an inline copy of the nav-link projection
// that omitted "pageSlug". Internal footer links therefore resolved to nothing
// and fell back to the tenant home — fifteen links on one site all pointing at
// the homepage, while the nav links beside them worked.

describe('footer links resolve their page references', () => {
  const q = websiteSiteConfigQuery as string

  it('projects pageSlug for footerLinks', () => {
    const footer = q.slice(q.indexOf('footerLinks[]'))
    expect(footer.slice(0, 400)).toContain('pageSlug')
  })

  it('dereferences pageRef the same way navLinks does', () => {
    const derefs = [...q.matchAll(/pageRef->slug\[\$locale\]\.current/g)]
    // navLinks, footerLinks, footerColumns[].links, headerCta — every place a
    // link can point at a page document.
    expect(derefs.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps nav and footer link shapes identical', () => {
    const shape = (name: string) => {
      const body = q.slice(q.indexOf(`${name}[]`))
      return ['label', 'linkType', 'pageSlug', 'internalPage', 'externalUrl', 'anchorId']
        .filter((f) => body.slice(0, 400).includes(f))
    }
    expect(shape('footerLinks')).toEqual(shape('navLinks'))
  })
})
