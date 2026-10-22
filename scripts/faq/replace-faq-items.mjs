#!/usr/bin/env node
/**
 * Replace the questions of existing FAQ sets from an import file (ADR-037).
 *
 * Platform tool, any tenant. The import file maps FAQ set ids to new items:
 *   { "<faqSet id>": { "source": "<file name>", "items": [ { "question": "...", "blocks": [<Portable Text>] } ] } }
 * (produced from a client's .docx documents; answers are restricted Portable
 * Text: normal paragraphs, bullet/number lists, strong/em — ADR-037 D12).
 *
 * For each set: the PUBLISHED set (and its draft, if one is open) gets the new
 * list of questions, in the given language only. Everything else on the set
 * (name, title, note, where it is used) is untouched. Every patch carries
 * ifRevisionID; a set edited meanwhile fails alone. A set of another project,
 * a missing set, or one whose current questions carry OTHER languages (which
 * the replacement would drop) is refused and reported.
 *
 * Dry run first (prints old vs new per set), then --apply:
 *   node --env-file=.env.local scripts/faq/replace-faq-items.mjs --project hoffmann --locale it --file <import.json>
 *   node --env-file=.env.local scripts/faq/replace-faq-items.mjs --project hoffmann --locale it --file <import.json> --apply
 */
import { createClient } from '@sanity/client'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null }
const APPLY = process.argv.includes('--apply')
const PROJECT = arg('--project')
const LOCALE = arg('--locale') ?? 'it'
const FILE = arg('--file')
if (!PROJECT || !FILE) { console.error('Usage: --project <slug> --locale <code> --file <import.json> [--apply]'); process.exit(1) }

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_API_TOKEN ?? '',
  useCdn: false,
  perspective: 'raw',
})
const key = () => randomUUID().replace(/-/g, '').slice(0, 12)
const STYLES = new Set(['normal']), LISTS = new Set(['bullet', 'number']), MARKS = new Set(['strong', 'em'])

function entry(item) {
  const blocks = item.blocks.map((b) => {
    if (b._type !== 'block' || !STYLES.has(b.style ?? 'normal')) throw new Error('unsupported block')
    if (b.listItem && !LISTS.has(b.listItem)) throw new Error('unsupported list')
    for (const s of b.children) if (s._type !== 'span' || s.marks.some((m) => !MARKS.has(m))) throw new Error('unsupported mark')
    return { ...b, _key: key(), markDefs: [], children: b.children.map((s) => ({ ...s, _key: key() })) }
  })
  if (!item.question?.trim() || !blocks.length) throw new Error('empty question or answer')
  return {
    _type: 'faqEntry', _key: key(),
    question: { _type: 'localizedString', [LOCALE]: item.question.trim() },
    answer: { _type: 'faqAnswerText', [LOCALE]: blocks },
  }
}
const otherLocales = (items = []) => [...new Set(items.flatMap((i) => [i.question, i.answer]).flatMap((o) => Object.keys(o ?? {})))]
  .filter((k) => !k.startsWith('_') && k !== 'translationStatus' && k !== LOCALE)

const data = JSON.parse(readFileSync(FILE, 'utf8'))
console.log(`Replace FAQ questions · project ${PROJECT} · language ${LOCALE} · ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to write)'}\n`)
let ok = 0, refused = 0
for (const [id, spec] of Object.entries(data)) {
  const [pub, draft] = await Promise.all([client.getDocument(id), client.getDocument(`drafts.${id}`)])
  const label = `${spec.source} → ${id}`
  const refuse = (why) => { refused++; console.log(`✗ ${label}\n    REFUSED: ${why}\n`) }
  if (!pub) { refuse('no published FAQ set with this id'); continue }
  if (pub._type !== 'faqSet' || pub.projectSlug !== PROJECT) { refuse('not an FAQ set of this project'); continue }
  const others = otherLocales([...(pub.items ?? []), ...(draft?.items ?? [])])
  if (others.length) { refuse(`current questions also have ${others.join(', ')} — replacing would delete them`); continue }
  let items
  try { items = spec.items.map(entry) } catch (e) { refuse(`import data: ${e.message}`); continue }
  console.log(`• ${pub.internalName}\n    ${label}\n    questions: ${pub.items?.length ?? 0} → ${items.length}${draft ? ' (open draft updated too)' : ''}`)
  for (const i of spec.items) console.log(`      - ${i.question}`)
  if (APPLY) {
    let tx = client.transaction().patch(id, (p) => p.ifRevisionId(pub._rev).set({ items }))
    if (draft) tx = tx.patch(draft._id, (p) => p.ifRevisionId(draft._rev).set({ items }))
    try { await tx.commit({ visibility: 'sync' }); ok++; console.log('    ✓ written') } catch (e) { refused++; console.log(`    ✗ FAILED, nothing written: ${e.message}`) }
  } else ok++
  console.log()
}
console.log(`${APPLY ? 'Updated' : 'Would update'}: ${ok} set(s) · refused/failed: ${refused}`)
