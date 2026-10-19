/**
 * Migration 008 — Move inline FAQs into FAQ sets (ADR-037, rollout step 4)
 *
 * Safe order: the code that reads `faqSets` is in production since v1.0.57
 * (section: sets first, else inline items; post: sets first, else legacy faq),
 * so converting data now never leaves a page without its FAQs.
 *
 * What it does
 * ------------
 *   - Each inline `faqSection` (items, no faqSets) → one published `faqSet`
 *     ("<page name> — FAQ"), the section's `faqSets` = [that set], `items` unset.
 *   - Each post `faq[]` → one published `faqSet` ("<post title> — FAQ"),
 *     the post's `faqSets` = [that set], `faq` unset.
 *   - Every `faqItem` becomes a `faqEntry` KEEPING its `_key`: the question is
 *     copied as is; the plain-text answer becomes Portable Text, one `normal`
 *     block per paragraph (split on blank lines), per locale; both keep their
 *     `translationStatus`.
 *   - A draft and its published document share ONE set, built from the
 *     published version. When the draft's FAQ is identical, the draft gets the
 *     same change; when it differs, the draft is left alone and listed under
 *     MANUAL REVIEW. A draft with no published twin builds its own set.
 *
 * Idempotent: set ids are derived from the document and section
 * (`faq-<doc id>-<section key>`, `faq-<post id>`), created with
 * createIfNotExists; a section or post that already has faqSets is skipped.
 * Every document patch carries ifRevisionID — a document edited meanwhile
 * fails that one transaction and nothing else.
 *
 * Run, dry-run first (prints the report; --report also writes it as Markdown):
 *   npx tsx --env-file=.env.local src/lib/sanity/migrations/008-faq-inline-to-sets.ts --report ../Abluo/_claude-staging/faq-008-dry-run.md
 *   npx tsx --env-file=.env.local src/lib/sanity/migrations/008-faq-inline-to-sets.ts --apply --report ../Abluo/_claude-staging/faq-008-applied.md
 *
 * Expected on production (2026-10-19): 20 sets (6 from sections, 14 from
 * posts), 106 questions; 1 Hoffmann post draft to compare.
 */

import { createClient } from '@sanity/client'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const DRY_RUN = !process.argv.includes('--apply')
const reportArg = process.argv.indexOf('--report')
const REPORT_PATH = reportArg > -1 ? process.argv[reportArg + 1] : null

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_API_TOKEN ?? '',
  useCdn: false,
  perspective: 'raw',
})

type Loc = Record<string, unknown> & { _type?: string; translationStatus?: unknown }
type LegacyItem = { _key: string; _type?: string; question?: Loc; answer?: Loc }
type Section = { _key: string; _type: string; items?: LegacyItem[]; faqSets?: unknown[] }
type Doc = {
  _id: string; _type: string; _rev: string; projectSlug: string
  title?: unknown; internalName?: string; slug?: Record<string, { current?: string }>
  sections?: Section[]; faq?: LegacyItem[]; faqSets?: unknown[]
}

const lines: string[] = []
const log = (s = '') => { lines.push(s); console.log(s) }
const manual: string[] = []

const isDraft = (id: string) => id.startsWith('drafts.')
const baseId = (id: string) => id.replace(/^drafts\./, '')
const key = () => randomUUID().replace(/-/g, '').slice(0, 12)
const safeId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 120)

function docName(d: Doc, defaultLocale: string): string {
  const t = d.title as Record<string, unknown> | string | undefined
  const fromTitle = typeof t === 'string' ? t : t && (t[defaultLocale] ?? t.it ?? t.en ?? Object.values(t).find((v) => typeof v === 'string'))
  const slug = d.slug?.[defaultLocale]?.current
  return String(fromTitle || d.internalName || slug || baseId(d._id)).trim()
}

/** Plain text → Portable Text paragraphs (blank lines separate paragraphs). */
function toBlocks(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ _type: 'block', _key: key(), style: 'normal', markDefs: [], children: [{ _type: 'span', _key: key(), text: p, marks: [] }] }))
}

function convertItem(item: LegacyItem) {
  const question: Loc = { _type: 'localizedString' }
  const answer: Loc = { _type: 'faqAnswerText' }
  for (const [loc, v] of Object.entries(item.question ?? {})) {
    if (loc === '_type') continue
    question[loc] = v
  }
  for (const [loc, v] of Object.entries(item.answer ?? {})) {
    if (loc === '_type') continue
    if (loc === 'translationStatus') { answer.translationStatus = v; continue }
    if (typeof v === 'string' && v.trim()) answer[loc] = toBlocks(v)
  }
  return { _type: 'faqEntry', _key: item._key, question, answer }
}

const sameItems = (a?: LegacyItem[], b?: LegacyItem[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

function reportItems(items: LegacyItem[]) {
  for (const it of items) {
    const q = it.question ?? {}
    const a = it.answer ?? {}
    const locs = Object.keys(q).filter((k) => !k.startsWith('_') && k !== 'translationStatus')
    log(`  - [${it._key}] ${locs.map((l) => `${l}: ${String(q[l])}`).join(' | ')}`)
    for (const l of Object.keys(a).filter((k) => !k.startsWith('_') && k !== 'translationStatus')) {
      const text = String(a[l] ?? '')
      const paras = toBlocks(text).length
      log(`      answer ${l}: ${paras} paragraph${paras === 1 ? '' : 's'} — "${text.slice(0, 90).replace(/\n/g, ' ⏎ ')}${text.length > 90 ? '…' : ''}"`)
    }
  }
}

type Job = { setId: string; name: string; projectSlug: string; items: LegacyItem[]; targets: { doc: Doc; sectionKey?: string }[] }

async function run() {
  log(`# Migration 008 — inline FAQs → FAQ sets (ADR-037)`)
  log(`Mode: ${DRY_RUN ? 'DRY RUN (nothing written; pass --apply to write)' : 'APPLY'} · Dataset: ${client.config().dataset} · ${new Date().toISOString()}`)
  log()

  const defaults = Object.fromEntries(
    (await client.fetch<{ p: string; d?: string }[]>(`*[_type == "siteConfig" && !(_id in path("drafts.**"))]{ "p": projectSlug, "d": defaultLocale }`)).map((r) => [r.p, r.d ?? 'it'])
  )
  const docs = await client.fetch<Doc[]>(
    `*[!(_id in path("versions.**")) && defined(projectSlug) && (count(sections[_type == "faqSection" && count(items) > 0]) > 0 || (_type == "post" && count(faq) > 0))]{
      _id, _type, _rev, projectSlug, title, internalName, slug,
      "sections": sections[_type == "faqSection"]{ _key, _type, items, faqSets },
      faq, faqSets
    } | order(projectSlug asc, _id asc)`
  )
  const byId = new Map(docs.map((d) => [d._id, d]))
  const jobs: Job[] = []

  for (const doc of docs) {
    const draft = isDraft(doc._id)
    const twin = draft ? byId.get(baseId(doc._id)) : undefined
    const dl = defaults[doc.projectSlug] ?? 'it'

    // Sections
    for (const s of doc.sections ?? []) {
      if (!s.items?.length) continue
      if (s.faqSets?.length) { log(`SKIP ${doc._id} section ${s._key} — already has FAQ sets`); continue }
      const setId = safeId(`faq-${baseId(doc._id)}-${s._key}`)
      if (draft && twin) {
        const ts = twin.sections?.find((x) => x._key === s._key)
        if (ts && sameItems(ts.items, s.items)) { jobs.find((j) => j.setId === setId)?.targets.push({ doc, sectionKey: s._key }); continue }
        manual.push(`${doc._id} (section ${s._key}) — the draft's questions differ from the published page; draft left unchanged.`)
        continue
      }
      jobs.push({ setId, name: `${docName(doc, dl)} — FAQ`, projectSlug: doc.projectSlug, items: s.items, targets: [{ doc, sectionKey: s._key }] })
    }

    // Post legacy faq
    if (doc._type === 'post' && doc.faq?.length) {
      if (doc.faqSets?.length) { log(`SKIP ${doc._id} — already has FAQ sets`); continue }
      const setId = safeId(`faq-${baseId(doc._id)}`)
      if (draft && twin) {
        if (sameItems(twin.faq, doc.faq)) { jobs.find((j) => j.setId === setId)?.targets.push({ doc }); continue }
        manual.push(`${doc._id} — the draft's FAQ differs from the published post; draft left unchanged.`)
        continue
      }
      jobs.push({ setId, name: `${docName(doc, dl)} — FAQ`, projectSlug: doc.projectSlug, items: doc.faq, targets: [{ doc }] })
    }
  }
  // Drafts are processed after their published twin (ids sort "drafts." first) — attach any draft target found before its job existed.
  for (const doc of docs.filter((d) => isDraft(d._id) && byId.has(baseId(d._id)))) {
    for (const s of doc.sections ?? []) {
      const job = jobs.find((j) => j.setId === safeId(`faq-${baseId(doc._id)}-${s._key}`))
      const ts = byId.get(baseId(doc._id))?.sections?.find((x) => x._key === s._key)
      if (job && s.items?.length && !s.faqSets?.length && ts && sameItems(ts.items, s.items) && !job.targets.some((t) => t.doc === doc && t.sectionKey === s._key)) job.targets.push({ doc, sectionKey: s._key })
    }
    if (doc._type === 'post' && doc.faq?.length && !doc.faqSets?.length) {
      const job = jobs.find((j) => j.setId === safeId(`faq-${baseId(doc._id)}`))
      if (job && sameItems(byId.get(baseId(doc._id))?.faq, doc.faq) && !job.targets.some((t) => t.doc === doc)) job.targets.push({ doc })
    }
  }

  const fromSections = jobs.filter((j) => j.targets.some((t) => t.sectionKey)).length
  const questions = jobs.reduce((n, j) => n + j.items.length, 0)
  log(`## Summary`)
  log(`FAQ sets to create: ${jobs.length} (${fromSections} from page sections, ${jobs.length - fromSections} from posts) · questions: ${questions}`)
  log(`Documents to update: ${jobs.reduce((n, j) => n + j.targets.length, 0)}`)
  log()

  for (const job of jobs) {
    log(`## ${job.projectSlug} · ${job.name}`)
    log(`Set id: ${job.setId} · ${job.items.length} questions · updates: ${job.targets.map((t) => t.doc._id + (t.sectionKey ? ` (section ${t.sectionKey})` : '')).join(', ')}`)
    reportItems(job.items)
    log()

    if (DRY_RUN) continue
    const tx = client.transaction()
    tx.createIfNotExists({
      _id: job.setId,
      _type: 'faqSet',
      projectSlug: job.projectSlug,
      internalName: job.name,
      items: job.items.map(convertItem),
    })
    for (const t of job.targets) {
      const ref = { _type: 'reference', _ref: job.setId, _key: key() }
      if (t.sectionKey) {
        tx.patch(t.doc._id, (p) => p.ifRevisionId(t.doc._rev).set({ [`sections[_key=="${t.sectionKey}"].faqSets`]: [ref] }).unset([`sections[_key=="${t.sectionKey}"].items`]))
      } else {
        tx.patch(t.doc._id, (p) => p.ifRevisionId(t.doc._rev).set({ faqSets: [ref] }).unset(['faq']))
      }
    }
    try {
      await tx.commit({ visibility: 'sync' })
      log(`  ✓ written`)
    } catch (err) {
      log(`  ✗ FAILED — nothing written for this set: ${(err as Error).message}`)
    }
  }

  log(`## Manual review (${manual.length})`)
  for (const m of manual) log(`- ${m}`)
  if (!manual.length) log('- none')

  if (REPORT_PATH) {
    writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8')
    console.log(`\nReport written to ${REPORT_PATH}`)
  }
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
