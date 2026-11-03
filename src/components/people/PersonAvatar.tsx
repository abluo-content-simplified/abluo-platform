import { imageUrl } from '@/lib/sanity/image'
import { focalObjectPosition } from '@/lib/gallery/focal'
import { personInitials } from '@/lib/modules/people/model'
import type { PersonPublic } from '@/lib/modules/people/projection'

/**
 * Round avatar (bylines, compact lists). The photo is a Media Library asset and
 * keeps its focal point; without one the person's initials sit on a tint of the
 * design system's primary colour (ADR-043 D7) — no new colours.
 */
export function PersonAvatar({
  person,
  size = 40,
  alt = '',
  className = '',
}: {
  person: Pick<PersonPublic, 'photo' | 'firstName' | 'lastName' | 'displayName'>
  size?: number
  /** Empty (decorative) by default: the name is written next to it. */
  alt?: string
  className?: string
}) {
  const src = imageUrl(person.photo, size * 2)
  const box = { width: size, height: size }
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ ...box, objectPosition: focalObjectPosition(person.photo) }}
        loading="lazy"
        decoding="async"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${className}`}
      style={{
        ...box,
        fontSize: Math.max(11, Math.round(size * 0.38)),
        backgroundColor: 'color-mix(in oklch, var(--color-primary) 12%, transparent)',
        color: 'var(--color-primary)',
      }}
    >
      {personInitials(person)}
    </span>
  )
}
