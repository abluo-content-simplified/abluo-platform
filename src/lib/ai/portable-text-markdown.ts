/**
 * Portable Text ⇄ Markdown for AI round-trips (ADR-026 §5). Pure, no I/O.
 *
 * Covers exactly the dashboard's allowed body shape (see `sanitizeBlocks` in
 * `src/lib/api/post-drafts.ts`): paragraphs, h2/h3, blockquotes, bullet and
 * numbered lists at levels 1–4, **bold** and *italic*. Models speak Markdown
 * far more reliably than they preserve JSON keys, so the provider only ever
 * sees and returns Markdown.
 *
 * The parser is deliberately forgiving: whatever the model returns is mapped
 * onto that shape — `#` becomes h2, `####`+ becomes h3, links keep their text,
 * images / code fences / rules / HTML are dropped to plain text. Output still
 * goes through `sanitizeBlocks` afterwards.
 */

export type PtStyle = 'normal' | 'h2' | 'h3' | 'blockquote'
export type PtListItem = 'bullet' | 'number'
export type PtSpan = { _type: 'span'; _key: string; text: string; marks: string[] }
export type PtBlock = {
  _type: 'block'
  _key: string
  style: PtStyle
  listItem?: PtListItem
  level?: number
  markDefs: never[]
  children: PtSpan[]
}

const MAX_LEVEL = 4

// ── Portable Text → Markdown ─────────────────────────────────────────────────

type InBlock = {
  style?: string
  listItem?: string
  level?: number
  children?: { text?: string; marks?: string[] }[]
}

/** Text of all spans, for size limits. */
export function blocksPlainTextLength(blocks: unknown[]): number {
  let n = 0
  for (const b of blocks as InBlock[]) for (const s of Array.isArray(b?.children) ? b.children : []) n += typeof s?.text === 'string' ? s.text.length : 0
  return n
}

const escapeInline = (text: string) => text.replace(/[\\*_]/g, '\\$&')

function spansToInline(children: InBlock['children']): string {
  // Merge neighbours with identical marks first so `**a****b**` never appears.
  const merged: { text: string; strong: boolean; em: boolean }[] = []
  for (const s of children ?? []) {
    const text = typeof s?.text === 'string' ? s.text : ''
    if (!text) continue
    const marks = Array.isArray(s.marks) ? s.marks : []
    const strong = marks.includes('strong')
    const em = marks.includes('em')
    const last = merged.at(-1)
    if (last && last.strong === strong && last.em === em) last.text += text
    else merged.push({ text, strong, em })
  }
  let out = ''
  for (const { text, strong, em } of merged) {
    const escaped = escapeInline(text)
    if ((!strong && !em) || !text.trim()) {
      out += escaped
      continue
    }
    // Emphasis may not start or end on whitespace: move it outside the markers.
    const m = escaped.match(/^(\s*)([\s\S]*?)(\s*)$/)!
    const d = strong && em ? '***' : strong ? '**' : '*'
    // Keep marked text on one line so a newline can't split the markers.
    out += m[1] + d + m[2] + d + m[3]
  }
  return out
}

/** Stop a paragraph line from being read back as a heading, list, quote or rule. */
function escapeLineStart(line: string): string {
  const lead = line.match(/^\s*/)![0]
  const rest = line.slice(lead.length)
  if (/^(#{1,6}(\s|$)|>|[-+]\s|```|(-\s*){3,}$)/.test(rest)) return `${lead}\\${rest}`
  const num = rest.match(/^(\d{1,9})([.)])(\s)/)
  if (num) return `${lead}${num[1]}\\${rest.slice(num[1].length)}`
  return line
}

export function blocksToMarkdown(blocks: unknown[]): string {
  const parts: string[] = []
  const counters: number[] = []
  let prevWasList = false

  for (const raw of blocks as InBlock[]) {
    const inline = spansToInline(raw?.children)
    if (!inline.trim()) continue
    const style = raw?.style ?? 'normal'

    if (raw?.listItem === 'bullet' || raw?.listItem === 'number') {
      const level = Math.min(Math.max(Number(raw.level) || 1, 1), MAX_LEVEL)
      if (!prevWasList) counters.length = 0
      counters.length = Math.min(counters.length, level)
      let marker = '-'
      if (raw.listItem === 'number') {
        counters[level - 1] = (counters[level - 1] ?? 0) + 1
        marker = `${counters[level - 1]}.`
      } else {
        counters[level - 1] = 0
      }
      const indent = '  '.repeat(level - 1)
      const cont = indent + ' '.repeat(marker.length + 1)
      const [first, ...more] = inline.split('\n')
      const text = [`${indent}${marker} ${first}`, ...more.map((l) => cont + escapeLineStart(l).trimStart())].join('\n')
      parts.push((prevWasList ? '\n' : parts.length ? '\n\n' : '') + text)
      prevWasList = true
      continue
    }

    prevWasList = false
    counters.length = 0
    let text: string
    if (style === 'h2') text = `## ${inline.replace(/\s*\n\s*/g, ' ')}`
    else if (style === 'h3') text = `### ${inline.replace(/\s*\n\s*/g, ' ')}`
    else if (style === 'blockquote') text = inline.split('\n').map((l) => `> ${l}`).join('\n')
    else text = inline.replace(/\n\s*\n/g, '\n').split('\n').map(escapeLineStart).join('\n')
    parts.push((parts.length ? '\n\n' : '') + text)
  }
  return parts.join('')
}

// ── Markdown → Portable Text ─────────────────────────────────────────────────

type Pending =
  | { kind: 'para'; lines: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'item'; listItem: PtListItem; level: number; lines: string[] }

export type KeyFn = () => string

export const defaultKey: KeyFn = () => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)

/** Remove wrapping the model sometimes adds around the answer. */
function unwrap(md: string): string {
  let s = md.replace(/\r\n?/g, '\n')
  s = s.replace(/^\s*<\/?(draft|improved|text|answer)>\s*$/gim, '')
  const fenced = s.match(/^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/)
  if (fenced) s = fenced[1]
  return s
}

export function markdownToBlocks(md: string, key: KeyFn = defaultKey): PtBlock[] {
  const out: PtBlock[] = []
  const lines = unwrap(md).split('\n')
  let pending: Pending | null = null
  let listIndents: number[] = []

  const flush = () => {
    if (!pending) return
    const p = pending
    pending = null
    const text = p.lines.join('\n')
    if (p.kind === 'item') pushBlock(text, 'normal', p.listItem, p.level)
    else pushBlock(text, p.kind === 'quote' ? 'blockquote' : 'normal')
  }
  const pushBlock = (text: string, style: PtStyle, listItem?: PtListItem, level?: number) => {
    const children = parseInline(text, key)
    if (!children.length) return
    const block: PtBlock = { _type: 'block', _key: key(), style, markDefs: [], children }
    if (listItem) {
      block.listItem = listItem
      block.level = level
    }
    out.push(block)
  }
  const endList = () => {
    listIndents = []
  }

  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    if (/^\s*```/.test(line)) {
      // Code fences: drop the fence, keep the content as ordinary text.
      flush()
      endList()
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      endList()
      continue
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)(\s+#+)?\s*$/)
    if (heading) {
      flush()
      endList()
      pushBlock(heading[2], heading[1].length <= 2 ? 'h2' : 'h3')
      continue
    }
    const quote = line.match(/^\s{0,3}>\s?(.*)$/)
    if (quote) {
      if (pending?.kind !== 'quote') {
        flush()
        endList()
        pending = { kind: 'quote', lines: [] }
      }
      pending.lines.push(quote[1])
      continue
    }
    const item = line.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/)
    if (item) {
      flush()
      const indent = item[1].replace(/\t/g, '    ').length
      while (listIndents.length && listIndents[listIndents.length - 1] > indent) listIndents.pop()
      if (!listIndents.length || listIndents[listIndents.length - 1] < indent) listIndents.push(indent)
      const level = Math.min(listIndents.length, MAX_LEVEL)
      pending = { kind: 'item', listItem: /\d/.test(item[2]) ? 'number' : 'bullet', level, lines: [item[3]] }
      continue
    }
    // Plain text line: continues the open block (CommonMark "lazy" continuation) or starts a paragraph.
    if (pending?.kind === 'item' || pending?.kind === 'quote') {
      pending.lines.push(line.trim())
      continue
    }
    if (pending?.kind === 'para') {
      pending.lines.push(line)
      continue
    }
    endList()
    pending = { kind: 'para', lines: [line] }
  }
  flush()
  return out
}

// ── Inline ───────────────────────────────────────────────────────────────────

type Tok =
  | { t: 'text'; v: string }
  | { t: 'delim'; ch: string; len: number; open: boolean; close: boolean; role?: 'open' | 'close' }

const PUNCT = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u

function stripInlineSyntax(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^()]*\))+(?:\s+"[^"]*")?\)/g, '$1') // links → text
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, '$1') // autolinks
    .replace(/`([^`\n]+)`/g, '$1') // inline code
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/g, '') // HTML tags
}

export function parseInline(src: string, key: KeyFn = defaultKey): PtSpan[] {
  const s = stripInlineSyntax(src)
  const toks: Tok[] = []
  let buf = ''
  const pushText = () => {
    if (buf) toks.push({ t: 'text', v: buf })
    buf = ''
  }
  for (let i = 0; i < s.length; ) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1])) {
      buf += s[i + 1]
      i += 2
      continue
    }
    if (c === '*' || c === '_') {
      let j = i
      while (j < s.length && s[j] === c) j++
      const len = j - i
      const prev = i > 0 ? s[i - 1] : ''
      const next = j < s.length ? s[j] : ''
      const intraword = c === '_' && WORD.test(prev) && WORD.test(next)
      if (len > 3 || intraword) {
        buf += s.slice(i, j)
      } else {
        pushText()
        toks.push({ t: 'delim', ch: c, len, open: !!next && !/\s/.test(next), close: !!prev && !/\s/.test(prev) })
      }
      i = j
      continue
    }
    buf += c
    i++
  }
  pushText()

  // Pair delimiters: same char and run length, nearest opener wins.
  const stack: number[] = []
  toks.forEach((tok, idx) => {
    if (tok.t !== 'delim') return
    if (tok.close) {
      for (let k = stack.length - 1; k >= 0; k--) {
        const op = toks[stack[k]] as Extract<Tok, { t: 'delim' }>
        if (op.ch === tok.ch && op.len === tok.len) {
          op.role = 'open'
          tok.role = 'close'
          stack.length = k
          return
        }
      }
    }
    if (tok.open) stack.push(idx)
  })

  const spans: { text: string; strong: boolean; em: boolean }[] = []
  let strong = 0
  let em = 0
  const emit = (text: string) => {
    if (!text) return
    const last = spans.at(-1)
    const st = strong > 0
    const e = em > 0
    if (last && last.strong === st && last.em === e) last.text += text
    else spans.push({ text, strong: st, em: e })
  }
  for (const tok of toks) {
    if (tok.t === 'text') {
      emit(tok.v)
      continue
    }
    if (!tok.role) {
      emit(tok.ch.repeat(tok.len))
      continue
    }
    const d = tok.role === 'open' ? 1 : -1
    if (tok.len >= 2) strong += d
    if (tok.len !== 2) em += d
  }

  const result = spans.filter((sp) => sp.text.length > 0)
  if (!result.some((sp) => sp.text.trim())) return []
  return result.map((sp) => ({
    _type: 'span' as const,
    _key: key(),
    text: sp.text,
    marks: [...(sp.strong ? ['strong'] : []), ...(sp.em ? ['em'] : [])],
  }))
}
