'use client'

import { useEffect, useState } from 'react'
import { ProgressBar } from '@/components/app/ui/ProgressBar'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function ProgressBarDemo() {
  const [v, setV] = useState(0.2)
  useEffect(() => {
    const t = setInterval(() => setV((x) => (x >= 1 ? 0 : Math.round((x + 0.1) * 10) / 10)), 700)
    return () => clearInterval(t)
  }, [])
  return (
    <DemoStack>
      <DemoBlock title="With a label" note="role=progressbar; value 0–1.">
        <ProgressBar className="w-full max-w-md" value={v} label="Uploading photo" />
      </DemoBlock>
      <DemoBlock title="Pulsing and decorative" note="pulsing while the number is an estimate; decorative when the text next to it says the same.">
        <div className="w-full max-w-md space-y-1">
          <ProgressBar value={0.6} pulsing decorative />
          <p className="text-xs text-muted-foreground">Uploading… 60%</p>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
