/**
 * ADR-040 R9 — the optional note under the sign-in of a members-only page
 * (`page.access.promptNote`), e.g. "Not a member yet? See …".
 *
 * Restricted rich text (schema type `accessPromptNote`): paragraphs, bold and
 * the shared body link. Anything else that slipped into stored data renders as
 * a plain paragraph. Links go through the shared link mark — unsafe hrefs
 * become plain text (src/lib/links/safe-href.ts), other websites open in a new
 * tab (src/lib/links/link-target.ts). The caller passes the blocks already
 * through `resolveBodyLinks`, so internal links carry their URL.
 *
 * Line breaks typed with Shift+Return are kept (Portable Text's hard breaks).
 * No usable text → renders nothing, so a page without a note is unchanged.
 */
import { PortableText } from '@portabletext/react'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'

type NoteBlock = { _type?: unknown; children?: Array<{ text?: unknown }> }

/** True when at least one paragraph carries visible text. */
export function hasPromptNote(blocks: unknown): blocks is unknown[] {
  if (!Array.isArray(blocks)) return false
  return blocks.some((b: NoteBlock) =>
    b?._type === 'block' && Array.isArray(b.children) && b.children.some((c) => typeof c?.text === 'string' && c.text.trim() !== '')
  )
}

const Paragraph = ({ children }: { children?: React.ReactNode }) => <p className="m-0 mb-2 last:mb-0">{children}</p>

const components = {
  // One renderer for every block style: a heading that slipped in is a paragraph.
  block: Paragraph,
  marks: {
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
    link: articlePortableTextComponents.marks.link,
  },
  list: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  listItem: Paragraph,
  unknownMark: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  unknownType: () => null,
}

export function AccessPromptNote({ blocks }: { blocks: unknown }) {
  if (!hasPromptNote(blocks)) return null
  const value = blocks.filter((b) => (b as NoteBlock)?._type === 'block') as Parameters<typeof PortableText>[0]['value']
  return (
    <div
      className="mx-auto mt-6 w-full max-w-[400px] text-sm leading-relaxed text-pretty"
      style={{ color: 'var(--color-text-muted, var(--color-text-secondary))', fontFamily: 'var(--font-body)' }}
      data-access="prompt-note"
    >
      <PortableText value={value} components={components} />
    </div>
  )
}
