/**
 * Body normalisation for the dashboard editor ("Tell your story", ADR-025).
 *
 * The editor — and especially text pasted from Word, Google Docs or a web
 * page — can emit more than the server accepts. `normalizeBlocks` maps any
 * Portable Text-ish value onto exactly the shape `sanitizeBlocks`
 * (src/lib/api/post-drafts.ts) allows, so autosave never fails on a paste.
 *
 * SUPPORTED (anyone may create them):
 *   - styles normal / h2 / h3 / blockquote; lists bullet / number, level 1–4
 *   - decorators strong / em (b/bold → strong, i/italic → em)
 *   - link annotations `{ _type: 'link', _key, href, blank? }` with a safe
 *     href (see `normalizeHref`)
 *
 * PRESERVED (existing posts opened for editing — never lose content):
 *   anything else is kept only if the REFERENCE body (what is stored for this
 *   language) already has it — the same rule the server applies:
 *   - a top-level non-text block (image, embed, …), an inline object or an
 *     unknown annotation: kept when a deep-equal copy with the same `_key`
 *     exists in the reference; otherwise dropped (annotation text is kept)
 *   - an unsupported style / list type / decorator (h1, h4, code, …): kept
 *     when the reference body uses it somewhere; otherwise styles fall back
 *     (h1 → h2, h4–h6 → h3, rest → normal), list types to bullet and
 *     decorators are dropped
 *
 * Also: keys kept when valid, generated otherwise, made unique; unused
 * markDefs removed; empty trailing paragraphs trimmed; size limits respected.
 *
 * Pure and dependency-free (safe in client bundles — it must NOT import
 * post-drafts, which pulls in the Sanity write client). post-drafts imports
 * the shared helpers (`normalizeHref`, `stableJson`, `bodyReference`) from here.
 */
import type { PortableTextBlock } from '@portabletext/editor'

/** Mirrors the body LIMITS in post-drafts.ts (kept in sync by normalize-blocks.test.ts). */
export const BODY_LIMITS = { blocks: 2000, spansPerBlock: 500, spanText: 20_000, markDefsPerBlock: 100, href: 2048 } as const

export const BODY_KEY = /^[A-Za-z0-9_-]{1,64}$/
export const SUPPORTED_STYLES = ['normal', 'h2', 'h3', 'blockquote'] as const
export const SUPPORTED_LISTS = ['bullet', 'number'] as const
export const SUPPORTED_DECORATORS = ['strong', 'em'] as const

const STYLE_FALLBACK: Record<string, string> = { h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3' }
const DECORATOR_ALIAS: Record<string, string> = { b: 'strong', bold: 'strong', i: 'em', italic: 'em' }

export type BodySpan = { _type: 'span'; _key: string; text: string; marks: string[] }
/** A preserved inline object, annotation or top-level block — opaque, kept byte-for-byte. */
export type BodyObject = { _type: string; _key: string; [field: string]: unknown }
export type BodyInternalRef = { _type: 'reference'; _ref: string; _weak?: boolean }
/** An external/site-relative link (`href`) or an internal reference (`internal`) — never both. */
export type BodyLink =
  | { _type: 'link'; _key: string; href: string; blank?: boolean }
  | { _type: 'link'; _key: string; internal: BodyInternalRef; blank?: boolean }
export type BodyBlock = {
  _type: 'block'
  _key: string
  style: string
  markDefs: (BodyLink | BodyObject)[]
  listItem?: string
  level?: number
  children: (BodySpan | BodyObject)[]
}
export type BodyItem = BodyBlock | BodyObject

export function isTextBlock(item: unknown): item is BodyBlock {
  return !!item && typeof item === 'object' && (item as { _type?: unknown })._type === 'block'
}
export function isSpan(child: unknown): child is BodySpan {
  return !!child && typeof child === 'object' && (child as { _type?: unknown })._type === 'span'
}

// ── Links ────────────────────────────────────────────────────────────────────

/**
 * Validates a link target. Accepts http(s) URLs, mailto:, tel: and
 * site-relative paths ("/contatti"). Refuses javascript:, data:, protocol-
 * relative "//host", whitespace/control characters and everything else.
 * Returns the trimmed href, or null.
 */
export function normalizeHref(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const href = input.trim()
  if (!href || href.length > BODY_LIMITS.href) return null
  if (/[\s\u0000-\u001f\u007f<>"`\\]/.test(href)) return null
  if (href.startsWith('/')) return href.startsWith('//') ? null : href
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
  if (scheme === 'http' || scheme === 'https') {
    try {
      const url = new URL(href)
      return url.hostname && /^\/\//.test(href.slice(scheme.length + 1)) ? href : null
    } catch {
      return null
    }
  }
  if (scheme === 'mailto') return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(href) ? href : null
  if (scheme === 'tel') return /^tel:\+?[0-9().-]{3,32}$/i.test(href) ? href : null
  return null
}

/**
 * What a person typed into the link field → a safe href, or null.
 * "www.studio.it" / "studio.it/contatti" get https://, "name@x.it" gets mailto:.
 */
export function hrefFromUserInput(input: string): string | null {
  const v = input.trim()
  if (!v) return null
  const direct = normalizeHref(v)
  if (direct) return direct
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('/')) return null
  if (/^[^@\s/]+@[^@\s]+\.[^@\s]+$/.test(v)) return normalizeHref(`mailto:${v}`)
  if (/^\+?[0-9][0-9 ().-]{4,}$/.test(v)) return normalizeHref(`tel:${v.replace(/[\s]/g, '')}`)
  if (/^[^\s/]+\.[a-z]{2,}(\/|$|\?|#)/i.test(v)) return normalizeHref(`https://${v}`)
  return null
}

/** A published document id: no `drafts.` / `versions.` (no dots), no paths. */
export const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** `{ _type: 'reference', _ref, _weak? }` rebuilt, or null. */
export function cleanInternalRef(value: unknown): BodyInternalRef | null {
  const r = value as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || r._type !== 'reference' || typeof r._ref !== 'string' || !DOC_ID.test(r._ref)) return null
  if (Object.keys(r).some((k) => !['_type', '_ref', '_weak'].includes(k))) return null
  if (r._weak !== undefined && r._weak !== true) return null
  return r._weak ? { _type: 'reference', _ref: r._ref, _weak: true } : { _type: 'reference', _ref: r._ref }
}

/**
 * A link markDef in the supported shape, rebuilt; null when it isn't one.
 * Either a safe `href` or an `internal` reference (its project is checked on
 * the server), plus an optional boolean `blank` (new-tab override).
 */
export function cleanLink(def: unknown): BodyLink | null {
  const d = def as Record<string, unknown> | null
  if (!d || d._type !== 'link' || typeof d._key !== 'string' || !BODY_KEY.test(d._key)) return null
  if (Object.keys(d).some((k) => !['_type', '_key', 'href', 'internal', 'blank'].includes(k))) return null
  if (d.blank !== undefined && typeof d.blank !== 'boolean') return null
  const blank = d.blank === undefined ? {} : { blank: d.blank }
  if (d.internal !== undefined) {
    if (d.href !== undefined) return null
    const internal = cleanInternalRef(d.internal)
    return internal ? { _type: 'link', _key: d._key, internal, ...blank } : null
  }
  const href = normalizeHref(d.href)
  if (!href || href !== d.href) return null
  return { _type: 'link', _key: d._key, href, ...blank }
}

/** Every internal-link target id in a body (supported links only). */
export function collectInternalRefs(value: unknown): Set<string> {
  const out = new Set<string>()
  for (const b of Array.isArray(value) ? value : []) {
    for (const d of (b as { markDefs?: unknown[] })?.markDefs ?? []) {
      const link = cleanLink(d)
      if (link && 'internal' in link) out.add(link.internal._ref)
    }
  }
  return out
}

// ── Reference (what is already stored) ───────────────────────────────────────

/** Deterministic JSON (sorted keys) for deep-equality checks. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export type BodyReference = {
  styles: Set<string>
  lists: Set<string>
  decorators: Set<string>
  /** `_key` → stableJson copies, for top-level non-text blocks. */
  objects: Map<string, Set<string>>
  /** `_key` → stableJson copies, for markDefs anywhere in the body (keys are only unique per block). */
  markDefs: Map<string, Set<string>>
  /** `_key` → stableJson copies, for inline objects anywhere in the body. */
  inlines: Map<string, Set<string>>
}

/** Indexes a stored body so preserved content can be recognised. */
export function bodyReference(existing: unknown): BodyReference {
  const ref: BodyReference = {
    styles: new Set(),
    lists: new Set(),
    decorators: new Set(),
    objects: new Map(),
    markDefs: new Map(),
    inlines: new Map(),
  }
  if (!Array.isArray(existing)) return ref
  const add = (index: Map<string, Set<string>>, key: string, value: unknown) => {
    const set = index.get(key) ?? new Set<string>()
    set.add(stableJson(value))
    index.set(key, set)
  }
  for (const raw of existing) {
    const b = raw as Record<string, unknown> | null
    if (!b || typeof b !== 'object' || typeof b._key !== 'string') continue
    if (b._type !== 'block') {
      add(ref.objects, b._key, b)
      continue
    }
    if (typeof b.style === 'string') ref.styles.add(b.style)
    if (typeof b.listItem === 'string') ref.lists.add(b.listItem)
    const defKeys = new Set<string>()
    for (const d of Array.isArray(b.markDefs) ? b.markDefs : []) {
      const def = d as Record<string, unknown> | null
      if (def && typeof def._key === 'string') {
        add(ref.markDefs, def._key, def)
        defKeys.add(def._key)
      }
    }
    for (const c of Array.isArray(b.children) ? b.children : []) {
      const child = c as Record<string, unknown> | null
      if (!child || typeof child._key !== 'string') continue
      if (child._type === 'span') {
        for (const m of Array.isArray(child.marks) ? child.marks : []) if (typeof m === 'string' && !defKeys.has(m)) ref.decorators.add(m)
      } else add(ref.inlines, child._key, child)
    }
  }
  return ref
}

// ── Normalisation ────────────────────────────────────────────────────────────

export function newKey(): string {
  let k = ''
  for (let i = 0; i < 12; i++) k += Math.floor(Math.random() * 16).toString(16)
  return k
}

function uniqueKey(raw: unknown, used: Set<string>): string {
  let key = typeof raw === 'string' && BODY_KEY.test(raw) && !used.has(raw) ? raw : newKey()
  while (used.has(key)) key = newKey()
  used.add(key)
  return key
}

/** A preserved object is kept only as an exact copy of the stored one. */
export function preserved(obj: unknown, index: Map<string, Set<string>>): BodyObject | null {
  const o = obj as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || typeof o._key !== 'string' || typeof o._type !== 'string') return null
  return index.get(o._key)?.has(stableJson(o)) ? (o as BodyObject) : null
}

type Run = { key?: unknown; text: string; marks: string[] }

function normalizeChildren(children: unknown, keepMark: (m: string) => string | null, ref: BodyReference): (BodySpan | BodyObject)[] {
  if (!Array.isArray(children)) return []
  const items: (Run | BodyObject)[] = []
  for (const raw of children) {
    const s = raw as Record<string, unknown> | null
    if (!s || typeof s !== 'object') continue
    if (s._type !== 'span') {
      const inline = preserved(s, ref.inlines)
      if (inline) items.push(inline)
      continue
    }
    const text = typeof s.text === 'string' ? s.text : ''
    const marks = Array.isArray(s.marks)
      ? [...new Set(s.marks.map((m) => keepMark(String(m))).filter((m): m is string => !!m))]
      : []
    const prev = items[items.length - 1]
    // Merge neighbouring spans with identical marks (dropped annotations leave these).
    if (prev && !('_type' in prev) && [...prev.marks].sort().join() === [...marks].sort().join()) prev.text += text
    else items.push({ key: s._key, text, marks })
  }
  // Respect the server's limits: split over-long text, cap the child count.
  const pieces: (Run | BodyObject)[] = []
  for (const r of items) {
    if ('_type' in r || r.text.length <= BODY_LIMITS.spanText) pieces.push(r)
    else
      for (let i = 0; i < r.text.length; i += BODY_LIMITS.spanText) {
        pieces.push({ key: i === 0 ? r.key : undefined, text: r.text.slice(i, i + BODY_LIMITS.spanText), marks: r.marks })
      }
  }
  const used = new Set<string>()
  const out: (BodySpan | BodyObject)[] = []
  for (const r of pieces.slice(0, BODY_LIMITS.spansPerBlock)) {
    if ('_type' in r) {
      if (used.has(r._key)) continue // a duplicated preserved object can't keep its identity
      used.add(r._key)
      out.push(r)
    } else out.push({ _type: 'span', _key: uniqueKey(r.key, used), text: r.text, marks: r.marks })
  }
  return out
}

function isEmpty(item: BodyItem): boolean {
  return isTextBlock(item) && item.children.every((c) => isSpan(c) && c.text.trim() === '')
}

/**
 * Maps whatever the editor (or a paste) produced onto the server's body shape.
 * `reference` is the body currently stored for this language: content we
 * don't support survives only if it is an unchanged copy of something there.
 * Always returns a value `sanitizeBlocks(out, reference)` accepts; `[]` means "no body".
 */
export function normalizeBlocks(value: unknown, reference?: unknown): BodyItem[] {
  if (!Array.isArray(value)) return []
  const ref = bodyReference(reference)
  const usedBlockKeys = new Set<string>()
  const out: BodyItem[] = []
  for (const raw of value) {
    const b = raw as Record<string, unknown> | null
    if (!b || typeof b !== 'object') continue
    if (b._type !== 'block') {
      const obj = preserved(b, ref.objects)
      if (obj && !usedBlockKeys.has(obj._key)) {
        usedBlockKeys.add(obj._key)
        out.push(obj)
      }
      continue
    }

    const rawStyle = typeof b.style === 'string' ? b.style : 'normal'
    const style =
      (SUPPORTED_STYLES as readonly string[]).includes(rawStyle) || ref.styles.has(rawStyle)
        ? rawStyle
        : (STYLE_FALLBACK[rawStyle] ?? 'normal')

    // markDefs: supported links rebuilt, preserved annotations kept verbatim, the rest dropped.
    const defs = new Map<string, BodyLink | BodyObject>()
    for (const d of Array.isArray(b.markDefs) ? b.markDefs : []) {
      const def = cleanLink(d) ?? preserved(d, ref.markDefs)
      if (def && !defs.has(def._key) && defs.size < BODY_LIMITS.markDefsPerBlock) defs.set(def._key, def)
    }
    const keepMark = (m: string): string | null => {
      if (defs.has(m)) return m
      const alias = DECORATOR_ALIAS[m] ?? m
      if ((SUPPORTED_DECORATORS as readonly string[]).includes(alias)) return alias
      return ref.decorators.has(m) ? m : null
    }
    const children = normalizeChildren(b.children, keepMark, ref)
    if (!children.length) children.push({ _type: 'span', _key: newKey(), text: '', marks: [] })
    const usedMarks = new Set(children.flatMap((c) => (isSpan(c) ? c.marks : [])))

    const block: BodyBlock = {
      _type: 'block',
      _key: uniqueKey(b._key, usedBlockKeys),
      style,
      markDefs: [...defs.values()].filter((d) => usedMarks.has(d._key)),
      children,
    }
    if (typeof b.listItem === 'string' && b.listItem) {
      block.listItem =
        (SUPPORTED_LISTS as readonly string[]).includes(b.listItem) || ref.lists.has(b.listItem) ? b.listItem : 'bullet'
      const level = typeof b.level === 'number' && Number.isFinite(b.level) ? Math.round(b.level) : 1
      block.level = Math.min(4, Math.max(1, level))
    }
    out.push(block)
  }
  while (out.length && isEmpty(out[out.length - 1])) out.pop()
  return out.slice(0, BODY_LIMITS.blocks)
}

/** True when a body holds content the dashboard can't create (images, embeds, unknown annotations…). */
export function hasPreservedContent(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some((b) => {
    if (!isTextBlock(b)) return true
    if (b.children?.some((c) => !isSpan(c))) return true
    return (b.markDefs ?? []).some((d) => !cleanLink(d))
  })
}

/** Plain text of a body, one block per line (for word counts and AI prompts). */
export function blocksToPlainText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .filter(isTextBlock)
    .map((b) => (Array.isArray(b.children) ? b.children : []).map((s) => (isSpan(s) && typeof s.text === 'string' ? s.text : '')).join(''))
    .join('\n')
}

export function countWords(value: unknown): number {
  const text = blocksToPlainText(value).trim()
  return text ? text.split(/\s+/u).length : 0
}

/** Minutes to read at ~200 words a minute; at least 1 once there is any text. */
export function readingMinutes(words: number): number {
  return words > 0 ? Math.max(1, Math.round(words / 200)) : 0
}

/**
 * Plain text (e.g. from the clipboard) → body blocks. One paragraph per line;
 * blank lines are separators; "- ", "* ", "• " start bullets and "1. " / "1) "
 * start numbered items.
 */
export function textToBlocks(text: string): BodyBlock[] {
  const blocks: unknown[] = []
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const bullet = line.match(/^[-*•–]\s+(.*)$/u)
    const number = line.match(/^\d{1,3}[.)]\s+(.*)$/u)
    const body = bullet?.[1] ?? number?.[1] ?? line
    blocks.push({
      _type: 'block',
      style: 'normal',
      ...(bullet ? { listItem: 'bullet', level: 1 } : number ? { listItem: 'number', level: 1 } : {}),
      children: [{ _type: 'span', text: body, marks: [] }],
    })
  }
  return normalizeBlocks(blocks) as BodyBlock[]
}

/** Narrow helper for callers holding the editor's own type. */
export function asEditorValue(blocks: BodyItem[]): PortableTextBlock[] {
  return blocks as unknown as PortableTextBlock[]
}
