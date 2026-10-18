#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — seed-categories.mjs   (ADR-033 Amendment J, J-8 step 2)
//
// Copies a project's category list for ONE module (the module config:
// moduleInstallations[<module>].config.categories) into `taxonomyTerm`
// records, one per entry, with the IDENTICAL key and label map, so the
// dual-read code reads the same vocabulary from the records. Content is never
// touched: documents store keys and keep resolving.
//
// Modules: catalogue (catalogueItem), blog = Posts (post), news (newsArticle),
// events (event). Blog categories are public pages (/category/<key>), so for
// blog the page fields are copied too — description, redirectFrom (the flat
// list of retired keys is stored under the site's default language; the website
// merges all languages), noindex — and the dry run proves, per key, that the
// page served from the records equals the page served from the config list.
//
// ORDER OF OPERATIONS — never run --apply before the dual-read code is deployed
// to the environment whose dataset you write to. All environments share one
// Sanity dataset and production reads the config lists until the next release,
// so deploy the dual-read release to production FIRST, then seed.
//
// USAGE
//   node scripts/taxonomy/seed-categories.mjs --module blog --project tmz            # DRY RUN (default)
//   node scripts/taxonomy/seed-categories.mjs --module blog --all                    # dry run for every project with the module
//   node scripts/taxonomy/seed-categories.mjs --module news --project tmz --apply    # writes (one project at a time)
//   node scripts/taxonomy/seed-categories.mjs --module events --project tmz --json   # plan + comparison as JSON on stdout
//
// DRY RUN is read-only and prints what it would create, then the before/after
// comparison of every document's resolved categories (config list vs the term
// records that would exist), per site language; for blog also the per-key page
// comparison and the keys content uses that the list does not define.
// --apply writes ONLY `createIfNotExists` mutations with the deterministic id
// term.<projectSlug>.<module>.category.<key> (idempotent; an existing record is
// never overwritten), in one transaction, then re-reads and prints the
// comparison from the stored records. --all is dry run only.
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
import { planCategorySeed, seedMutations, compareResolved, compareRoutable, SEED_MODULES, SLUG_PART } from '../lib/taxonomy-seed.mjs'

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
const ALL = has('--all')
const JSON_OUT = has('--json')
const PROJECT = val('--project')
const MODULE = val('--module') ?? 'catalogue'
const say = (...a) => console.error(...a)
const USAGE = `Usage: node scripts/taxonomy/seed-categories.mjs --module <${Object.keys(SEED_MODULES).join('|')}> (--project <projectSlug> | --all) [--dry-run | --apply] [--json]`

if (!SEED_MODULES[MODULE] || (!ALL && (!PROJECT || !SLUG_PART.test(PROJECT))) || (ALL && (PROJECT || APPLY)) || (has('--dry-run') && APPLY)) {
  say(USAGE)
  process.exit(2)
}
const { type: ITEM_TYPE, field: ITEM_FIELD, routable: ROUTABLE } = SEED_MODULES[MODULE]

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

// Projects that have the module installed (for --all).
const PROJECTS = `*[_type == "project" && !(_id in path("drafts.**")) && count(moduleInstallations[moduleId == $module]) > 0]{ projectSlug, "enabled": moduleInstallations[moduleId == $module][0].enabled != false, "n": count(moduleInstallations[moduleId == $module][0].config.categories) } | order(projectSlug asc)`

// One read: the config list, existing term records, site languages and every
// content document (published + draft copies, each with its stored keys). The
// type and field names are interpolated from the fixed SEED_MODULES table.
const READ = `{
  "config": *[_type == "project" && projectSlug == $slug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == $module][0].config.categories,
  "terms": *[_type == "taxonomyTerm" && projectSlug == $slug && module == $module && kind == "category" && !(_id in path("drafts.**"))]{ _id, key, label, color, order, description, redirectFrom, noindex },
  "site": *[_type == "siteConfig" && projectSlug == $slug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales },
  "items": *[_type == "${ITEM_TYPE}" && projectSlug == $slug && !(_id in path("versions.**"))]{ _id, "name": coalesce(title, name), "categories": ${ITEM_FIELD} }
}`

const show = (m) => Object.entries(m ?? {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k}: ${v}`).join(' | ') || '(no label)'
const nameOf = (n, locales) => {
  if (typeof n === 'string') return n
  if (n && typeof n === 'object') for (const l of [...locales, 'en']) if (typeof n[l] === 'string' && n[l]) return n[l]
  return ''
}

function printComparison(rows, title) {
  say('')
  say(`${title}  (${rows.length} document(s); a draft copy and its published copy are separate rows)`)
  let diff = 0
  for (const r of rows) {
    if (!r.keys.length) continue
    const mark = r.identical ? 'same   ' : 'DIFFERS'
    if (!r.identical) diff += 1
    say(`  ${mark} ${r.id}  "${r.name}"  keys [${r.keys.map((k) => (typeof k === 'string' ? k : JSON.stringify(k))).join(', ')}]`)
    if (!r.identical) {
      for (const p of r.perLocale) {
        const fmt = (c) => (c.length ? c.map((x) => x.label).join(', ') : '—')
        say(`            ${p.locale}: config → ${fmt(p.before)}   terms → ${fmt(p.after)}${p.identical ? '' : '   ← differs'}`)
      }
    }
  }
  const withCategories = rows.filter((r) => r.keys.length).length
  say(`  ${withCategories} document(s) carry categories; ${diff} differ.`)
  return diff
}

/** Keys the content uses that the list does not define, and stored entries that are not plain keys. */
function contentGaps(items, configList) {
  const defined = new Set((Array.isArray(configList) ? configList : []).map((e) => e?.value))
  const unknown = new Map()
  const notKeys = []
  for (const it of items) {
    for (const k of Array.isArray(it.categories) ? it.categories : []) {
      if (typeof k !== 'string') notKeys.push(it._id ?? it.id)
      else if (!defined.has(k)) unknown.set(k, (unknown.get(k) ?? 0) + 1)
    }
  }
  return { unknown: [...unknown.entries()], notKeys: [...new Set(notKeys)] }
}

async function seedProject(project) {
  say('')
  say(`══ ${MODULE} · project "${project}" ${'═'.repeat(30)}`)
  const data = (await query(READ, { slug: project, module: MODULE })) ?? {}
  const locales = [...new Set([data.site?.defaultLocale, ...(data.site?.supportedLocales ?? [])].filter(Boolean))]
  const defaultLocale = data.site?.defaultLocale ?? locales[0] ?? 'en'
  if (!locales.length) locales.push(defaultLocale)
  const now = new Date().toISOString()
  const items = (data.items ?? []).map((i) => ({ id: i._id, name: nameOf(i.name, locales), categories: i.categories }))

  const plan = planCategorySeed({ projectSlug: project, module: MODULE, routable: ROUTABLE, defaultLocale, configList: data.config, existing: data.terms ?? [], now })
  say(`Languages: ${locales.join(', ')} (default ${defaultLocale})`)
  say(`Config list: ${Array.isArray(data.config) ? data.config.length : 0} entr${(data.config ?? []).length === 1 ? 'y' : 'ies'}; existing term records: ${(data.terms ?? []).length}`)
  for (const p of plan.problems) say(`  PROBLEM: ${p}`)
  for (const i of plan.items) {
    const tag = { create: 'CREATE ', exists: 'exists ', differs: 'DIFFERS', invalid: 'INVALID' }[i.status]
    const d = i.doc
    const page = d ? [d.description ? 'description' : '', d.redirectFrom ? `redirectFrom [${d.redirectFrom[defaultLocale].join(', ')}]` : '', d.noindex ? 'noindex' : ''].filter(Boolean).join(', ') : ''
    say(`  ${tag} ${i.id || '(no id)'}${d ? `  order ${d.order}  ${show(d.label)}${d.color ? `  color ${d.color}` : ''}${page ? `  + ${page}` : ''}` : ''}${i.reason ? `  — ${i.reason}` : ''}${i.ignored ? `  — NOT copied (${MODULE} terms have no page fields): ${i.ignored.join(', ')}` : ''}`)
  }
  const toCreate = plan.items.filter((i) => i.status === 'create')
  const blocked = plan.problems.length + plan.items.filter((i) => i.status === 'invalid' || i.status === 'differs').length

  // "After" = the records that exist now plus those that would be created.
  const simulated = [...(data.terms ?? []), ...toCreate.map((i) => ({ key: i.doc.key, label: i.doc.label, color: i.doc.color, order: i.doc.order, description: i.doc.description, redirectFrom: i.doc.redirectFrom, noindex: i.doc.noindex }))]
  const cmpInput = { items, configList: data.config, locales, defaultLocale }
  let diff = printComparison(compareResolved({ ...cmpInput, terms: simulated }), 'BEFORE (config list) vs AFTER (term records, as planned)')

  const gaps = contentGaps(data.items ?? [], data.config)
  if (gaps.unknown.length) say(`  Content uses keys the list does not define (they already resolve to nothing today; unchanged): ${gaps.unknown.map(([k, n]) => `${k} ×${n}`).join(', ')}`)
  if (gaps.notKeys.length) say(`  ${gaps.notKeys.length} document(s) hold category entries that are not plain keys (old references); unchanged and not counted: ${gaps.notKeys.slice(0, 5).join(', ')}${gaps.notKeys.length > 5 ? ', …' : ''}`)

  let pages = []
  if (ROUTABLE) {
    pages = compareRoutable({ configList: data.config, terms: simulated, locales, defaultLocale })
    say('')
    say(`PAGES /category/<key> — served from the config list vs from the term records (title, description, colour, noindex, redirects), ${pages.length} key(s)`)
    for (const r of pages) say(`  ${r.identical ? 'same   ' : 'DIFFERS'} ${r.key}${r.differences.length ? `  ← ${r.differences.join(', ')}` : ''}`)
    diff += pages.filter((r) => !r.identical).length
  }
  if (JSON_OUT) console.log(JSON.stringify({ project, module: MODULE, plan, comparison: compareResolved({ ...cmpInput, terms: simulated }), pages, gaps }, null, 2))

  if (!APPLY) {
    say('')
    say(toCreate.length ? `Dry run — nothing written. ${toCreate.length} record(s) would be created.` : 'Dry run — nothing to create.')
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
  const after = (await query(READ, { slug: project, module: MODULE })) ?? {}
  const afterItems = (after.items ?? []).map((i) => ({ id: i._id, name: nameOf(i.name, locales), categories: i.categories }))
  diff = printComparison(compareResolved({ ...cmpInput, items: afterItems, terms: after.terms ?? [] }), 'VERIFY — config list vs stored term records')
  if (ROUTABLE) diff += compareRoutable({ configList: data.config, terms: after.terms ?? [], locales, defaultLocale }).filter((r) => !r.identical).length
  return diff ? 1 : 0
}

async function main() {
  say(`Abluo — seed ${MODULE} categories  ${PROJECT_ID}/${DATASET}  ${ALL ? 'all projects' : `project "${PROJECT}"`}  ${APPLY ? 'APPLY' : 'dry run'}`)
  if (!READ_TOKEN) say('! No token: published documents only; draft copies are not compared.')
  const projects = ALL ? (await query(PROJECTS, { module: MODULE })) ?? [] : [{ projectSlug: PROJECT }]
  if (ALL) {
    say(`Projects with the ${MODULE} module: ${projects.length ? projects.map((p) => `${p.projectSlug}${p.enabled === false ? ' (disabled)' : ''} [${p.n ?? 0} in list]`).join(', ') : 'none'}`)
  }
  let code = 0
  for (const p of projects) code = Math.max(code, await seedProject(p.projectSlug))
  return code
}

main().then(
  (code) => process.exit(code),
  (error) => {
    say(`Failed: ${error?.message ?? error}`)
    process.exit(2)
  }
)
