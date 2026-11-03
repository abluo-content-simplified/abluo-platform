import { getPeopleMessages } from '@/lib/i18n/people-messages'
import type { PersonPublicContact } from '@/lib/modules/people/projection'
import { contactLink, orderedContacts } from './contacts'
import { ObfuscatedEmail } from './ObfuscatedEmail'

/**
 * A person's PUBLIC contacts (ADR-043 D7). E-mail addresses are never in the
 * server HTML; WhatsApp opens click-to-chat; phone is tel:; the rest are
 * outbound links with rel="noopener".
 */
export function PersonContacts({
  contacts,
  locale,
  className,
}: {
  contacts: readonly PersonPublicContact[] | null | undefined
  locale: string
  className?: string
}) {
  const msg = getPeopleMessages(locale)
  const links = orderedContacts(contacts)
    .map((c) => contactLink(c, msg))
    .filter((l): l is NonNullable<typeof l> => l !== null)
  if (links.length === 0) return null

  const linkStyle = { color: 'var(--color-primary)' }
  const linkClass = 'text-sm font-medium underline-offset-4 hover:underline'

  return (
    <ul className={`flex flex-col gap-2 ${className ?? ''}`}>
      {links.map((l) => (
        <li key={l.key}>
          {l.type === 'email' ? (
            <ObfuscatedEmail encoded={l.encoded} label={l.label} hint={msg.emailNeedsScript} className={linkClass} style={linkStyle} />
          ) : (
            <a
              href={l.href}
              className={linkClass}
              style={linkStyle}
              {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {l.text}
              {l.external && <span className="sr-only"> ({msg.opensInNewTab})</span>}
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}
