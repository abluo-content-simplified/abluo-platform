import type { ReactNode } from 'react'
import { personFullName } from '@/lib/modules/people/model'
import { personHref, type PersonLinkContext } from '@/lib/modules/people/website'
import type { PersonPublic } from '@/lib/modules/people/projection'
import { PersonAvatar } from './PersonAvatar'

/** "Anna Rossi, Marco Bianchi and Luca Neri" — the locale's own conjunction (Intl.ListFormat). */
function listParts(locale: string, count: number): string[] {
  const ids = Array.from({ length: count }, (_, i) => `\u0000${i}`)
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })
      .formatToParts(ids)
      .map((p) => p.value)
  } catch {
    return ids
  }
}

function Name({ person, links }: { person: PersonPublic; links?: PersonLinkContext | null }) {
  const href = personHref(person, links)
  const name = personFullName(person)
  return href ? (
    <a href={href} className="underline-offset-4 hover:underline">
      {name}
    </a>
  ) : (
    <>{name}</>
  )
}

/**
 * Who wrote / hosts this (ADR-043 D5, D7). People in the given order — the
 * first is the main author — joined with the language's own "and". A name links
 * to the person's page when they have one in this language.
 *
 * `variant="post"` is the article header: the main author's avatar, and their
 * job title when they are the only one; `children` (the date line) sit under
 * the names. `variant="inline"` is a plain sentence ("Hosted by …").
 */
export function PersonByline({
  people,
  locale,
  links,
  variant = 'inline',
  label,
  className,
  children,
}: {
  people: PersonPublic[]
  locale: string
  links?: PersonLinkContext | null
  variant?: 'post' | 'inline'
  /** Inline lead-in, e.g. "Hosted by". */
  label?: string
  className?: string
  children?: ReactNode
}) {
  if (people.length === 0) return null

  // Intl.ListFormat decides where the separators go; names are slotted in.
  const parts = listParts(locale, people.length)
  const names = parts.map((part, i) => {
    const m = /^\u0000(\d+)$/.exec(part)
    if (!m) return <span key={`sep-${i}`}>{part}</span>
    const person = people[Number(m[1])]
    return <Name key={person.publicId} person={person} links={links} />
  })

  if (variant === 'inline') {
    return (
      <p className={className} style={{ color: 'var(--color-text-secondary)' }}>
        {label ? <span>{label} </span> : null}
        <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {names}
        </span>
      </p>
    )
  }

  const main = people[0]
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <PersonAvatar person={main} size={40} />
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {names}
          {people.length === 1 && main.jobTitle && (
            <span className="font-normal ml-1" style={{ color: 'var(--color-text-muted)' }}>
              · {main.jobTitle}
            </span>
          )}
        </p>
        {children}
      </div>
    </div>
  )
}
