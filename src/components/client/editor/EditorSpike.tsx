'use client'

import { useEffect, useRef, useState } from 'react'
import type { PortableTextBlock } from '@portabletext/editor'
import { BodyEditor } from './BodyEditor'

/**
 * S0d spike harness (ADR-025 D6) — DEVELOPER TOOL, never shown in production
 * (the route 404s there). Proves the body editor on a real phone: typing,
 * autocorrect, dictation via the iOS keyboard mic, the toolbar above the
 * keyboard, and that the stored value is native Portable Text. English-only
 * copy is acceptable here (developer tooling exception in CLAUDE.md).
 */
export function EditorSpike() {
  const [value, setValue] = useState<PortableTextBlock[] | undefined>()
  const [savedAt, setSavedAt] = useState<string>('—')
  const [changes, setChanges] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Simulates the S2 autosave cadence: one "save" 800 ms after the last change.
  useEffect(() => {
    if (changes === 0) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSavedAt(new Date().toLocaleTimeString()), 800)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [changes])

  return (
    <div data-surface="create" className="mx-auto flex min-h-[80vh] max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold leading-8 tracking-tight">Tell your story</h1>
        <span role="status" className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {changes === 0 ? 'No changes' : `Saved ${savedAt}`}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Editor test (dev only). Type, dictate with the keyboard mic, paste from Notes or Mail, try every toolbar button.
      </p>
      <BodyEditor
        onChange={(v) => {
          setValue(v)
          setChanges((n) => n + 1)
        }}
      />
      <details className="rounded-lg border border-border p-3 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">
          Stored value — {value?.length ?? 0} blocks, {changes} changes
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
          {JSON.stringify(value ?? [], null, 2)}
        </pre>
      </details>
    </div>
  )
}
