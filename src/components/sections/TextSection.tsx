import type { TextSection, PortableTextContent } from '@/lib/sanity/types'

function RichText({ blocks }: { blocks: PortableTextContent }) {
  const elements: React.ReactNode[] = []
  let bulletBuffer: typeof blocks = []

  const flushBullets = (key: string) => {
    if (bulletBuffer.length === 0) return
    elements.push(
      <ul key={`ul-${key}`} className="space-y-2 pl-4">
        {bulletBuffer.map((b) => (
          <li
            key={b._key}
            className="flex gap-2 text-base leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <span
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: 'var(--color-text-muted)' }}
              aria-hidden="true"
            />
            <span>{b.children.map((c) => c.text).join('')}</span>
          </li>
        ))}
      </ul>
    )
    bulletBuffer = []
  }

  blocks.forEach((block, i) => {
    if (block._type !== 'block') return
    const text = block.children.map((c) => c.text).join('')
    const isLast = i === blocks.length - 1

    if (block.listItem === 'bullet') {
      bulletBuffer.push(block)
      if (isLast) flushBullets(block._key)
      return
    }

    flushBullets(block._key)

    if (block.style === 'h2') {
      elements.push(
        <h2
          key={block._key}
          className="text-2xl font-semibold"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {text}
        </h2>
      )
    } else {
      elements.push(
        <p
          key={block._key}
          className="text-base leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {text}
        </p>
      )
    }
  })

  return <div className="space-y-4">{elements}</div>
}

// Background colours: 'white' → background, 'grey' → background-alt, 'dark' → surface
const BG_TOKEN: Record<string, string> = {
  white: 'var(--color-background)',
  grey: 'var(--color-background-alt)',
  dark: 'var(--color-surface)',
}

interface Props {
  section: TextSection
}

export function TextSection({ section }: Props) {
  const { eyebrow, title, content, backgroundColor = 'white' } = section
  const bgToken = BG_TOKEN[backgroundColor] ?? BG_TOKEN.white

  // In 'dark' sections, text tokens stay the same — they're already dynamic.
  // The surface token is the darkest background, so text will naturally stand out.

  return (
    <section
      className="px-6 py-24 md:px-16 lg:px-24"
      style={{ backgroundColor: bgToken }}
    >
      <div className="mx-auto w-full max-w-3xl">
        {eyebrow && (
          <p
            className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {eyebrow}
          </p>
        )}
        {title && (
          <h2
            className="mb-10 text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
          >
            {title}
          </h2>
        )}
        {content && <RichText blocks={content} />}
      </div>
    </section>
  )
}
