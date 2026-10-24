import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { EventCategoryOption } from '@/lib/modules/events/categories'
import { categorySummary, eventCategoryFilterOptions, eventCategoryNames, hasEventCategories, matchesEventCategory } from '../event-category-view'
import { EventCategoryChip } from '../EventCategoryChip'

const options: EventCategoryOption[] = [
  { value: 'yoga', label: { en: 'Yoga', it: 'Yoga (it)' }, color: null },
  { value: 'retreat', label: { en: 'Retreats', de: 'Rückzug' }, color: null },
  { value: 'talk', label: { it: 'Conferenze' }, color: null },
]

describe('event categories in the Events list', () => {
  it('shows nothing about categories when the project has none', () => {
    expect(hasEventCategories([])).toBe(false)
    expect(hasEventCategories(options)).toBe(true)
  })

  it('names in the dashboard language, else the default language, else any, in vocabulary order', () => {
    expect(eventCategoryNames(['talk', 'yoga'], options, 'it', 'en')).toEqual(['Yoga (it)', 'Conferenze'])
    expect(eventCategoryNames(['retreat', 'yoga'], options, 'de', 'en')).toEqual(['Yoga', 'Rückzug'])
    expect(eventCategoryNames(['talk'], options, 'en', 'en')).toEqual(['Conferenze'])
  })

  it('leaves out a key the vocabulary no longer has', () => {
    expect(eventCategoryNames(['gone', 'yoga'], options, 'en', 'en')).toEqual(['Yoga'])
    expect(eventCategoryNames([], options, 'en', 'en')).toEqual([])
  })

  it('summarises as the first name plus how many more', () => {
    expect(categorySummary([])).toEqual({ first: null, more: 0 })
    expect(categorySummary(['Yoga'])).toEqual({ first: 'Yoga', more: 0 })
    expect(categorySummary(['Yoga', 'Retreats', 'Talks'])).toEqual({ first: 'Yoga', more: 2 })
  })

  it('the chip shows "+N" for the rest and every name to screen readers', () => {
    const html = renderToStaticMarkup(<EventCategoryChip names={['Yoga', 'Retreats', 'Talks']} label="Categories: Yoga, Retreats, Talks" />)
    expect(html).toContain('>Yoga<')
    expect(html).toContain('+2')
    expect(html).toContain('sr-only">Categories: Yoga, Retreats, Talks<')
    expect(renderToStaticMarkup(<EventCategoryChip names={['Yoga']} label="x" />)).not.toContain('+')
    expect(renderToStaticMarkup(<EventCategoryChip names={[]} label="x" />)).toBe('')
  })

  it('the filter offers every category; "" means any', () => {
    expect(eventCategoryFilterOptions(options, 'en', 'en')).toEqual([
      { value: 'yoga', label: 'Yoga' },
      { value: 'retreat', label: 'Retreats' },
      { value: 'talk', label: 'Conferenze' },
    ])
    expect(matchesEventCategory(['yoga'], '')).toBe(true)
    expect(matchesEventCategory([], '')).toBe(true)
    expect(matchesEventCategory(['yoga', 'talk'], 'talk')).toBe(true)
    expect(matchesEventCategory(['yoga'], 'talk')).toBe(false)
    expect(matchesEventCategory([], 'talk')).toBe(false)
  })
})
