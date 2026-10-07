/**
 * A person's avatar: their photo when there is one (only Abluo-hosted images
 * reach the client — see safeAvatarUrl), else their initials on a muted
 * circle. Decorative: the name is always written next to it.
 *
 *   <Avatar name="Claudia Hoffmann" email="c@…" src={url} size="md" />
 */
const SIZE = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-base',
} as const

export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (email.trim()[0] ?? '?').toUpperCase()
}

export function Avatar({
  name,
  email,
  src,
  size = 'md',
  muted = false,
}: {
  name: string
  email: string
  src?: string | null
  size?: keyof typeof SIZE
  /** Archived / not yet joined: a quieter circle. */
  muted?: boolean
}) {
  const box = `${SIZE[size]} shrink-0 rounded-full`
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- small avatar from Abluo storage
    return <img src={src} alt="" aria-hidden="true" loading="lazy" referrerPolicy="no-referrer" className={`${box} bg-muted object-cover ${muted ? 'opacity-60' : ''}`} />
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} grid place-items-center font-semibold ${muted ? 'border border-dashed border-border text-muted-foreground' : 'bg-muted text-foreground'}`}
    >
      {initials(name, email)}
    </span>
  )
}
