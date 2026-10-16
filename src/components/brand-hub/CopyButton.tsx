'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface CopyButtonProps {
  value: string
  /** Visible label, e.g. "Copy". */
  copyText: string
  /** Visible label after copying, e.g. "Copied". */
  copiedText: string
  /** Accessible name, e.g. "Copy #1A2B3C". */
  ariaLabel: string
}

export function CopyButton({ value, copyText, copiedText, ariaLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function onClick() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable: leave the button unchanged */
    }
  }

  return (
    <span className="inline-flex items-center print:hidden">
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', background: 'var(--color-background)' }}
      >
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        <span aria-hidden="true">{copied ? copiedText : copyText}</span>
      </button>
      <span aria-live="polite" role="status" className="sr-only">{copied ? copiedText : ''}</span>
    </span>
  )
}
