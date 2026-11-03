import { PortableText } from '@portabletext/react'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'
import { resolveBodyLinks, siteHostsForProject } from '@/lib/links/link-target'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { focalObjectPosition } from '@/lib/gallery/focal'
import { getPeopleMessages } from '@/lib/i18n/people-messages'
import { personDisplayName, personInitials } from '@/lib/modules/people/model'
import type { PersonPublic } from '@/lib/modules/people/projection'
import { PersonContacts } from './PersonContacts'
import { cardInitials } from './PersonCard'

function languageNames(codes: readonly string[] | null | undefined, locale: string): string[] {
  if (!codes?.length) return []
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames([locale], { type: 'language' })
  } catch {
    names = null
  }
  return codes
    .map((code) => {
      let label: string | undefined
      try {
        label = names?.of(code)
      } catch {
        label = undefined
      }
      if (!label || label === code) return null
      return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
    })
    .filter((x): x is string => !!x)
}

const year = (d: string | null | undefined) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : null)

/**
 * The body of a person's own page (ADR-043 D7): photo, name with honorific,
 * job title, groups, long bio (the article rich-text renderer), languages,
 * qualifications and public contacts. Everything comes from the single public
 * projection; nothing private can be here.
 */
export function PersonProfile({
  person,
  locale,
  siteBase,
  projectSlug,
  groups = [],
}: {
  person: PersonPublic
  locale: string
  siteBase: string
  projectSlug: string
  /** Group labels already resolved to this language. */
  groups?: string[]
}) {
  const msg = getPeopleMessages(locale)
  const name = personDisplayName(person)
  const fullName = [person.honorific, name].filter(Boolean).join(' ')
  const src = imageUrl(person.photo ?? undefined, 900)
  const languages = languageNames(person.languages, locale)
  const qualifications = (person.qualifications ?? []).filter((q) => q?.title)
  const hasContacts = (person.contacts?.length ?? 0) > 0
  const heading = { fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }
  const label = { color: 'var(--color-text-muted)' }

  return (
    <div style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="mx-auto grid max-w-[1000px] gap-10 px-5 py-12 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:gap-14 md:px-8">
        {/* Photo or initials */}
        <div
          className="relative w-full self-start overflow-hidden"
          style={{ aspectRatio: '3 / 4', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)' }}
        >
          {src ? (
            <img
              src={src}
              srcSet={imageSrcSet(person.photo ?? undefined, [320, 640, 900])}
              sizes="(max-width: 768px) 100vw, 320px"
              alt={fullName}
              className="h-full w-full object-cover"
              style={{ objectPosition: focalObjectPosition(person.photo) }}
              loading="eager"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-5xl font-light" style={label} aria-hidden="true">
                {personInitials(person) || cardInitials(name)}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0">
          {groups.length > 0 && (
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>
              {groups.join(' · ')}
            </p>
          )}
          <h1 className="text-[clamp(28px,5vw,44px)] font-bold leading-[1.1] tracking-tight" style={heading}>
            {fullName}
          </h1>
          {person.jobTitle && (
            <p className="mt-3 text-sm font-medium uppercase tracking-wide" style={label}>
              {person.jobTitle}
            </p>
          )}

          {person.bio && person.bio.length > 0 ? (
            <div className="mt-8">
              <PortableText
                // Internal links → URLs in this language; same resolver as article bodies.
                value={resolveBodyLinks(person.bio, { siteBase, siteHosts: siteHostsForProject(projectSlug), projectSlug }) as Parameters<typeof PortableText>[0]['value']}
                components={articlePortableTextComponents}
              />
            </div>
          ) : person.shortBio ? (
            <p className="mt-8 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {person.shortBio}
            </p>
          ) : null}

          {languages.length > 0 && (
            <section className="mt-8" aria-label={msg.languages}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest" style={label}>{msg.languages}</h2>
              <p className="text-base" style={{ color: 'var(--color-text-primary)' }}>{languages.join(', ')}</p>
            </section>
          )}

          {qualifications.length > 0 && (
            <section className="mt-8" aria-label={msg.qualifications}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest" style={label}>{msg.qualifications}</h2>
              <ul className="flex flex-col gap-2">
                {qualifications.map((q) => {
                  const issued = year(q.issuedOn)
                  const until = year(q.expiresOn)
                  const detail = [q.issuer, issued].filter(Boolean).join(', ')
                  return (
                    <li key={q._key} className="text-base" style={{ color: 'var(--color-text-primary)' }}>
                      {q.title}
                      {detail && <span style={label}> — {detail}</span>}
                      {until && <span style={label}> ({msg.validUntil} {until})</span>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {(hasContacts || person.website) && (
            <section className="mt-8" aria-label={msg.contact}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest" style={label}>{msg.contact}</h2>
              <PersonContacts
                locale={locale}
                contacts={[
                  ...(person.contacts ?? []),
                  // The profile's own website field, unless the same address is already a contact.
                  ...(person.website && !(person.contacts ?? []).some((c) => c.value === person.website)
                    ? [{ _key: 'website', kind: 'website' as const, value: person.website }]
                    : []),
                ]}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
