import { PortableText } from '@portabletext/react'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'
import { resolveBodyLinks } from '@/lib/links/link-target'
import type { FaqAnswer as FaqAnswerValue } from '@/lib/faq/items'
import { multiline } from '@/lib/multiline-text'

// ── FaqAnswer (server) ────────────────────────────────────────────────────────
// One answer. Restricted rich text (ADR-037 D12): paragraphs, lists, bold,
// italic, links — exactly what faqAnswerText allows, so anything else that
// slipped into stored data renders as a paragraph, never as a heading. Links go
// through the shared resolver and the shared link mark (same rules as article
// bodies: plain text when the target is unavailable, new-tab rule).

const components = {
  block: {
    normal: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
  },
  list: {
    bullet: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 mb-3 last:mb-0 space-y-1">{children}</ul>,
    number: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 mb-3 last:mb-0 space-y-1">{children}</ol>,
  },
  listItem: {
    bullet: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
    number: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  },
  marks: {
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
    link: articlePortableTextComponents.marks.link,
  },
  unknownBlockStyle: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
  unknownMark: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  unknownType: () => null,
}

export interface FaqLinkOptions {
  siteBase: string
  siteHosts?: readonly string[]
  projectSlug?: string | null
}

export function FaqAnswer({ answer, links }: { answer: FaqAnswerValue; links: FaqLinkOptions }) {
  if (answer.kind === 'plain') return <p className={multiline()}>{answer.text}</p>
  const value = resolveBodyLinks(answer.blocks, links) as Parameters<typeof PortableText>[0]['value']
  return <PortableText value={value} components={components} />
}
