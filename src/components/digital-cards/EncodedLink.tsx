'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { decodeContact } from '@/lib/modules/digital-cards/model'

/**
 * A card link whose target is a contact (tel: / mailto: / wa.me, ADR-049 D9).
 * The server HTML carries only `encodeContact(href)`; the real href is put on
 * the link in the browser. Until then (or without JavaScript) the link has no
 * target and says why in its title.
 */
export function EncodedLink({
  hrefEnc,
  linkKey,
  external,
  hint,
  className,
  style,
  describedBy,
  children,
}: {
  hrefEnc: string
  /** digitalCard.links[]._key — counted by CardBeacon. */
  linkKey?: string
  external?: boolean
  /** Title while the target is not assembled yet. */
  hint: string
  className?: string
  style?: CSSProperties
  /** id of a description of the link (aria-describedby). */
  describedBy?: string
  children: ReactNode
}) {
  const [href, setHref] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- decoded only in the browser, so the contact never reaches server HTML
    setHref(decodeContact(hrefEnc) || null)
  }, [hrefEnc])

  return (
    <a
      href={href ?? undefined}
      title={href ? undefined : hint}
      aria-describedby={describedBy}
      data-card-link={linkKey}
      className={className}
      style={style}
      {...(external && href ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  )
}
