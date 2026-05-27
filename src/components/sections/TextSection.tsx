import type { TextSection, PortableTextContent } from '@/lib/sanity/types'

function RichText({ blocks, dark }: { blocks: PortableTextContent; dark?: boolean }) {
  const bodyClass = dark ? 'text-zinc-300' : 'text-zinc-600'
  const headingClass = dark ? 'text-white' : 'text-zinc-900'
  const bulletClass = dark ? 'text-zinc-300' : 'text-zinc-600'

  // Group consecutive bullet blocks into a list
  const elements: React.ReactNode[] = []
  let bulletBuffer: typeof blocks = []

  const flushBullets = (key: string) => {
    if (bulletBuffer.length === 0) return
    elements.push(
      <ul key={`ul-${key}`} className="space-y-2 pl-4">
        {bulletBuffer.map((b) => (
          <li key={b._key} className={`flex gap-2 text-base leading-relaxed ${bulletClass}`}>
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" aria-hidden="true" />
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
        <h2 key={block._key} className={`text-2xl font-semibold ${headingClass}`}>{text}</h2>
      )
    } else {
      elements.push(
        <p key={block._key} className={`text-base leading-relaxed ${bodyClass}`}>{text}</p>
      )
    }
  })

  return <div className="space-y-4">{elements}</div>
}

const backgroundStyles = {
  white: 'bg-white',
  grey: 'bg-zinc-50',
  dark: 'bg-zinc-900',
} as const

interface Props {
  section: TextSection
}

export function TextSection({ section }: Props) {
  const { eyebrow, title, content, backgroundColor = 'white' } = section
  const bg = backgroundStyles[backgroundColor] ?? backgroundStyles.white
  const isDark = backgroundColor === 'dark'

  return (
    <section className={`${bg} px-6 py-24 md:px-16 lg:px-24`}>
      <div className="mx-auto w-full max-w-3xl">
        {eyebrow && (
          <p className={`mb-4 text-xs font-medium uppercase tracking-[0.2em] ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {eyebrow}
          </p>
        )}
        {title && (
          <h2 className={`mb-10 text-3xl font-semibold leading-snug tracking-tight md:text-4xl ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            {title}
          </h2>
        )}
        {content && <RichText blocks={content} dark={isDark} />}
      </div>
    </section>
  )
}
