'use client'

import { useState } from 'react'
import { OptionCards } from '@/components/app/ui/OptionCards'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function OptionCardsDemo() {
  const [cta, setCta] = useState<'default' | 'event' | 'none'>('default')
  const [lang, setLang] = useState<'translate' | 'write' | 'later'>('later')
  return (
    <DemoStack>
      <DemoBlock title="Stack (rich content)" note="One card per row; body can hold a preview. Arrow keys move and choose.">
        <OptionCards
          className="w-full max-w-lg"
          label="Call to action"
          value={cta}
          onChange={setCta}
          options={[
            { value: 'default', title: 'Use the default', body: 'Book a first appointment — button “Book now”.' },
            { value: 'event', title: 'Spring open day', body: 'Join us on 12 May — button “Sign up”.' },
            { value: 'none', title: 'No call to action', body: 'The post ends with its text.' },
          ]}
        />
      </DemoBlock>
      <DemoBlock title="Row (short options)" note="layout=&quot;row&quot;; badge + disabled for something not available yet.">
        <OptionCards
          className="w-full max-w-lg"
          label="Italiano"
          layout="row"
          value={lang}
          onChange={setLang}
          options={[
            { value: 'translate', title: 'Translate', badge: 'Soon', disabled: true },
            { value: 'write', title: 'Write' },
            { value: 'later', title: 'Later' },
          ]}
        />
      </DemoBlock>
    </DemoStack>
  )
}
