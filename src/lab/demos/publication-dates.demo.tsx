'use client'

import { useState } from 'react'
import { PublicationDates } from '@/components/app/lifecycle/PublicationDates'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function PublicationDatesDemo() {
  const [a, setA] = useState<{ from: string | null; until: string | null }>({ from: null, until: null })
  const [b, setB] = useState<{ from: string | null; until: string | null }>({ from: '2026-10-01T08:00:00.000Z', until: null })
  return (
    <DemoStack>
      <DemoBlock title="New content (inside Schedule)" note="from null = Now. A future From offers Back to now; Until is optional.">
        <div className="w-full max-w-lg">
          <PublicationDates id="demo-pd-a" from={a.from} until={a.until} zone="Europe/Rome" onChange={setA} sentence={`From: ${a.from ?? 'now'} · Until: ${a.until ?? 'no end date'}`} />
        </div>
      </DemoBlock>
      <DemoBlock title="Live content (post overview)" note='A past From reads "Since …" with only Change; fromNote explains that a later moment takes it off the website until then.'>
        <div className="w-full max-w-lg">
          <PublicationDates
            id="demo-pd-b"
            from={b.from}
            until={b.until}
            zone="Europe/Rome"
            onChange={setB}
            fromNote="A later moment takes the post off the website until then."
            sentence="Online since 1 Oct at 10:00 and stays online, no end date."
          />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
