import { describe, it, expect } from 'vitest'
import { selectedOptionSuccessNotes } from '@/lib/forms/render-mapping'

/** formFieldOption.successNote — a thank-you line for one choice (Freeriders: "Happy riding!" for riders only). */

const fields = [
  { id: 'name' },
  { id: 'role', options: [{ value: 'rider', successNote: 'Happy riding, {first_name}!' }, { value: 'store' }] },
  { id: 'extras', options: [{ value: 'a', successNote: 'Note A' }, { value: 'b', successNote: 'Note B' }] },
]

describe('selectedOptionSuccessNotes', () => {
  it('adds the note of the option the visitor picked, personalized', () => {
    expect(selectedOptionSuccessNotes(fields, { name: 'Marco Rossi', role: 'rider' })).toEqual(['Happy riding, Marco!'])
  })

  it('nothing for an option without a note, or when nothing was picked', () => {
    expect(selectedOptionSuccessNotes(fields, { name: 'Anna', role: 'store' })).toEqual([])
    expect(selectedOptionSuccessNotes(fields, {})).toEqual([])
  })

  it('checkbox groups: every picked option, in field order, each note once', () => {
    expect(selectedOptionSuccessNotes(fields, { extras: ['b', 'a'] })).toEqual(['Note A', 'Note B'])
  })

  it('a value only matches its own field', () => {
    expect(selectedOptionSuccessNotes(fields, { extras: 'rider' })).toEqual([])
  })
})
