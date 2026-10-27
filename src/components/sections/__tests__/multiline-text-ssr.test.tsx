import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HeroSection } from '@/components/sections/HeroSection'
import { EventsListingSection } from '@/components/sections/EventsListingSection'
import { TreatmentsSection } from '@/components/sections/TreatmentsSection'
import { FaqAnswer } from '@/components/faq/FaqAnswer'
import type { DesignSystem, EventsListingSection as EventsListingSectionType, HeroSection as HeroSectionType, TreatmentsSection as TreatmentsSectionType } from '@/lib/sanity/types'

/**
 * A line break an editor types into a multi-line plain-text field is stored as
 * "\n". Without `white-space: pre-line` the browser folds it into a space, so
 * "Save the date!\n€30 for CYCE members" showed on one line. These render the
 * real components and check the element carrying the text keeps the break.
 */

const designSystem = null as unknown as DesignSystem

/** The opening tag of the element whose text content starts with `text`. */
function tagAround(html: string, text: string): string {
  const at = html.indexOf(text)
  expect(at, `"${text.slice(0, 30)}" rendered`).toBeGreaterThan(-1)
  const open = html.lastIndexOf('<', at)
  return html.slice(open, html.indexOf('>', open) + 1)
}

describe('typed line breaks show on the website', () => {
  it('event listing card: short description keeps its break, clamped preview drops blank lines', () => {
    const section = {
      _type: 'eventsListingSection',
      _key: 'ev',
      layout: 'grid',
      subtitle: 'Classes\nand workshops',
      events: [
        {
          _id: 'e1',
          title: 'Yoga day',
          slug: 'yoga-day',
          startDate: '2026-11-21T09:00:00Z',
          shortDescription: 'Save the date!\n\n€30 for CYCE members | €35 for non-members',
        },
      ],
    } as unknown as EventsListingSectionType
    const html = renderToStaticMarkup(
      <EventsListingSection section={section} surface={'transparent' as never} designSystem={designSystem} locale="en" tenantId="cyce" />,
    )
    expect(html).toContain('Save the date!\n€30 for CYCE members')
    expect(tagAround(html, 'Save the date!')).toContain('whitespace-pre-line')
    expect(tagAround(html, 'Save the date!')).toContain('line-clamp-3')
    expect(tagAround(html, 'Classes\nand workshops')).toContain('whitespace-pre-line')
  })

  it('hero subheadline keeps its break', () => {
    const section = {
      _type: 'heroSection',
      _key: 'h',
      headline: 'Thomas Marco Zimmermann',
      subheadline: "A designer's eye.\nA strategist's mind.",
    } as unknown as HeroSectionType
    const html = renderToStaticMarkup(
      <HeroSection section={section} surface={'transparent' as never} designSystem={{ layout: {} } as unknown as DesignSystem} />,
    )
    const p = tagAround(html, 'A designer&#x27;s eye.')
    expect(p).toContain('whitespace-pre-line')
  })

  it('treatment description keeps its paragraphs', () => {
    const section = {
      _type: 'treatmentsSection',
      _key: 't',
      title: 'Treatments',
      treatments: [{ _key: 'a', name: 'Implants', description: 'First paragraph.\n\nSecond paragraph.' }],
    } as unknown as TreatmentsSectionType
    const html = renderToStaticMarkup(
      <TreatmentsSection section={section} surface={'transparent' as never} designSystem={designSystem} />,
    )
    expect(html).toContain('First paragraph.\n\nSecond paragraph.')
    expect(tagAround(html, 'First paragraph.')).toContain('whitespace-pre-line')
  })

  it('plain FAQ answer keeps its break', () => {
    const html = renderToStaticMarkup(
      <FaqAnswer answer={{ kind: 'plain', text: 'Yes.\nBring a mat.' } as never} links={{ siteBase: '' }} />,
    )
    expect(html).toBe('<p class="whitespace-pre-line">Yes.\nBring a mat.</p>')
  })
})
