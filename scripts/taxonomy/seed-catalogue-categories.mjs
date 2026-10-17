#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — seed-catalogue-categories.mjs   (ADR-033 Amendment J, J-8 step 2)
//
// Copies a project's Catalogue category list (the module config:
// moduleInstallations[catalogue].config.categories) into `taxonomyTerm`
// records, one per entry, with the IDENTICAL key and label map, so the
// dual-read code (catalogueCategoryVocabulary) reads the same vocabulary from
// the records. Content is never touched: items store keys and keep resolving.
//
// ORDER OF OPERATIONS — never run --apply before the dual-read code is deployed
// to the environment whose dataset you write to. All environments share one
// Sanity dataset; production runs the Catalogue (v1.0.55+), so deploy the
// dual-read release to production FIRST, then seed.
//
// USAGE
//   node scripts/taxonomy/seed-catalogue-categories.mjs --project tmz            # DRY RUN (default)
//   node scripts/taxonomy/seed-catalogue-categories.mjs --project tmz --apply    # writes
//   node scripts/taxonomy/seed-catalogue-categories.mjs --project tmz --json     # plan + comparison as JSON on stdout
//
// DRY RUN is read-only and prints what it would create, then the before/after
// comparison of every catalogue item's resolved categories (config list vs the
// term records that would exist), per site language.
// --apply writes ONLY `createIfNotExists` mutations with the deterministic id
// term.<projectSlug>.catalogue.category.<key> (idempotent; an existing record is
// never overwritten), in one transaction, then re-reads and prints the
// comparison from the stored records.
//
// Needs for --apply: SANITY_API_WRITE_TOKEN (or SANITY_AUTH_TOKEN). Reads use
// SANITY_API_READ_TOKEN, else the write token, else none (published only).
// Env comes from the process, then .env.local / .env in the repo root. Token
// values are never printed.
//
// EXIT CODES  0 ok / nothing to do · 1 dry run has records to create, or a
// comparison differs, or an entry is invalid · 2 could not run
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planCategorySeed, seedMutations, compareResolved, SLUG_PART } from '../lib/taxonomy-seed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(HERE, '..', '..')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : null
}
if (has('--help') || has('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}
const APPLY = has('--apply')
const JSON_OUT = has('--json')
const PROJECT = val('--project')
const say = (...a) => console.error(...a)

if (!PROJECT || !SLUG_PART.test(PROJECT) || (has('--dry-run') && APPLY)) {
  say('Usage: node scripts/taxonomy/seed-catalogue-categories.mjs --project <projectSlug> [--dry-run | --apply] [--json]')
  process.exit(2)
}

function loadEnvFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, eq).trim()] = v
  }
  return out
}
const fileEnv = { ...loadEnvFile(join(REPO_ROOT, '.env')), ...loadEnvFile(join(REPO_ROOT, '.env.local')) }
const env = (k) => process.env[k] || fileEnv[k] || ''

const PROJECT_ID = env('NEXT_PUBLIC_SANITY_PROJECT_ID') || '3n7t84j3'
const DATASET = env('NEXT_PUBLIC_SANITY_DATASET') || 'production'
const API_VERSION = '2026-05-21' // = SANITY_API_VERSION in src/lib/sanity/config.ts
const WRITE_TOKEN = env('SANITY_API_WRITE_TOKEN') || env('SANITY_AUTH_TOKEN')
const READ_TOKEN = env('SANITY_API_READ_TOKEN') || WRITE_TOKEN
if (APPLY && !WRITE_TOKEN) {
  say('--apply needs SANITY_API_WRITE_TOKEN (or SANITY_AUTH_TOKEN) in the environment or .env.local.')
  process.exit(2)
}

const API_BASE = `https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}`
async function sanity(path, body, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Sanity API ${res.status} on ${path.split('?')[0]}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}
const query = (q, params = {}) => sanity(`/data/query/${DATASET}?perspective=raw`, { query: q, params }, READ_TOKEN).then((r) => r.result)

// One read: the config list, existing term records, site languages and every item
// (published + draft copies, each with its stored keys).
const READ = `{
  "config": *[_type == "project" && projectSlug == $slug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "catalogue"][0].config.categories,
  "terms": *[_type == "taxonomyTerm" && projectSlug == $slug && module == "catalogue" && kind == "category" && !(_id in path("drafts.**"))]{ _id, key, label, color, order },
  "site": *[_type == "siteConfig" && projectSlug == $slug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales },
  "items": *[_type == "catalogueItem" && projectSlug == $slug && !(_id in path("versions.**"))]{ _id, "name": coalesce(name.it, name.en, name[$first], _id), categories }
}`

const show = (m) => Object.entries(m ?? {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k}: ${v}`).join(' | ') || '(no label)'

function printComparison(rows, title) {
  say('')
  say(`${title}  (${rows.length} item document(s); a draft copy and its published copy are separate rows)`)
  let diff = 0
  for (const r of rows) {
    if (!r.keys.length) continue
    const mark = r.identical ? 'same   ' : 'DIFFERS'
    if (!r.identical) diff += 1
    say(`  ${mark} ${r.id}  "${r.name}"  keys [${r.keys.join(', ')}]`)
    for (const p of r.perLocale) {
      const fmt = (c) => (c.length ? c.map((x) => x.label).join(', ') : '—')
      say(`            ${p.locale}: config → ${fmt(p.before)}   terms → ${fmt(p.after)}${p.identical ? '' : '   ← differs'}`)
    }
  }
  const withCategories = rows.filter((r) => r.keys.length).length
  say(`  ${withCategories} item document(s) carry categories; ${diff} differ.`)
  return diff
}

async function main() {
  say(`Abluo — seed Catalogue categories  ${PROJECT_ID}/${DATASET}  project "${PROJECT}"  ${APPLY ? 'APPLY' : 'dry run'}`)
  if (!READ_TOKEN) say('! No token: published documents only; draft item copies are not compared.')
  const data = (await query(READ, { slug: PROJECT, first: 'it' })) ?? {}
  const locales = [...new Set([data.site?.defaultLocale, ...(data.site?.supportedLocales ?? [])].filter(Boolean))]
  const defaultLocale = data.site?.defaultLocale ?? locales[0] ?? 'en'
  if (!locales.length) locales.push(defaultLocale)
  const now = new Date().toISOString()

  const plan = planCategorySeed({ projectSlug: PROJECT, configList: data.config, existing: data.terms ?? [], now })
  say('')
  say(`Config list: ${Array.isArray(data.config) ? data.config.length : 0} entr${(data.config ?? []).length === 1 ? 'y' : 'ies'}; existing term records: ${(data.terms ?? []).length}`)
  for (const p of plan.problems) say(`  PROBLEM: ${p}`)
  for (const i of plan.items) {
    const tag = { create: 'CREATE ', exists: 'exists ', differs: 'DIFFERS', invalid: 'INVALID' }[i.status]
    say(`  ${tag} ${i.id || '(no id)'}${i.doc ? `  order ${i.doc.order}  ${show(i.doc.label)}${i.doc.color ? `  color ${i.doc.color}` : ''}` : ''}${i.reason ? `  — ${i.reason}` : ''}`)
  }
  const toCreate = plan.items.filter((i) => i.status === 'create')
  const blocked = plan.problems.length + plan.items.filter((i) => i.status === 'invalid' || i.status === 'differs').length

  // "After" = the records that exist now plus those that would be created.
  const simulated = [...(data.terms ?? []), ...toCreate.map((i) => ({ key: i.doc.key, label: i.doc.label, color: i.doc.color, order: i.doc.order }))]
  const cmpInput = { items: data.items ?? [], configList: data.config, locales, defaultLocale }
  let diff = printComparison(compareResolved({ ...cmpInput, terms: simulated }), 'BEFORE (config list) vs AFTER (term records, as planned)')
  if (JSON_OUT) console.log(JSON.stringify({ plan, comparison: compareResolved({ ...cmpInput, terms: simulated }) }, null, 2))

  if (!APPLY) {
    say('')
    say(toCreate.length ? `Dry run — nothing written. ${toCreate.length} record(s) would be created. Re-run with --apply (after the dual-read release is deployed).` : 'Dry run — nothing to create.')
    return toCreate.length || blocked || diff ? 1 : 0
  }
  if (blocked) {
    say(`Refusing to write: ${blocked} problem(s) above need a decision first.`)
    return 1
  }
  if (toCreate.length) {
    const res = await sanity(`/data/mutate/${DATASET}?returnIds=true&visibility=sync`, { mutations: seedMutations(plan) }, WRITE_TOKEN)
    const created = (res.results ?? []).filter((r) => r.operation === 'create').length
    say(`Created ${created}, already existed ${toCreate.length - created} (transaction ${res.transactionId ?? '?'}).`)
  }
  // Verify from the stored records.
  const after = (await query(READ, { slug: PROJECT, first: 'it' })) ?? {}
  diff = printComparison(compareResolved({ ...cmpInput, items: after.items ?? [], terms: after.terms ?? [] }), 'VERIFY — config list vs stored term records')
  return diff ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    say(`Failed: ${error?.message ?? error}`)
    process.exit(2)
  }
)
