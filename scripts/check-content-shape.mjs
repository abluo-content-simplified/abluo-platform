#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — check-content-shape.mjs
//
// Detects LOCALISED-FIELD SHAPE DRIFT between the Sanity schema (source of
// truth, in this repo) and the documents living in the dataset.
//
// WHY THIS EXISTS
//   During the localisation work several fields were widened from `string` to
//   `localizedString` / `localizedText` / … . Existing documents were never
//   migrated, so their stored value kept the OLD shape (a raw string, or an
//   object like {en:"Home", it:"Home"} with no `_type`). The site keeps
//   rendering, but Sanity Studio refuses to PUBLISH a document that fails
//   validation — so the breakage only surfaces the day an editor opens the
//   document, which may be months later and on a live client page.
//
//   A previous manual sweep checked four hand-guessed field names
//   (title / altText / description / caption). The schema declares well over a
//   hundred localised fields. Guessing does not scale, which is the entire
//   reason this script derives its field list FROM THE SCHEMA.
//
// USAGE
//   node scripts/check-content-shape.mjs           # read-only report
//   node scripts/check-content-shape.mjs --fix     # repair MECHANICAL drift only
//   node scripts/check-content-shape.mjs --json    # machine-readable report
//
// EXIT CODES
//   0  no drift found (or nothing to do)
//   1  drift found
//   2  could not run (no credentials, network failure, schema extraction failed)
//
// CREDENTIALS
//   Read from .env.local (SANITY_API_WRITE_TOKEN, else SANITY_AUTH_TOKEN).
//   Token values are never printed.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(HERE, '..')

// ─── CLI ─────────────────────────────────────────────────────────────────────
const ARGS = new Set(process.argv.slice(2))
const FIX = ARGS.has('--fix')
const JSON_OUT = ARGS.has('--json')
if (ARGS.has('--help') || ARGS.has('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
    .filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}

// ─── tiny logger (stderr, so --json stdout stays clean) ──────────────────────
const tty = process.stderr.isTTY && !process.env.NO_COLOR
const c = (n) => (s) => (tty ? `[${n}m${s}[0m` : String(s))
const bold = c(1), dim = c(2), red = c(31), green = c(32), yellow = c(33), cyan = c(36)
const say = (...a) => console.error(...a)

// ─── .env.local (never printed) ──────────────────────────────────────────────
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
const TOKEN = env('SANITY_API_WRITE_TOKEN') || env('SANITY_AUTH_TOKEN')
const API_VERSION = '2021-06-07'

// ═══════════════════════════════════════════════════════════════════════════
// 1. SCHEMA EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════
//
// SOURCE OF TRUTH: the TypeScript schema in this repo, evaluated for real.
//
// Considered and rejected:
//   * Regexing schema.ts — cannot see nesting, cannot attribute a field to its
//     owning document type, and silently misses the module schemas in
//     src/lib/modules/*/schema.ts and the types generated at runtime by
//     buildModuleConfigSchemaTypes() / buildIntegrationSchemaTypes().
//   * The DEPLOYED schema in the dataset (Sanity's `system.schema` /
//     MCP-managed schemas) — this project currently has SIX competing
//     deployments (workspaces `abluo`, `default`, `website`, each with both an
//     MCP-managed and a legacy record). A deployed schema is a snapshot of
//     whenever someone last ran a deploy; the drift we are hunting is created
//     by a source change that was not followed by a migration, so the deployed
//     copy can be exactly as stale as the documents. doctor.sh gates a release
//     of THIS COMMIT, so THIS COMMIT'S source is the correct authority.
//   * `sanity schema extract` — the correct tool in principle, but it fails on
//     this repo (its Node ESM loader cannot resolve the extensionless internal
//     imports used across src/lib/modules).
//
// So we bundle the schema module with esbuild (already a dependency, via
// Next.js), stubbing every third-party import, and import the resulting
// plain-data array. Schema definitions are pure data; `defineType`/`defineField`
// are identity functions, so an identity stub reproduces them exactly.
async function extractSchema() {
  let esbuild
  try {
    esbuild = (await import('esbuild')).default ?? (await import('esbuild'))
  } catch {
    throw new Error('esbuild is not installed — run `npm install` first')
  }

  const outDir = mkdtempSync(join(tmpdir(), 'abluo-schema-'))
  const outfile = join(outDir, 'schema.mjs')

  // Names the stub must export. Seeded, then grown from esbuild's own
  // "No matching export" errors until the bundle links — so a new third-party
  // import in the schema never silently breaks this script.
  const stubExports = new Set([
    'defineType', 'defineField', 'defineArrayMember', 'defineConfig', 'definePlugin',
    'jsx', 'jsxs', 'jsxDEV', 'Fragment', 'useState', 'useEffect', 'useMemo', 'useCallback',
  ])

  const isBare = (p) => !p.startsWith('.') && !p.startsWith('/') && !p.startsWith('@/')

  const stubPlugin = {
    name: 'stub-third-party',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!isBare(args.path)) return null
        if (args.path.startsWith('node:')) return null
        return { path: args.path, namespace: 'abluo-stub' }
      })
      build.onLoad({ filter: /.*/, namespace: 'abluo-stub' }, () => ({
        contents:
          'const __id = (x) => x;\nexport default __id;\n' +
          [...stubExports].map((n) => `export const ${n} = __id;`).join('\n'),
        loader: 'js',
      }))
    },
  }

  const entry = [
    `export { schemaTypes } from ${JSON.stringify(join(REPO_ROOT, 'src/lib/sanity/schema.ts'))};`,
    `export { LOCALE_CODES } from ${JSON.stringify(join(REPO_ROOT, 'src/lib/i18n/locales.ts'))};`,
  ].join('\n')

  for (let attempt = 0; ; attempt++) {
    try {
      await esbuild.build({
        stdin: { contents: entry, resolveDir: REPO_ROOT, sourcefile: 'schema-entry.ts', loader: 'ts' },
        bundle: true,
        write: true,
        outfile,
        format: 'esm',
        platform: 'node',
        target: 'node18',
        jsx: 'automatic',
        tsconfig: join(REPO_ROOT, 'tsconfig.json'),
        absWorkingDir: REPO_ROOT,
        logLevel: 'silent',
        plugins: [stubPlugin],
      })
      break
    } catch (err) {
      const wanted = (err.errors ?? [])
        .map((e) => /for import "([^"]+)"/.exec(e.text)?.[1])
        .filter(Boolean)
      const fresh = wanted.filter((n) => !stubExports.has(n))
      if (!fresh.length || attempt > 20) {
        rmSync(outDir, { recursive: true, force: true })
        throw new Error('schema bundle failed:\n  ' + (err.errors ?? [{ text: err.message }]).map((e) => e.text).join('\n  '))
      }
      fresh.forEach((n) => stubExports.add(n))
    }
  }

  try {
    const mod = await import(pathToFileURL(outfile).href)
    return { schemaTypes: mod.schemaTypes, localeCodes: mod.LOCALE_CODES }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. WHAT COUNTS AS A "LOCALISED FIELD"
// ═══════════════════════════════════════════════════════════════════════════
//
// Detected STRUCTURALLY, not by name: a type is a locale wrapper when it is an
// object whose declared fields are all platform locale codes (en/it/de/...).
// That catches localizedString, localizedText, localizedPortableText,
// localizedSlug and redirectFrom today, and will catch anything shaped like
// them that someone adds tomorrow without this script being touched.
//
// localizedImage is deliberately NOT a wrapper — it is a Sanity `image` whose
// alt/caption children ARE wrappers, so it is covered through those children.
function makeSchemaModel(schemaTypes, localeCodes) {
  const localeSet = new Set(localeCodes)
  const index = new Map()
  for (const t of schemaTypes) if (t && t.name) index.set(t.name, t)

  const isLocaleObject = (def) =>
    !!def && Array.isArray(def.fields) && def.fields.length >= 2 &&
    def.fields.every((f) => f && localeSet.has(f.name))

  function resolveBaseTypeName(field) {
    let tn = field.type, guard = 0
    while (index.has(tn) && guard++ < 20) {
      const d = index.get(tn)
      if (!d.type || d.type === tn) break
      tn = d.type
    }
    return tn
  }

  // Follow a field/type declaration down its `type` chain, merging what it
  // inherits. Returns everything the walkers need in one shot.
  const resolveCache = new Map()
  function resolveNode(node) {
    if (!node || typeof node !== 'object') return null
    if (resolveCache.has(node)) return resolveCache.get(node)

    const chain = []
    let cur = node
    const guard = new Set()
    while (cur) {
      chain.push(cur)
      const tn = cur.type
      if (!tn || typeof tn !== 'string' || guard.has(tn)) break
      guard.add(tn)
      const next = index.get(tn)
      if (!next || next === cur) break
      cur = next
    }

    const pick = (k) => { for (const n of chain) if (n[k] !== undefined) return n[k]; return undefined }
    const localeDef = chain.find((n) => isLocaleObject(n)) ?? null

    const out = {
      typeName: node.type ?? node.name,
      fields: pick('fields'),
      of: pick('of'),
      isLocale: !!localeDef,
      // The `_type` a stored value must carry: the named type the field points at.
      expectedType: localeDef ? (localeDef.name ?? node.type) : null,
      // { en: 'string', it: 'string', ... } — lets us check inside the wrapper too.
      localeFieldTypes: localeDef
        ? Object.fromEntries(localeDef.fields.map((f) => [f.name, resolveBaseTypeName(f)]))
        : null,
    }
    resolveCache.set(node, out)
    return out
  }

  const documentTypes = schemaTypes.filter((t) => t && t.type === 'document' && t.name)
  return { index, localeSet, resolveNode, documentTypes }
}

// ── Static inventory: every localised field the schema declares, with owner ──
function discoverLocalizedFields(model) {
  const found = []
  const seen = new Set()

  function visit(node, docType, path, chain, depth) {
    if (depth > 12) return
    const r = model.resolveNode(node)
    if (!r) return
    if (r.isLocale) {
      const key = `${docType} ${path}`
      if (!seen.has(key)) { seen.add(key); found.push({ docType, path, typeName: r.expectedType }) }
      return
    }
    const tn = r.typeName
    if (tn && chain.has(tn)) return               // cycle guard
    const nextChain = tn ? new Set(chain).add(tn) : chain

    for (const f of r.fields ?? []) {
      if (!f || !f.name) continue
      visit(f, docType, path ? `${path}.${f.name}` : f.name, nextChain, depth + 1)
    }
    for (const m of r.of ?? []) {
      if (!m) continue
      const label = m.type && m.type !== 'object' ? `[${m.type}]` : '[]'
      visit(m, docType, `${path}${label}`, nextChain, depth + 1)
    }
  }

  for (const doc of model.documentTypes) visit(doc, doc.name, '', new Set(), 0)
  return found
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. DOCUMENT INSPECTION
// ═══════════════════════════════════════════════════════════════════════════
//
// Issue kinds:
//   missing-type   value has the right shape but no `_type`  → MECHANICAL, fixable
//   primitive      a raw string/number sits where an object belongs → SEMANTIC
//   array-value    an array sits where an object belongs          → SEMANTIC
//   unknown-keys   object has keys that are not platform locales  → SEMANTIC
//   wrong-type     `_type` present but not the declared type      → SEMANTIC
//   locale-value   the per-locale value itself has the wrong shape → SEMANTIC
//
// Only `missing-type` is ever repaired. A raw string in a localizedString has
// no defensible locale assignment — that is a human decision, never ours.
const MECHANICAL = new Set(['missing-type'])

function inspectDocument(doc, model) {
  const issues = []
  const localeSet = model.localeSet

  function push(kind, path, value, expectedType, note) {
    issues.push({
      docId: doc._id,
      docType: doc._type,
      draft: doc._id.startsWith('drafts.'),
      path, kind, value, expectedType, note,
      fixable: MECHANICAL.has(kind),
    })
  }

  function checkLocaleWrapper(r, value, path) {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) return push('array-value', path, value, r.expectedType)
    if (typeof value !== 'object') return push('primitive', path, value, r.expectedType)

    const keys = Object.keys(value).filter((k) => k !== '_type' && k !== '_key')
    const unknown = keys.filter((k) => !localeSet.has(k))
    if (unknown.length) {
      push('unknown-keys', path, value, r.expectedType, `unexpected key(s): ${unknown.join(', ')}`)
    } else if (value._type === undefined) {
      push('missing-type', path, value, r.expectedType)
    } else if (value._type !== r.expectedType) {
      push('wrong-type', path, value, r.expectedType, `found _type "${value._type}"`)
    }

    // One level deeper: the per-locale value must match its declared type.
    for (const [code, declared] of Object.entries(r.localeFieldTypes ?? {})) {
      const v = value[code]
      if (v === null || v === undefined) continue
      const sub = `${path}.${code}`
      if (declared === 'string' || declared === 'text') {
        if (typeof v !== 'string') push('locale-value', sub, v, declared, `expected a ${declared}`)
      } else if (declared === 'array') {
        if (!Array.isArray(v)) push('locale-value', sub, v, declared, 'expected an array')
      } else if (declared === 'slug') {
        if (typeof v !== 'object' || Array.isArray(v)) push('locale-value', sub, v, 'slug', 'expected a slug object')
        else if (v._type === undefined) push('missing-type', sub, v, 'slug')
        else if (v._type !== 'slug') push('wrong-type', sub, v, 'slug', `found _type "${v._type}"`)
      }
    }
  }

  function walk(node, value, path, chain, depth) {
    if (value === null || value === undefined || depth > 14) return
    const r = model.resolveNode(node)
    if (!r) return
    if (r.isLocale) return checkLocaleWrapper(r, value, path)

    if (Array.isArray(value)) {
      const of = r.of ?? []
      value.forEach((item, i) => {
        // Resolve the member declaration from the item's own _type when the
        // array is polymorphic (page sections are), else from the sole member.
        let member = null
        if (item && item._type) member = of.find((m) => m && m.type === item._type) ?? (model.index.has(item._type) ? { type: item._type } : null)
        if (!member && of.length === 1) member = of[0]
        if (!member) return
        const seg = item && item._key ? `[_key=="${item._key}"]` : `[${i}]`
        walk(member, item, `${path}${seg}`, chain, depth + 1)
      })
      return
    }

    if (typeof value !== 'object') return
    const tn = r.typeName
    if (tn && chain.has(tn)) return
    const nextChain = tn ? new Set(chain).add(tn) : chain
    for (const f of r.fields ?? []) {
      if (!f || !f.name) continue
      if (!(f.name in value)) continue
      walk(f, value[f.name], path ? `${path}.${f.name}` : f.name, nextChain, depth + 1)
    }
  }

  const def = model.index.get(doc._type)
  if (!def) return issues
  walk(def, doc, '', new Set(), 0)
  return issues
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. SANITY HTTP (no SDK — keeps this script dependency-free at runtime)
// ═══════════════════════════════════════════════════════════════════════════
const API_BASE = `https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}`

async function sanity(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    // Never echo the request headers — the token lives there.
    throw new Error(`Sanity API ${res.status} on ${path}: ${text.slice(0, 400)}`)
  }
  return JSON.parse(text)
}

// `raw` perspective: published documents AND their drafts, exactly as stored.
const fetchDocuments = () =>
  sanity(`/data/query/${DATASET}?perspective=raw`, {
    query: '*[!(_type match "sanity.*") && !(_type match "system.*")]',
  }).then((r) => r.result ?? [])

const applyPatches = (mutations) =>
  sanity(`/data/mutate/${DATASET}?returnIds=true`, { mutations })

// ═══════════════════════════════════════════════════════════════════════════
// 5. REPORT
// ═══════════════════════════════════════════════════════════════════════════
const preview = (v) => {
  const s = JSON.stringify(v)
  return s === undefined ? String(v) : s.length > 120 ? `${s.slice(0, 117)}...` : s
}

function report(issues, stats) {
  say('')
  say(bold(cyan('Abluo content-shape check — localised field drift')))
  say(dim('--------------------------------------------------'))
  say(`${dim('·')} project ${PROJECT_ID} / dataset ${DATASET}`)
  say(`${dim('·')} ${stats.fieldCount} localised field path(s) declared across ${stats.docTypeCount} document type(s)`)
  say(`${dim('·')} ${stats.docCount} document(s) inspected (published + drafts)`)

  if (!issues.length) {
    say(green('✔') + ' No localised-field drift found.')
    return
  }

  const byType = new Map()
  for (const i of issues) {
    if (!byType.has(i.docType)) byType.set(i.docType, new Map())
    const byPath = byType.get(i.docType)
    if (!byPath.has(i.path)) byPath.set(i.path, [])
    byPath.get(i.path).push(i)
  }

  for (const [docType, byPath] of [...byType].sort()) {
    say('')
    say(bold(`  ${docType}`))
    for (const [path, list] of [...byPath].sort()) {
      say(`    ${cyan(path)} ${dim(`(${list[0].expectedType ?? '?'})`)}`)
      for (const i of list) {
        const state = i.draft ? yellow('draft') : green('published')
        const tag = i.fixable ? green('MECHANICAL') : red('SEMANTIC')
        say(`      ${red('✖')} ${i.docId}  [${state}]  ${tag}  ${bold(i.kind)}`)
        say(`         value: ${preview(i.value)}${i.note ? dim(`   (${i.note})`) : ''}`)
      }
    }
  }

  const mech = issues.filter((i) => i.fixable).length
  say('')
  say(dim('--------------------------------------------------'))
  say(`${red('✖')} ${bold(String(issues.length))} issue(s): ${mech} mechanical (repairable with --fix), ${issues.length - mech} semantic (need a human).`)
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. MAIN
// ═══════════════════════════════════════════════════════════════════════════
// --only=<substring> restricts BOTH the report and --fix to matching document
// ids. Used to exercise --fix against a scratch document without any chance of
// touching client content.
const ONLY = [...ARGS].filter((a) => a.startsWith('--only=')).map((a) => a.slice(7))

async function main() {
  if (!TOKEN) {
    say(yellow('⚠') + ' No Sanity token found (SANITY_API_WRITE_TOKEN / SANITY_AUTH_TOKEN in .env.local).')
    say(dim('  Content-shape check skipped — nothing to check against.'))
    process.exit(2)
  }

  const { schemaTypes, localeCodes } = await extractSchema()
  const model = makeSchemaModel(schemaTypes, localeCodes)
  const fields = discoverLocalizedFields(model)

  let docs = await fetchDocuments()
  if (ONLY.length) docs = docs.filter((d) => ONLY.some((o) => d._id.includes(o)))

  let issues = []
  for (const doc of docs) issues.push(...inspectDocument(doc, model))
  issues.sort((a, b) => a.docType.localeCompare(b.docType) || a.path.localeCompare(b.path) || a.docId.localeCompare(b.docId))

  const stats = {
    fieldCount: fields.length,
    docTypeCount: new Set(fields.map((f) => f.docType)).size,
    docCount: docs.length,
  }

  if (FIX) {
    const fixable = issues.filter((i) => i.fixable)
    if (!fixable.length) {
      say(yellow('⚠') + ' --fix: nothing mechanical to repair.')
    } else {
      const mutations = fixable.map((i) => ({
        patch: { id: i.docId, set: { [i.path]: { ...i.value, _type: i.expectedType } } },
      }))
      await applyPatches(mutations)
      say('')
      say(bold(green(`Repaired ${fixable.length} mechanical issue(s):`)))
      for (const i of fixable) {
        say(`  ${green('✔')} ${i.docId}  ${cyan(i.path)}`)
        say(`     ${dim('before')} ${preview(i.value)}`)
        say(`     ${dim('after ')} ${preview({ ...i.value, _type: i.expectedType })}`)
      }
      issues = issues.filter((i) => !i.fixable)
    }
  }

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ stats, fields, issues }, null, 2) + '\n')
  } else {
    report(issues, stats)
    if (issues.some((i) => !i.fixable)) {
      say('')
      say(dim('  SEMANTIC issues are never auto-repaired: the correct locale for a raw'))
      say(dim('  value is a human decision. Fix them in the Studio, or with a migration.'))
    }
  }

  process.exit(issues.length ? 1 : 0)
}

main().catch((err) => {
  say(red('✖') + ' check-content-shape failed: ' + (err?.message ?? err))
  process.exit(2)
})
