'use client'

import { UpdateCard } from '@/components/app/ui/UpdateCard'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function UpdateCardDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Unread update with button" note="Props shown: title, body (paragraphs and line breaks), publishedAt, newLabel, cta, opensInNewTabLabel.">
        <div className="w-full max-w-xl rounded-xl border border-border bg-card p-5">
          <UpdateCard
            title="Image galleries are here"
            body={'You can now add a gallery to any page.\nPick photos from your library and reorder them.\n\nNothing changes on pages that have no gallery.'}
            imageUrl={null}
            cta={{ label: 'Read the guide', url: 'https://example.com/guide' }}
            publishedAt="2026-10-12T09:30:00Z"
            newLabel="New"
            opensInNewTabLabel="(opens in a new tab)"
          />
        </div>
      </DemoBlock>
      <DemoBlock title="Read update, text only" note="No newLabel, no cta, imageUrl null (no external images in the Lab).">
        <div className="w-full max-w-xl rounded-xl border border-border bg-card p-5">
          <UpdateCard title="Faster dashboard" body="Pages now open noticeably quicker." imageUrl={null} cta={null} publishedAt="2026-09-30T08:00:00Z" opensInNewTabLabel="(opens in a new tab)" />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
