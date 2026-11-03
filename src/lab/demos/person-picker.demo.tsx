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

export default function PersonPickerDemo() {
  const [many, setMany] = useState<PersonPickerPerson[]>([PEOPLE[0], PEOPLE[1]])
  const [one, setOne] = useState<PersonPickerPerson[]>([])
  return (
    <DemoStack>
      <DemoBlock title="Several people, first is main" note="primaryLabel marks the first; drag to reorder.">
        <div className="w-full max-w-md">
          <PersonPicker
            label="Team"
            value={many}
            onChange={setMany}
            search={search}
            primaryLabel="Main"
            onCreate={({ firstName, lastName }) =>
              Promise.resolve({ id: `new-${firstName}-${lastName}`, name: `${firstName} ${lastName}`.trim() })
            }
          />
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
