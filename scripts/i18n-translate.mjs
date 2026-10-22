#!/usr/bin/env node
/**
 * Fill missing dashboard (interface) translations — messages/<code>.json.
 *
 * English (messages/en.json) is the source. For every other bundle in
 * messages/ this script:
 *   • translates keys that are MISSING (or empty),
 *   • re-translates keys it machine-translated earlier whose English has
 *     changed since (a person's text — "original" — is never overwritten;
 *     it is only reported as outdated on the admin Translations page),
 *   • records each machine translation in
 *     src/lib/i18n/interface-translation-status.json ("machine:<hash of the
 *     English it was made from>").
 *
 * It never fails a release: no provider configured, a network error or a
 * reply that drops a {placeholder} only leaves that text missing and says so.
 * The dashboard falls back to English for missing text.
 *
 * Provider: Claude when ANTHROPIC_API_KEY + TRANSLATE_CLAUDE_MODEL are set
 * (best with ICU plurals and tone), otherwise Google Cloud Translation when
 * GOOGLE_TRANSLATE_API_KEY is set (messages with plural/select are left for
 * Claude or a person). Keys are read from the environment, then .env.local.
 *
 *   node scripts/i18n-translate.mjs              # fill + write
 *   node scripts/i18n-translate.mjs --dry-run    # report only, write nothing
 *   node scripts/i18n-translate.mjs --baseline   # record the current English hash for every
 *                                                # existing translation without a status (run once)
 *   node scripts/i18n-translate.mjs --locale it  # one language only
 *
 * Run by scripts/release.sh before the build gate.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flattenMessages, formatStatus, hashText, messageSignature, nestLike, parseStatus, serializeStatus } from '../src/lib/i18n/translation-core.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'messages')
const STATUS = join(ROOT, 'src/lib/i18n/interface-translation-status.json')
const SOURCE = 'en'
const BATCH = 60
const EXAMPLES = 30
const NAMES = { en: 'English', it: 'Italian', de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese', nl: 'Dutch' }

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const BASELINE = argv.includes('--baseline')
const onlyLocale = argv.includes('--locale') ? argv[argv.indexOf('--locale') + 1] : null

const log = (...a) => console.error('[i18n]', ...a)

// ── Environment (process env wins over .env.local) ──────────────────────────
function loadEnvLocal() {
  const p = join(ROOT, '.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

// ── Files ───────────────────────────────────────────────────────────────────
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
function writeJson(p, data) {
  const raw = existsSync(p) ? readFileSync(p, 'utf8') : '\n'
  writeFileSync(p, JSON.stringify(data, null, 2) + (raw.endsWith('\n') ? '\n' : ''))
}

// ── Providers ───────────────────────────────────────────────────────────────
function pickProvider() {
  if (process.env.ANTHROPIC_API_KEY && process.env.TRANSLATE_CLAUDE_MODEL) return { id: 'claude', translate: claudeBatch }
  if (process.env.GOOGLE_TRANSLATE_API_KEY) return { id: 'google', translate: googleBatch }
  return null
}

const SYSTEM = [
  'You translate the user interface of Abluo, a calm, minimal website dashboard used by small professional practices (therapists, dentists, studios).',
  'Each value is a next-intl ICU message. Keep every {argument} and the whole ICU structure ({n, plural, one {…} other {…}}, select, #) exactly; translate only the words, including the words inside plural/select branches, and use the plural categories the target language needs.',
  'Keep rich-text tags like <b>…</b> and <link>…</link> exactly. Keep brand and product names (Abluo, Sanity, Google, WhatsApp) unchanged.',
  'Be short and plain, like good interface copy. Match the terminology, capitalisation style and form of address (formal or informal) of the examples exactly.',
  'Reply with ONLY a JSON object mapping each given key to its translation.',
].join(' ')

async function claudeBatch({ items, target, examples }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.TRANSLATE_CLAUDE_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `Translate from English to ${NAMES[target] ?? target}.\n\n` +
            `Existing translations in this part of the product (follow their wording):\n${JSON.stringify(examples, null, 1)}\n\n` +
            `Translate these:\n${JSON.stringify(Object.fromEntries(items.map((i) => [i.key, i.en])), null, 1)}`,
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`claude HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = await res.json()
  const reply = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('')
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('claude: no JSON object in reply')
  return JSON.parse(reply.slice(start, end + 1))
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

async function googleBatch({ items, target }) {
  // Placeholders and tags are wrapped in notranslate spans so they come back untouched.
  const protect = (text) =>
    text.replace(/[&<>]/g, (c) => ESC[c]).replace(/\{[^{}]*\}|&lt;\/?[A-Za-z][\w-]*\s*\/?&gt;/g, (m) => `<span class="notranslate">${m}</span>`)
  const unprotect = (html) => decode(html.replace(/<span class="notranslate">([\s\S]*?)<\/span>/g, '$1'))
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(process.env.GOOGLE_TRANSLATE_API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: items.map((i) => protect(i.en)), source: 'en', target, format: 'html' }),
  })
  if (!res.ok) throw new Error(`google HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = await res.json()
  const out = body?.data?.translations ?? []
  return Object.fromEntries(items.map((i, n) => [i.key, out[n] ? unprotect(out[n].translatedText) : '']))
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  loadEnvLocal()
  const enTree = readJson(join(MESSAGES, `${SOURCE}.json`))
  const en = flattenMessages(enTree)
  const status = existsSync(STATUS) ? readJson(STATUS) : {}
  const targets = readdirSync(MESSAGES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .filter((l) => l !== SOURCE && (!onlyLocale || l === onlyLocale))
    .sort()

  const provider = BASELINE || DRY ? null : pickProvider()
  let wroteStatus = false
  const leftMissing = {}

  for (const target of targets) {
    const file = join(MESSAGES, `${target}.json`)
    const values = flattenMessages(readJson(file))
    const st = (status[target] ??= {})

    if (BASELINE) {
      let n = 0
      for (const [key, text] of Object.entries(values)) {
        if (en[key] !== undefined && text && !st[key]) {
          st[key] = formatStatus('original', en[key])
          n++
        }
      }
      log(`${target}: recorded ${n} existing translations as original`)
      wroteStatus = true
      continue
    }

    // Drop status entries for keys English no longer has.
    for (const key of Object.keys(st)) if (en[key] === undefined) { delete st[key]; wroteStatus = true }

    const todo = Object.entries(en)
      .filter(([key, text]) => {
        const v = values[key]
        if (v == null || v === '') return true
        const s = parseStatus(st[key])
        return s?.s === 'machine' && s.h !== hashText(text)
      })
      .map(([key, text]) => ({ key, en: text }))

    if (!todo.length) {
      log(`${target}: nothing to translate`)
      continue
    }
    log(`${target}: ${todo.length} to translate${DRY ? ' (dry run)' : ''}`)
    if (DRY || !provider) {
      if (!DRY) log(`${target}: no translation provider configured (ANTHROPIC_API_KEY + TRANSLATE_CLAUDE_MODEL, or GOOGLE_TRANSLATE_API_KEY) — left as is`)
      leftMissing[target] = todo.map((t) => t.key)
      continue
    }

    // Batches by area (first two key segments), so examples stay relevant.
    const groups = new Map()
    for (const item of todo) {
      const area = item.key.split('.').slice(0, 2).join('.')
      if (!groups.has(area)) groups.set(area, [])
      groups.get(area).push(item)
    }
    const failed = []
    let done = 0
    for (const [area, items] of groups) {
      const examples = Object.fromEntries(
        Object.entries(values)
          .filter(([k]) => k.startsWith(area + '.') && en[k] && parseStatus(st[k])?.s !== 'machine')
          .slice(0, EXAMPLES)
          .map(([k, v]) => [en[k], v]),
      )
      for (let i = 0; i < items.length; i += BATCH) {
        let batch = items.slice(i, i + BATCH)
        if (provider.id === 'google') {
          const icu = batch.filter((b) => /,\s*(plural|select|selectordinal)\s*,/.test(b.en))
          failed.push(...icu.map((b) => b.key))
          batch = batch.filter((b) => !icu.includes(b))
          if (!batch.length) continue
        }
        let out
        try {
          out = await provider.translate({ items: batch, target, examples })
        } catch (err) {
          log(`${target}: ${area} — ${err.message}`)
          failed.push(...batch.map((b) => b.key))
          continue
        }
        for (const item of batch) {
          const t = typeof out?.[item.key] === 'string' ? out[item.key].trim() : ''
          if (!t || messageSignature(t) !== messageSignature(item.en)) {
            failed.push(item.key)
            continue
          }
          values[item.key] = t
          st[item.key] = formatStatus('machine', item.en)
          done++
        }
      }
    }
    writeJson(file, nestLike(enTree, values))
    wroteStatus = true
    log(`${target}: translated ${done} with ${provider.id}${failed.length ? `, ${failed.length} left for a person` : ''}`)
    if (failed.length) leftMissing[target] = failed
  }

  if (wroteStatus && !DRY) writeFileSync(STATUS, serializeStatus(status))

  const open = Object.entries(leftMissing)
  if (open.length) {
    log('⚠ Missing translations (the dashboards show English for these):')
    for (const [l, keys] of open) log(`  ${l}: ${keys.length} — ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', …' : ''}`)
  }
}

main().catch((err) => {
  // Never block a release over translations.
  log(`translation step skipped: ${err?.message ?? err}`)
  process.exitCode = 0
})
