'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { decodeEmail } from './contacts'

/**
 * A public e-mail contact (ADR-043 D7). The server HTML carries only the
 * encoded value and a label — never the address. After hydration the address
 * is decoded and the mailto: link is assembled here, in the browser.
 */
export function ObfuscatedEmail({
  encoded,
  label,
  hint,
  className,
  style,
}: {
  encoded: string
  /** Shown until (and unless) the address is assembled. */
  label: string
  /** Title of the placeholder: why the address is not shown yet. */
  hint: string
  className?: string
  style?: CSSProperties
}) {
  const [address, setAddress] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- decoded only in the browser, so the address never reaches server HTML
    setAddress(decodeEmail(encoded))
  }, [encoded])

  if (!address) {
    return (
      <span className={className} style={style} title={hint} data-obfuscated-email="">
        {label}
      </span>
    )
  }
  return (
    <a href={`mailto:${address}`} className={className} style={style}>
      {address}
    </a>
  )
}
