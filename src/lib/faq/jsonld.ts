/**
 * FAQPage structured data — one block per URL (ADR-037 D7).
 *
 * Every FAQ item RENDERED on a page — each FAQ section, a post's sets — is
 * collected into ONE FAQPage, in render order, de-duplicated by normalised
 * question text. Only items visible in this language reach it (the same
 * placementFaqGroups the page renders from), never draft or archived sets.
 *
 * `acceptedAnswer.text` is limited HTML — p, ul, ol, li, strong, em, a — which
 * Google accepts for FAQPage. Internal links resolve exactly as on the page
 * (resolveBodyLinks); a link whose target is unavailable is emitted as plain
 * text, never as a dead <a>. Site paths become absolute when the site has a
 * canonical origin.
 *
 * Expectation, recorded so nobody oversells it: Google limited FAQ rich
 * results to authoritative government and health sites in 2023. The value is
 * the visible text and answer engines reading clean structured data.
 */
import type { PortableTextBlock } from '@/lib/sanity/types'
import { resolveBodyLinks } from '@/lib/links/link-target'
import { safeLinkHref } from '@/lib/links/safe-href'
import { normaliseQuestion, type FaqAnswer, type FaqGroup } from './items'

export interface FaqLinkContext {
  /** Link prefix of this site (`/it/hoffmann`, or `/it` on its own domain). */
  siteBase: string
  siteHosts?: readonly string[]
  /** Fallback project for internal links when a group carries none. */
  projectSlug?: string | null
  /** `https://domain` — makes site paths absolute in the JSON-LD. */
  origin?: string | null
}

export interface FaqJsonLdItem {
  question: string
  /** Limited HTML. */
  answerHtml: string
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Span = { _type?: string; text?: string; marks?: string[] }
type LinkDef = { _key?: string; _type?: string; href?: string }

function spansHtml(block: PortableTextBlock, origin: string | null | undefined): string {
  const defs = new Map<string, LinkDef>()
  for (const d of (block.markDefs ?? []) as LinkDef[]) if (d?._key) defs.set(d._key, d)
  return (block.children ?? [])
    .map((child) => {
      const span = child as Span
      if (typeof span?.text !== 'string' || !span.text) return ''
      let html = escapeHtml(span.text)
      const marks = Array.isArray(span.marks) ? span.marks : []
      if (marks.includes('em')) html = `<em>${html}</em>`
      if (marks.includes('strong')) html = `<strong>${html}</strong>`
      for (const m of marks) {
        const def = defs.get(m)
        if (!def || def._type !== 'link') continue
        const safe = safeLinkHref(def.href)
        if (!safe) continue // unavailable target or unsafe href → plain text
        const href = origin && safe.startsWith('/') && !safe.startsWith('//') ? `${origin}${safe}` : safe
        html = `<a href="${escapeHtml(href)}">${html}</a>`
      }
      return html
    })
    .join('')
}

/** Restricted Portable Text → limited HTML (lists flattened to one level). */
export function blocksToLimitedHtml(blocks: PortableTextBlock[], origin?: string | null): string {
  let out = ''
  let openList: 'ul' | 'ol' | null = null
  for (const block of blocks) {
    if (!block || block._type !== 'block') continue
    const inner = spansHtml(block, origin)
    const list = block.listItem === 'number' ? 'ol' : block.listItem === 'bullet' ? 'ul' : null
    if (list !== openList) {
      if (openList) out += `</${openList}>`
      if (list) out += `<${list}>`
      openList = list
    }
    if (!inner.trim()) continue
    out += list ? `<li>${inner}</li>` : `<p>${inner}</p>`
  }
  if (openList) out += `</${openList}>`
  return out
}

/** One answer as limited HTML, its links resolved as on the page. */
export function answerHtml(answer: FaqAnswer, ctx: FaqLinkContext, projectSlug?: string | null): string {
  if (answer.kind === 'plain') return escapeHtml(answer.text)
  const resolved = resolveBodyLinks(answer.blocks, {
    siteBase: ctx.siteBase,
    siteHosts: ctx.siteHosts,
    projectSlug: projectSlug ?? ctx.projectSlug ?? null,
  })
  return blocksToLimitedHtml(resolved, ctx.origin)
}

/** The JSON-LD items of rendered groups, in order. */
export function faqJsonLdItems(groups: FaqGroup[], ctx: FaqLinkContext): FaqJsonLdItem[] {
  return groups.flatMap((g) =>
    g.items.map((item) => ({ question: item.question, answerHtml: answerHtml(item.answer, ctx, g.projectSlug) })),
  )
}

/** Concatenates in render order, keeping the first of each normalised question. */
export function mergeFaqJsonLdItems(...lists: FaqJsonLdItem[][]): FaqJsonLdItem[] {
  const seen = new Set<string>()
  const out: FaqJsonLdItem[] = []
  for (const item of lists.flat()) {
    const key = normaliseQuestion(item.question)
    if (!key || !item.answerHtml.trim() || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** The one FAQPage of a URL, or null when it has no FAQ. */
export function buildFaqPageSchema(input: {
  items: FaqJsonLdItem[]
  /** Canonical URL of the page (the block's @id), when known. */
  url?: string | null
  /** Canonical origin, for isPartOf. */
  origin?: string | null
}): Record<string, unknown> | null {
  const items = mergeFaqJsonLdItems(input.items)
  if (items.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    ...(input.url ? { '@id': `${input.url}#faq` } : {}),
    ...(input.origin ? { isPartOf: { '@id': `${input.origin}#website` } } : {}),
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answerHtml },
    })),
  }
}
