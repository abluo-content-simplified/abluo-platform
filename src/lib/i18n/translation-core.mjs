// @ts-check
/**
 * Interface-translation core shared by the admin Translations page
 * (src/lib/i18n/translation-report.ts) and the fill script
 * (scripts/i18n-translate.mjs). Plain .mjs so plain `node` can run the script
 * without a TypeScript loader; TypeScript reads it through allowJs + JSDoc.
 *
 * Messages are the next-intl bundles in messages/<code>.json; English is the
 * source. Status lives in src/lib/i18n/interface-translation-status.json, one
 * line per translation:
 *
 *   { "<locale>": { "<dotted.key>": "machine:<hash>" | "original:<hash>" } }
 *
 * where <hash> is hashText() of the English the translation was made from.
 *
 * A translation is OUTDATED when its English has changed since (`h` no longer
 * matches). A key without a status entry is treated as original.
 */

/**
 * FNV-1a, 32-bit, over UTF-16 code units → 8 hex chars. Not security: only
 * "has this English string changed since?".
 * @param {string} text
 * @returns {string}
 */
export function hashText(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * "machine:1a2b3c4d" → { s: 'machine', h: '1a2b3c4d' }; anything malformed → null.
 * @param {unknown} value
 * @returns {{ s: 'machine' | 'original', h: string } | null}
 */
export function parseStatus(value) {
  if (typeof value !== 'string') return null
  const m = /^(machine|original):([0-9a-f]{8})$/.exec(value)
  return m ? { s: /** @type {'machine' | 'original'} */ (m[1]), h: m[2] } : null
}

/**
 * @param {'machine' | 'original'} state
 * @param {string} english
 * @returns {string}
 */
export function formatStatus(state, english) {
  return `${state}:${hashText(english)}`
}

/**
 * The status file as text: sorted, one translation per line (small, readable diffs).
 * @param {Record<string, Record<string, string>>} status
 * @returns {string}
 */
export function serializeStatus(status) {
  const locales = Object.keys(status).sort()
  const blocks = locales.map((l) => {
    const keys = Object.keys(status[l]).sort()
    const lines = keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(status[l][k])}`)
    return `  ${JSON.stringify(l)}: {${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}}`
  })
  return `{\n${blocks.join(',\n')}\n}\n`
}

/**
 * Nested message object → { "a.b.c": "text" } in document order.
 * @param {Record<string, unknown>} tree
 * @param {string} [prefix]
 * @returns {Record<string, string>}
 */
export function flattenMessages(tree, prefix = '') {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flattenMessages(/** @type {Record<string, unknown>} */ (v), key))
    else if (typeof v === 'string') out[key] = v
  }
  return out
}

/**
 * The ICU argument names ({count}, {n, plural, …}) and rich-text tag names
 * (<b>…</b>) a message uses, sorted, as one string. A translation must have
 * the same signature. Words inside plural/select branches are not arguments
 * and may change; arguments nested inside branches are found.
 * @param {string} text
 * @returns {string}
 */
export function messageSignature(text) {
  /** @type {Set<string>} */
  const args = new Set()
  /** @type {Set<string>} */
  const tags = new Set()
  const ws = (/** @type {number} */ i) => {
    while (i < text.length && /\s/.test(text[i])) i++
    return i
  }
  const word = (/** @type {number} */ i) => {
    const m = /^[^\s{},]+/.exec(text.slice(i))
    return m ? m[0] : ''
  }
  /** Text level, until an unmatched `}` (returns its index) or the end. */
  const message = (/** @type {number} */ i) => {
    while (i < text.length) {
      const c = text[i]
      if (c === "'" && text[i + 1] === "'") i += 2
      else if (c === '{') i = argument(i)
      else if (c === '}') return i
      else if (c === '<') {
        const m = /^<\/?([A-Za-z][\w-]*)\s*\/?>/.exec(text.slice(i))
        if (m) tags.add(m[1])
        i += m ? m[0].length : 1
      } else i++
    }
    return i
  }
  /** At a `{`; returns the index after its matching `}`. */
  const argument = (/** @type {number} */ i) => {
    i = ws(i + 1)
    const name = word(i)
    if (name) args.add(name)
    i = ws(i + name.length)
    if (text[i] !== ',') return text[i] === '}' ? i + 1 : i
    i = ws(i + 1)
    const type = word(i)
    i = ws(i + type.length)
    if (text[i] === '}') return i + 1
    if (/^(plural|select|selectordinal)$/.test(type)) {
      i = ws(i + 1) // past the second comma
      while (i < text.length && text[i] !== '}') {
        const sel = word(i)
        i = ws(i + sel.length)
        if (text[i] === '{') {
          i = message(i + 1)
          i = ws(i + 1)
        } else if (!sel) i++
      }
      return i + 1
    }
    // number / date / time styles: skip to the matching brace.
    let depth = 1
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
      i++
    }
    return i
  }
  message(0)
  return `${[...args].sort().join(',')}|${[...tags].sort().join(',')}`
}

/**
 * Rebuild `values` (flat) as a nested object in the ORDER of `source` (nested),
 * then append any keys `values` has that `source` lacks (never drops text).
 * @param {Record<string, unknown>} source
 * @param {Record<string, string>} values
 * @returns {Record<string, unknown>}
 */
export function nestLike(source, values) {
  /** @type {Set<string>} */
  const used = new Set()
  /**
   * @param {Record<string, unknown>} node
   * @param {string} prefix
   * @returns {Record<string, unknown>}
   */
  const walk = (node, prefix) => {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const child = walk(/** @type {Record<string, unknown>} */ (v), key)
        if (Object.keys(child).length) out[k] = child
      } else if (key in values) {
        out[k] = values[key]
        used.add(key)
      }
    }
    return out
  }
  const tree = walk(source, '')
  for (const [key, text] of Object.entries(values)) {
    if (used.has(key)) continue
    const parts = key.split('.')
    /** @type {Record<string, unknown>} */
    let node = tree
    for (const p of parts.slice(0, -1)) {
      if (!node[p] || typeof node[p] !== 'object') node[p] = {}
      node = /** @type {Record<string, unknown>} */ (node[p])
    }
    node[parts[parts.length - 1]] = text
  }
  return tree
}
