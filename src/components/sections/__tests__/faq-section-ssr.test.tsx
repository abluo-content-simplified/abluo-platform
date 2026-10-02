import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FAQSection } from '@/components/sections/FAQSection'
import type { FAQSection as FAQSectionType } from '@/lib/sanity/types'

// The FAQPage JSON-LD and the crawlers that read page text both need the
// answers in the SERVER HTML — not only after a click mounts them.

const section = {
  _type: 'faqSection',
  _key: 'faq',
  title: 'Questions',
  items: [
    { _key: 'a', question: 'What is a tiny CMS?', answer: 'A tiny CMS is a content system with only what you need.' },
    { _key: 'b', question: 'Can I add languages?', answer: 'Yes, any time, from settings.' },
  ],
} as unknown as FAQSectionType

const html = renderToStaticMarkup(
  <FAQSection section={section} surface={'transparent' as never} designSystem={null} />,
)

describe('FAQSection — answers are server-rendered', () => {
  it('every answer is in the HTML before any interaction', () => {
    expect(html).toContain('A tiny CMS is a content system with only what you need.')
    expect(html).toContain('Yes, any time, from settings.')
  })

  it('each question button controls its own answer panel', () => {
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1])
    expect(controls).toHaveLength(2)
    expect(new Set(controls).size).toBe(2)
    for (const id of controls) expect(html).toContain(`id="${id}"`)
  })

  it('closed panels start collapsed and are hidden from keyboard and assistive tech', () => {
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2)
    expect(html.match(/role="region"[^>]*aria-hidden="true"/g)).toHaveLength(2)
    expect(html.match(/inert=""/g)).toHaveLength(2)
  })
})
