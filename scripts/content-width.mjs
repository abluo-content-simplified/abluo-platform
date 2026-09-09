#!/usr/bin/env node
/**
 * Read or set `layout.maxContentWidth` on a design system.
 *
 * ── Why this script exists ───────────────────────────────────────────────────
 * Until 2a9f280 the renderer IGNORED this field. Every site rendered at the
 * hardcoded 1120px regardless of what its design system said — so the two
 * values that were set (ds-nologo 1200, psicoterapia-base 1280) had never once
 * been looked at by anybody. They were typed into a field that did nothing.
 *
 * Now the field works, which means those two numbers would ship untested and
 * simultaneously. The honest starting position is therefore NOT "honour what is
 * declared" but "declare what is actually rendering", and then change each site
 * deliberately, one at a time, with somebody looking at it.
 *
 * Usage:
 *   node scripts/content-width.mjs                       # show every design system
 *   node scripts/content-width.mjs <id> <px> --apply     # set one
 *   node scripts/content-width.mjs --pin-all-to-current --apply
 *       Writes 1120 explicitly everywhere it is unset or untested, so nothing
 *       moves and every value from then on is one somebody chose.
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const PIN_ALL = args.includes('--pin-all-to-current')
const positional = args.filter((a) => !a.startsWith('--'))

/** What SectionContainer falls back to when nothing is set. */
const RENDERED_DEFAULT = 1120

const envPath = path.resolve(process.cwd(), '.env.local')
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const PID = env.NEXT_PUBLIC_SANITY_PROJECT_ID
const DS = env.NEXT_PUBLIC_SANITY_DATASET
const TOK = env.SANITY_API_WRITE_TOKEN || env.SANITY_AUTH_TOKEN

const q = async (groq) => {
  const r = await fetch(`https://${PID}.api.sanity.io/v2026-05-21/data/query/${DS}?query=${encodeURIComponent(groq)}`,
    { headers: { Authorization: `Bearer ${TOK}` } })
  if (!r.ok) throw new Error(`query ${r.status} ${await r.text()}`)
  return (await r.json()).result
}
const mutate = async (mutations) => {
  const r = await fetch(`https://${PID}.api.sanity.io/v2026-05-21/data/mutate/${DS}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutations }),
  })
  if (!r.ok) throw new Error(`mutate ${r.status} ${await r.text()}`)
  return r.json()
}

const systems = await q(`*[_type=="designSystem"]|order(_id){
  _id, name, role, "own": layout.maxContentWidth,
  "parent": parentDesignSystem->_id,
  "inherited": parentDesignSystem->layout.maxContentWidth
}`)

// ── set one ──────────────────────────────────────────────────────────────────
if (positional.length === 2) {
  const [id, px] = positional
  const width = Number(px)
  if (!Number.isFinite(width) || width < 320 || width > 3000) {
    console.error(`"${px}" is not a plausible width in px.`); process.exit(1)
  }
  const target = systems.find((s) => s._id === id)
  if (!target) { console.error(`No design system "${id}".`); process.exit(1) }
  const before = target.own ?? target.inherited ?? RENDERED_DEFAULT
  console.log(`\n${target.name}\n  ${before}px → ${width}px${APPLY ? '' : '   (dry run)'}\n`)
  if (APPLY) {
    await mutate([{ patch: { id, set: { 'layout.maxContentWidth': width } } }])
    console.log('Written. Redeploy is NOT needed — this is content, read at request time.\n')
  }
  process.exit(0)
}

// ── report ───────────────────────────────────────────────────────────────────
console.log('\nlayout.maxContentWidth — what each design system says, and what it renders\n')
console.log(`  ${'design system'.padEnd(34)} ${'own'.padStart(6)} ${'inherit'.padStart(8)} ${'RENDERS'.padStart(8)}   note`)
const toPin = []
for (const s of systems) {
  const effective = s.own ?? s.inherited ?? null
  const renders = effective ?? RENDERED_DEFAULT
  let note = ''
  if (s.own == null && s.inherited == null) note = 'unset — falls back'
  else if (s.own == null) note = `inherited from ${s.parent}`
  else note = 'set on this document'
  if (effective != null && effective !== RENDERED_DEFAULT) note += '  ⚠ NEVER RENDERED BEFORE 2a9f280'
  if (effective == null || effective !== RENDERED_DEFAULT) toPin.push(s._id)
  console.log(`  ${s._id.slice(0, 34).padEnd(34)} ${String(s.own ?? '–').padStart(6)} ${String(s.inherited ?? '–').padStart(8)} ${String(renders).padStart(8)}   ${note}`)
}

if (PIN_ALL) {
  console.log(`\n--pin-all-to-current: writing ${RENDERED_DEFAULT} explicitly to ${toPin.length} design system(s)`)
  console.log('  so that nothing moves, and every value after this is one somebody chose:')
  for (const id of toPin) console.log(`    ${id}`)
  if (APPLY) {
    await mutate(toPin.map((id) => ({ patch: { id, set: { 'layout.maxContentWidth': RENDERED_DEFAULT } } })))
    console.log('\nWritten.\n')
  } else {
    console.log('\nDry run only — add --apply.\n')
  }
} else {
  console.log('\n  To change one:  node scripts/content-width.mjs <design-system-id> <px> --apply')
  console.log('  To freeze all:  node scripts/content-width.mjs --pin-all-to-current --apply\n')
}
