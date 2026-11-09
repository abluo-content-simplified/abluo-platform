'use client'

import { useEffect, useState } from 'react'
import { decodeContact } from '@/lib/modules/digital-cards/model'
import type { CardContactView } from '@/lib/modules/digital-cards/website'
import { Icon } from '@/components/icons'

/**
 * The card's contact rows (ADR-049 D9): shown visibly — no tap-to-reveal — but
 * never as plain text in the HTML. Each row arrives as `data-enc` strings
 * (encodeContact) and is assembled here after hydration: the visible value and
 * its tel: / mailto: / wa.me link. Without JavaScript the row shows its name
 * and a hint.
 */
export function CardContacts({
  contacts,
  heading,
  hint,
  opensInNewTab,
}: {
  contacts: readonly CardContactView[]
  /** Screen-reader heading. */
  heading: string
  hint: string
  opensInNewTab: string
}) {
  const [decoded, setDecoded] = useState<Array<{ text: string; href: string } | null>>(() => contacts.map(() => null))
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- decoded only in the browser, so contacts never reach server HTML
    setDecoded(
      contacts.map((c) => {
        const text = decodeContact(c.textEnc)
        const href = decodeContact(c.hrefEnc)
        return text && href ? { text, href } : null
      }),
    )
  }, [contacts])

  if (contacts.length === 0) return null
  return (
    <section aria-label={heading} className="w-full">
      <ul className="flex w-full flex-col gap-2">
        {contacts.map((c, i) => {
          const d = decoded[i]
          const icon = c.kind === 'email' ? 'mail' : 'phone'
          const external = c.kind === 'whatsapp'
          return (
            <li key={`${c.kind}-${i}`}>
              <a
                href={d?.href}
                data-enc={c.hrefEnc}
                title={d ? undefined : hint}
                className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left outline-offset-2 transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2"
                style={{ color: 'var(--color-text-primary)', outlineColor: 'var(--color-primary)' }}
                {...(external && d ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                <Icon name={icon} size={18} style={{ color: 'var(--color-text-secondary)' }} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {c.label}
                  </span>
                  <span className="break-all text-sm font-medium" data-enc={c.textEnc}>
                    {d?.text ?? '…'}
                  </span>
                </span>
                {external && d && <span className="sr-only"> ({opensInNewTab})</span>}
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
