'use client'

import { useState } from 'react'
import { CodeInput } from '@/components/app/ui/CodeInput'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function CodeInputDemo() {
  const [code, setCode] = useState('')
  return (
    <DemoStack>
      <DemoBlock title="Six digits" note="id, label, digitLabel, value, onChange, onComplete. Paste a whole code into any box.">
        <CodeInput id="demo-code" label="Code from your app" digitLabel={(n, len) => `Digit ${n} of ${len}`} value={code} onChange={setCode} />
        <p className="w-full text-sm text-muted-foreground">Value: {code || 'empty'}</p>
      </DemoBlock>
    </DemoStack>
  )
}
