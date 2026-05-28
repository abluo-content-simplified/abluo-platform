import type { ContentSection, PortableTextContent } from '@/lib/sanity/types'

// Minimal portable text renderer — handles normal paragraph blocks
function RichText({ blocks }: { blocks: PortableTextContent }) {
  return (
    <div className="space-y-4">
      {blocks.map((block) => {
        if (block._type !== 'block') return null
        const text = block.children.map((c) => c.text).join('')
        if (block.style === 'h2') {
          return (
            <h2 key={block._key} className="text-2xl font-semibold text-zinc-900">
              {text}
            </h2>
          )
        }
        if (block.style === 'h3') {
          return (
            <h3 key={block._key} className="text-xl font-medium text-zinc-900">
              {text}
            </h3>
          )
        }
        return (
          <p key={block._key} className="text-base leading-relaxed text-zinc-600">
            {text}
          </p>
        )
      })}
    </div>
  )
}

interface Props {
  section: ContentSection
}

export function ContentSection({ section }: Props) {
  const { eyebrow, title, body } = section

  return (
    <section className="bg-zinc-50 px-6 py-24 md:px-16 lg:px-24">
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid gap-12 md:grid-cols-2 md:gap-20 lg:gap-28">
          {/* Left: label + title */}
          <div className="flex flex-col justify-center">
            {eyebrow && (
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="text-3xl font-semibold leading-snug tracking-tight text-zinc-900 md:text-4xl">
                {title}
              </h2>
            )}
          </div>

          {/* Right: body text */}
          <div className="flex flex-col justify-center">
            {body && <RichText blocks={body} />}
          </div>
        </div>
      </div>
    </section>
  )
}
