'use client'

/**
 * BackButton — context-aware back navigation for the Event Detail page.
 *
 * Priority:
 *  1. If browser history exists (user navigated within the app), use router.back()
 *     so scroll position and any filter state are preserved.
 *  2. Otherwise fall back to the URL derived from the `from` query param.
 *  3. Final fallback is always the Live page.
 */

import { useRouter } from 'next/navigation'

interface BackButtonProps {
  /** URL to navigate to when there is no browser history */
  fallbackUrl: string
  /** Link label, e.g. "Back to Events" or "Back to Live" */
  label: string
}

export function BackButton({ fallbackUrl, label }: BackButtonProps) {
  const router = useRouter()

  const handleClick = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackUrl)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 mb-8 rounded-[var(--radius-btn)] px-3 py-2 text-sm font-medium transition-all"
      style={{
        color: 'var(--color-primary)',
        backgroundColor: 'color-mix(in oklch, var(--color-primary) 10%, transparent)',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      ← {label}
    </button>
  )
}
