'use client'

import { useState } from 'react'
import { AttachmentPicker } from '@/components/app/ui/AttachmentPicker'
import { MessageComposer } from '@/components/app/ui/MessageComposer'
import { DemoBlock, DemoStack } from '../demo-kit'

const LABELS = { placeholder: 'Write a message…', label: 'Message', send: 'Send', sending: 'Sending…' }

export default function MessageComposerDemo() {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [mode, setMode] = useState('reply')
  const [files, setFiles] = useState<File[]>([])
  const [d, setD] = useState('')
  const [c, setC] = useState('x'.repeat(95))
  return (
    <DemoStack>
      <DemoBlock title="Reply box with a character limit" note="maxLength + remainingLabel: the count shows only in the last 10 %. Ctrl/Cmd + Enter sends. Nothing is sent in this demo.">
        <div className="w-full max-w-xl">
          <MessageComposer value={c} onChange={setC} onSend={() => setC('')} labels={LABELS} maxLength={100} remainingLabel={(n) => `${n} characters left`} />
        </div>
      </DemoBlock>
      <DemoBlock title="Reply / Note modes" note="modes: the note mode (tone: 'note') changes the box colour and the button text.">
        <div className="w-full max-w-xl">
          <MessageComposer
            value={a}
            onChange={setA}
            onSend={() => setA('')}
            labels={LABELS}
            modeSwitchLabel="Kind of message"
            mode={mode}
            onModeChange={setMode}
            modes={[
              { id: 'reply', label: 'Reply', sendLabel: 'Send reply' },
              { id: 'note', label: 'Internal note', sendLabel: 'Save note', tone: 'note', hint: 'Only Abluo Support sees notes.' },
            ]}
          />
        </div>
      </DemoBlock>
      <DemoBlock title="With attachments" note="attachments: a slot between the box and the send button, here an AttachmentPicker.">
        <div className="w-full max-w-xl">
          <MessageComposer
            value={d}
            onChange={setD}
            onSend={() => { setD(''); setFiles([]) }}
            labels={LABELS}
            attachments={
              <AttachmentPicker
                files={files}
                onChange={setFiles}
                max={3}
                maxBytes={5 * 1024 * 1024}
                labels={{ add: 'Add images', hint: 'Up to 3 images, 5 MB each', remove: (n) => `Remove ${n}`, problem: (p) => `${p.name}: does not fit` }}
              />
            }
          />
        </div>
      </DemoBlock>
      <DemoBlock title="Pending and disabled" note="pending locks the field; disabled + disabledReason explains why nothing can be sent.">
        <div className="w-full max-w-xl space-y-6">
          <MessageComposer value="On its way" onChange={() => undefined} onSend={() => undefined} labels={LABELS} pending />
          <MessageComposer value={b} onChange={setB} onSend={() => undefined} labels={LABELS} disabled disabledReason="You can read this request but not reply to it." />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
