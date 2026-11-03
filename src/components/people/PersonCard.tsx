import type { TeamMember, ResolvedImage } from '@/lib/sanity/types'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'
import { focalObjectPosition } from '@/lib/gallery/focal'
import { multiline } from '@/lib/multiline-text'
import { personDisplayName } from '@/lib/modules/people/model'
import { personHref, type PersonLinkContext } from '@/lib/modules/people/website'
import type { PersonPublic } from '@/lib/modules/people/projection'
import type { TeamSectionMessages } from '@/lib/i18n/team-section-messages'

/**
 * One team card's view model. Inline team members (the deprecated `members`)
 * and People-module persons are both mapped into this, so the two render with
 * the SAME markup (visual parity is the contract of the migration, ADR-043 D10).
 */
export interface PersonCardData {
  key: string
  name: string
  honorific?: string | null
  role?: string | null
  bio?: string | null
  photo?: ResolvedImage | null
  website?: string | null
  /** DOM id so `/teachers#florian-parra` lands on this card. */
  anchorId?: string | null
  /** Further anchors (migrated ids) as empty targets inside the card. */
  extraAnchorIds?: string[]
  /** The person's own page, when there is one (People module only). */
  profileHref?: string | null
  /** Refs only: keep the Media Library focal point. Inline members never had one. */
  focal?: boolean
}

export function memberToCardData(member: TeamMember): PersonCardData {
  return {
    key: member._key,
    name: member.name,
    honorific: member.honorific,
    role: member.role,
    bio: member.bio,
    photo: member.photo,
    website: member.website,
    anchorId: member.anchorId,
  }
}

export function personToCardData(person: PersonPublic, links?: PersonLinkContext | null): PersonCardData {
  const anchors = (person.legacyAnchors ?? []).filter((a): a is string => typeof a === 'string' && a.trim() !== '')
  return {
    key: person.publicId,
    name: personDisplayName(person),
    honorific: person.honorific,
    role: person.jobTitle,
    bio: person.shortBio,
    photo: person.photo,
    website: person.website,
    anchorId: anchors[0] ?? null,
    extraAnchorIds: anchors.slice(1),
    profileHref: personHref(person, links),
    focal: true,
  }
}

/** The placeholder initials the team section has always shown. */
export function cardInitials(name: string): string {
  return name
    .split(' ')
    .filter((w) => w.length > 1)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
}

export function PersonCard({
  card,
  msg,
  profileLabel,
}: {
  card: PersonCardData
  msg: TeamSectionMessages
  /** Dictionary label of the link to the person's own page. */
  profileLabel: string
}) {
  const src = imageUrl(card.photo ?? undefined, 600)
  const srcSet = imageSrcSet(card.photo ?? undefined, [300, 600, 900])
  const fullName = [card.honorific, card.name].filter(Boolean).join(' ')

  return (
    /* anchorId lets other pages deep-link to one member (/teachers#florian-parra). */
    <div id={card.anchorId || undefined} className="group flex scroll-mt-24 flex-col">
      {card.extraAnchorIds?.map((id) => <span key={id} id={id} className="scroll-mt-24" />)}
      {/* Photo or initials placeholder */}
      <div
        className="relative mb-6 w-full overflow-hidden"
        style={{
          aspectRatio: '3 / 4',
          backgroundColor: 'var(--color-surface)',
          // Border radius uses the DS token — will become a DS media token in future
          borderRadius: 'var(--radius-lg)',
        }}
      >
        {src ? (
          <img
            src={src}
            srcSet={srcSet}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
            alt={fullName}
            className={`h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
            style={card.focal ? { objectPosition: focalObjectPosition(card.photo) } : undefined}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-3xl font-light" style={{ color: 'var(--color-text-muted)' }} aria-hidden="true">
              {cardInitials(card.name)}
            </span>
          </div>
        )}
      </div>

      {/* Name */}
      <p className="mb-1 text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {card.profileHref ? (
          <a href={card.profileHref} className="underline-offset-4 hover:underline">
            {fullName}
          </a>
        ) : (
          fullName
        )}
      </p>

      {/* Role */}
      {card.role && (
        <p className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          {card.role}
        </p>
      )}

      {/* Divider */}
      <div
        className="mb-4 h-[1px] w-8 transition-all duration-300 group-hover:w-14"
        style={{ backgroundColor: 'var(--color-border)' }}
      />

      {/* Bio */}
      {card.bio && (
        <p className={multiline('text-sm leading-relaxed')} style={{ color: 'var(--color-text-secondary)' }}>
          {card.bio}
        </p>
      )}

      {/* Own page */}
      {card.profileHref && (
        <a
          href={card.profileHref}
          className="mt-4 inline-flex items-center gap-1 self-start text-sm font-medium underline-offset-4 hover:underline"
          style={{ color: 'var(--color-primary)' }}
        >
          {profileLabel}
          <span aria-hidden="true">→</span>
        </a>
      )}

      {/* Website */}
      {card.website && (
        <a
          href={card.website}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1 self-start text-sm font-medium underline-offset-4 hover:underline"
          style={{ color: 'var(--color-primary)' }}
        >
          {msg.website}
          <span aria-hidden="true">↗</span>
          <span className="sr-only"> ({msg.opensInNewTab})</span>
        </a>
      )}
    </div>
  )
}
