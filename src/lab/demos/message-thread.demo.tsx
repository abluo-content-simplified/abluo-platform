'use client'

import { MessageThread } from '@/components/app/ui/MessageThread'
import { Button } from '@/components/app/ui/Button'
import type { ThreadEntry } from '@/lib/support-tickets/model'
import { DemoBlock, DemoStack } from '../demo-kit'

const SHOT = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="gainsboro"/><rect x="30" y="40" width="140" height="18" fill="darkgray"/><rect x="30" y="76" width="100" height="18" fill="silver"/></svg>')}`

const person = (name: string) => ({ id: null, name, email: `${name.toLowerCase().replace(/\s/g, '.')}@example.com` })
const att = (id: string, url: string | null, deleted: 'retention' | null = null) => ({ id, mime: 'image/png', bytes: 1000, width: 200, height: 200, url, deleted })

const ENTRIES: ThreadEntry[] = [
  { kind: 'message', id: 'm1', authorKind: 'client', author: person('Claudia Hoffmann'), body: 'The booking button on the home page does nothing.\nI tried twice on my phone.', redacted: false, createdAt: '2026-10-20T09:12:00Z', attachments: [att('a1', SHOT), att('a2', null, 'retention')] },
  { kind: 'event', id: 'e1', event: 'status_changed', from: 'open', to: 'in_progress', createdAt: '2026-10-20T10:00:00Z', actor: null },
  { kind: 'message', id: 'm2', authorKind: 'support', author: person('Tom'), body: 'Thanks, we are looking at it.', redacted: false, createdAt: '2026-10-20T10:05:00Z', attachments: [] },
  { kind: 'note', id: 'n1', author: person('Tom'), body: 'Probably the cookie banner overlay on iOS.', createdAt: '2026-10-20T10:07:00Z' },
  { kind: 'message', id: 'm3', authorKind: 'client', author: person('Claudia Hoffmann'), body: 'my phone number is …', redacted: true, createdAt: '2026-10-20T11:00:00Z', attachments: [] },
]

const LABELS = {
  support: 'Abluo Support',
  redacted: 'Removed by Abluo Support',
  internalNote: 'Internal — not visible to the client',
  screenshotDeleted: 'Screenshot deleted',
  openScreenshot: (n: number) => `Open screenshot ${n} (new tab)`,
  thread: 'Conversation',
}

const formatEvent = (e: Extract<ThreadEntry, { kind: 'event' }>) => (e.event === 'status_changed' ? `Status changed to ${e.to}` : null)

export default function MessageThreadDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Client + support + note + system line" note="Props: entries (ThreadEntry[]), labels, formatEvent. The note tint and label appear only because a note was passed — pass notes on the admin side only.">
        <div className="w-full max-w-xl">
          <MessageThread entries={ENTRIES} labels={LABELS} formatEvent={formatEvent} />
        </div>
      </DemoBlock>
      <DemoBlock title="With per-message actions" note="actions(entry) and attachmentActions(id, entry): the admin's Remove text / Delete screenshot.">
        <div className="w-full max-w-xl">
          <MessageThread
            entries={ENTRIES.slice(0, 1)}
            labels={LABELS}
            formatEvent={formatEvent}
            actions={() => <Button variant="quiet">Remove text</Button>}
            attachmentActions={() => <Button variant="quiet">Delete</Button>}
          />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
