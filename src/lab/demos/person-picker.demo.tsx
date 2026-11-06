'use client'

import { useState } from 'react'
import { PersonPicker, type PersonPickerPerson } from '@/components/app/ui/PersonPicker'
import { DemoBlock, DemoStack } from '../demo-kit'

const PEOPLE: PersonPickerPerson[] = [
  { id: 'p1', name: 'Anna Rossi', jobTitle: 'Psychotherapist' },
  { id: 'p2', name: 'Marco Bianchi', jobTitle: 'Dentist' },
  { id: 'p3', name: 'Julia Weber', jobTitle: 'Practice manager' },
  { id: 'p4', name: 'Paolo Verdi', jobTitle: 'Hygienist', archived: true },
]

function search(query: string): Promise<PersonPickerPerson[]> {
  const q = query.trim().toLowerCase()
  return Promise.resolve(PEOPLE.filter((p) => !q || p.name.toLowerCase().includes(q)))
}

/** Fake duplicate check: the same name, either order, ignoring case and accents. */
const fold = (v: string) => v.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ')
function findDuplicates({ firstName, lastName }: { firstName: string; lastName: string }): Promise<PersonPickerPerson[]> {
  const typed = fold(`${firstName} ${lastName}`)
  return Promise.resolve(typed ? PEOPLE.filter((p) => fold(p.name) === typed) : [])
}

export default function PersonPickerDemo() {
  const [many, setMany] = useState<PersonPickerPerson[]>([PEOPLE[0], PEOPLE[1]])
  const [one, setOne] = useState<PersonPickerPerson[]>([])
  const [teachers, setTeachers] = useState<PersonPickerPerson[]>([])
  return (
    <DemoStack>
      <DemoBlock title="Several people, first is main" note="primaryLabel marks the first; drag to reorder. In Add new person, type “Rossi Anna”: findDuplicates offers Use this person or Create anyway.">
        <div className="w-full max-w-md">
          <PersonPicker
            label="Team"
            value={many}
            onChange={setMany}
            search={search}
            primaryLabel="Main"
            findDuplicates={findDuplicates}
            onCreate={({ firstName, lastName }) =>
              Promise.resolve({ id: `new-${firstName}-${lastName}`, name: `${firstName} ${lastName}`.trim() })
            }
          />
        </div>
      </DemoBlock>
      <DemoBlock title="Its own wording" note="labels: the empty text, the add button and the sheet title say “teacher” instead of “people”.">
        <div className="w-full max-w-md">
          <PersonPicker label="Teachers" labels={{ empty: 'No teacher yet', add: 'Add teacher', title: 'Choose teachers' }} value={teachers} onChange={setTeachers} search={search} />
        </div>
      </DemoBlock>
      <DemoBlock title="One person" note="mode single">
        <div className="w-full max-w-md">
          <PersonPicker label="Author" mode="single" value={one} onChange={setOne} search={search} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
