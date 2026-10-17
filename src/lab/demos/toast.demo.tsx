'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/app/ui/Button'
import { Toast } from '@/components/app/ui/Toast'
import { DemoBlock, DemoStack } from '../demo-kit'

type Shown = { message: string; tone: 'status' | 'error'; action?: string }

export default function ToastDemo() {
  const [shown, setShown] = useState<Shown | null>(null)
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(null), 4000)
    return () => clearTimeout(t)
  }, [shown])
  return (
    <DemoStack>
      <DemoBlock title="Show a toast" note="Appears at the bottom of the screen; this demo hides it after 4 seconds.">
        <Button onClick={() => setShown({ message: 'Saved.', tone: 'status' })}>Status</Button>
        <Button onClick={() => setShown({ message: 'Moved to archive.', tone: 'status', action: 'Undo' })}>With Undo</Button>
        <Button onClick={() => setShown({ message: 'Could not save. Check your connection.', tone: 'error' })}>Error</Button>
      </DemoBlock>
      <Toast message={shown?.message ?? null} tone={shown?.tone} action={shown?.action} onAction={() => setShown({ message: 'Restored.', tone: 'status' })} />
    </DemoStack>
  )
}
