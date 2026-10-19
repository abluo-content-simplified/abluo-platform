import { describe, expect, it } from 'vitest'
import { filterFaqSetsForPick } from '../faq-pick-model'

const sets = [
  { id: 'a', name: 'Impianti dentali', state: 'published' as const, firstQuestions: ['Fa male?', 'Quanto dura?'] },
  { id: 'b', name: 'Booking', state: 'draft' as const, firstQuestions: ['Can I cancel?'] },
  { id: 'c', name: 'Old prices', state: 'archived' as const, firstQuestions: [] },
]

describe('Add FAQs — choose existing', () => {
  it('never offers archived sets; keeps the server order', () => {
    expect(filterFaqSetsForPick(sets, '').map((s) => s.id)).toEqual(['a', 'b'])
  })
  it('matches names and first questions, every word, ignoring case and accents', () => {
    expect(filterFaqSetsForPick(sets, 'impianti').map((s) => s.id)).toEqual(['a'])
    expect(filterFaqSetsForPick(sets, 'CANCEL').map((s) => s.id)).toEqual(['b'])
    expect(filterFaqSetsForPick(sets, 'quanto  dura').map((s) => s.id)).toEqual(['a'])
    expect(filterFaqSetsForPick([{ ...sets[0], name: 'Perché' }], 'perche').map((s) => s.id)).toEqual(['a'])
    expect(filterFaqSetsForPick(sets, 'prices')).toEqual([])
  })
})
