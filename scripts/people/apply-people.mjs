#!/usr/bin/env node
/**
 * People module migration — APPLY (ADR-043 D10). DRY RUN BY DEFAULT.
 *
 *   node --env-file=.env.local scripts/people/apply-people.mjs --projects=cyce --report=<people-proposal-cyce.json>
 *   node --env-file=.env.local scripts/people/apply-people.mjs --projects=cyce --report=<…json> --reader-deployed --confirm
 *
 * Input: the JSON report of propose-people.mjs after Tom's review ("decision":
 * "create" | "skip" | "review", "mergeInto", edited names/titles).
 *
 * With --confirm it
 *   1. createIfNotExists the `person` documents (deterministic _id
 *      person-<project>-<hash>, deterministic publicId, groups EMPTY — never invented),
 *      published, visibility "listed", no slug;
 *   2. re-points placements ADDITIVELY: teamSection.people (member order),
 *      post.authors, event.hostPeople — only where the target field is still empty,
 *      only when EVERY member/host of that section/event resolves to a person.
 *      `members`, `author`, `hosts` are never touched (fallbacks stay until Tom verifies).
 * Idempotent: a re-run skips persons that exist and placements already set.
 *
 * --confirm REFUSES unless: the People module is installed on the project (migration 009),
 * --reader-deployed is passed (YOU assert the reading code — tag with ADR-043
 * readers — is live in production; ADR-043 D10.1 / the 2026-08-14 outage rule:
 * never migrate production data ahead of the deploy), the report belongs to this
 * project and dataset, and the Sanity client is bound to the report's dataset.
 * Every patch carries ifRevisionID.
 */
import { readFileSync } from 'node:fs'
import { arg, makeClient } from '../lib/people-io.mjs'
import { blockersOf, buildPersonDocument, refKey, resolveMerges, walk, weakRef, baseId } from '../lib/people-migration.mjs'

const slug = arg('--projects')
const reportPath = arg('--report')
const CONFIRM = process.argv.includes('--confirm')
const READER_DEPLOYED = process.argv.includes('--reader-deployed')
const die = (m) => { console.error(`\nREFUSED: ${m}\n`); process.exit(1) }
if (typeof slug !== 'string' || slug.includes(',') || typeof reportPath !== 'string') die('usage: --projects=<ONE slug> --report=<people-proposal-<slug>.json> [--reader-deployed --confirm]')

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
if (report.schema !== 'people-proposal/1') die('not a people-proposal/1 report')
if (report.projectSlug !== slug) die(`report is for "${report.projectSlug}", not "${slug}"`)

const client = makeClient({ write: CONFIRM })
const dataset = client.config().dataset
if (report.dataset !== dataset) die(`report was made on dataset "${report.dataset}", the client is bound to "${dataset}"`)

const say = console.log
say(`\nApply people · project ${slug} · dataset ${dataset} · ${CONFIRM ? 'CONFIRM (writes!)' : 'DRY RUN (add --confirm to write)'}\n`)

// ── Guards ───────────────────────────────────────────────────────────────────
const project = await client.fetch(`*[_type == "project" && projectSlug == $slug && !(_id in path("versions.**")) && !(_id in path("drafts.**"))][0]{ _id, "installed": count(moduleInstallations[moduleId == "people" && enabled != false]) > 0 }`, { slug })
if (!project) die(`no project "${slug}"`)
if (!project.installed && CONFIRM) die(`the People module is not installed on "${slug}". Run migration 009 first: npx tsx --env-file=.env.local src/lib/sanity/migrations/009-install-people-module.ts --projects=${slug} --apply`)
if (!project.installed) say(`WARNING: the People module is not installed on "${slug}" (migration 009). This dry run shows the plan; --confirm will refuse.\n`)
if (CONFIRM && !READER_DEPLOYED) die('--confirm needs --reader-deployed: pass it ONLY after the release whose readers prefer teamSection.people / post.authors / event.hostPeople (ADR-043) is live in production. Writing refs ahead of the readers is harmless to old readers (they ignore unknown fields) but the sites keep showing the old data until then.')
if (!READER_DEPLOYED) say('NOTE: --reader-deployed not passed. This dry run is fine; --confirm will refuse without it.\n')

// ── Plan ─────────────────────────────────────────────────────────────────────
const { proposals: merged, errors } = resolveMerges(structuredClone(report.proposals))
if (errors.length) die(errors.join('\n'))
const willCreate = merged.filter((p) => blockersOf(p).length === 0)
for (const p of merged) {
  const b = blockersOf(p)
  if (b.length) say(`  [SKIP]     ${p.displayName} (${p.key}) — ${b.join('; ')}`)
}
const personOf = new Map(willCreate.map((p) => [p.key, p]))
const placementPerson = new Map() // `${kind}|${docId}|${sectionPath|index}` -> proposal
const pkey = (pl) => (pl.kind === 'teamSection' ? `teamSection|${pl.docId}|${pl.sectionPath}|${pl.index}` : pl.kind === 'postAuthor' ? `postAuthor|${pl.docId}` : `eventHost|${pl.docId}|${pl.index}`)
for (const p of willCreate) for (const pl of p.placements) placementPerson.set(pkey(pl), p)

const existing = new Set(await client.fetch(`*[_type == "person" && projectSlug == $slug && !(_id in path("versions.**"))]._id`, { slug }))
const mediaIds = new Set(await client.fetch(`*[_type == "mediaAsset" && projectSlug == $slug && !(_id in path("versions.**"))]._id`, { slug }))
const projectHasPeople = existing.size > 0

const personDocs = []
willCreate.forEach((p, i) => {
  if (p.person.photoMediaAssetId && !mediaIds.has(p.person.photoMediaAssetId)) {
    say(`  [WARN]     ${p.displayName}: mediaAsset ${p.person.photoMediaAssetId} is not in this project — photo left empty`)
    p.person.photoMediaAssetId = null
  }
  const doc = buildPersonDocument(slug, p, { sortOrder: projectHasPeople ? undefined : (i + 1) * 10 })
  personDocs.push({ doc, exists: existing.has(doc._id), name: p.displayName })
})
for (const d of personDocs) say(`  [${d.exists ? 'EXISTS  ' : 'CREATE  '}] person ${d.doc._id}  ${[d.doc.firstName, d.doc.lastName].filter(Boolean).join(' ')}${d.doc.photo ? '' : '  (no photo)'}`)

const patches = []   // { docId, rev, set, why }
const skipped = []
const refsFor = (ids) => ids.map((id) => weakRef(id, refKey(id)))
const sameRefs = (cur, ids) => (cur ?? []).map((r) => r._ref).join('|') === ids.join('|')

// teamSection
const sectionKeys = [...new Set(report.proposals.flatMap((p) => p.placements).filter((pl) => pl.kind === 'teamSection').map((pl) => `${pl.docId}\u0000${pl.sectionPath}`))]
for (const k of sectionKeys) {
  const [docId, path] = k.split('\u0000')
  const doc = await client.getDocument(docId)
  if (!doc) { skipped.push(`teamSection ${docId} ${path}: document gone`); continue }
  const hit = [...walk(doc)].find((x) => x.path === path && x.node._type === 'teamSection')
  if (!hit) { skipped.push(`teamSection ${docId} ${path}: section no longer there`); continue }
  const members = hit.node.members ?? []
  const ids = []
  let ok = true
  members.forEach((m, i) => {
    const p = placementPerson.get(`teamSection|${docId}|${path}|${i}`)
    if (!p) ok = false
    else ids.push(p.id)
  })
  if (!ok || !members.length) { skipped.push(`teamSection ${docId}: not every member has a person to point to (skipped/review) — left on inline members`); continue }
  if (sameRefs(hit.node.people, ids)) { skipped.push(`teamSection ${docId}: already points at these people`); continue }
  if ((hit.node.people ?? []).length) { skipped.push(`teamSection ${docId}: people already set to something else — not overwritten`); continue }
  patches.push({ docId, rev: doc._rev, set: { [`${path}.people`]: refsFor(ids) }, why: `teamSection ${path}: ${ids.length} people in member order` })
}
// post authors
const postIds = [...new Set(report.proposals.flatMap((p) => p.placements).filter((pl) => pl.kind === 'postAuthor').map((pl) => pl.docId))]
for (const docId of postIds) {
  const doc = await client.getDocument(docId)
  if (!doc) { skipped.push(`post ${docId}: gone`); continue }
  const p = placementPerson.get(`postAuthor|${docId}`)
  if (!p) { skipped.push(`post ${docId}: author has no person to point to`); continue }
  if (doc.author?._ref !== report.proposals.flatMap((x) => x.placements).find((pl) => pl.kind === 'postAuthor' && pl.docId === docId)?.authorId) { skipped.push(`post ${docId}: author changed since the report`); continue }
  if (sameRefs(doc.authors, [p.id])) { skipped.push(`post ${docId}: already points at this person`); continue }
  if ((doc.authors ?? []).length) { skipped.push(`post ${docId}: authors already set — not overwritten`); continue }
  patches.push({ docId, rev: doc._rev, set: { authors: refsFor([p.id]) }, why: `post authors: ${p.displayName}` })
}
// event hosts
const eventIds = [...new Set(report.proposals.flatMap((p) => p.placements).filter((pl) => pl.kind === 'eventHost').map((pl) => pl.docId))]
for (const docId of eventIds) {
  const doc = await client.getDocument(docId)
  if (!doc) { skipped.push(`event ${docId}: gone`); continue }
  const hosts = doc.hosts ?? []
  const ids = []
  let ok = true
  hosts.forEach((_h, i) => { const p = placementPerson.get(`eventHost|${docId}|${i}`); if (!p) ok = false; else ids.push(p.id) })
  if (!ok || !hosts.length) { skipped.push(`event ${docId}: not every host has a person to point to — left on inline hosts`); continue }
  if (sameRefs(doc.hostPeople, ids)) { skipped.push(`event ${docId}: already points at these people`); continue }
  if ((doc.hostPeople ?? []).length) { skipped.push(`event ${docId}: hostPeople already set — not overwritten`); continue }
  patches.push({ docId, rev: doc._rev, set: { hostPeople: refsFor(ids) }, why: `event hostPeople: ${ids.length}` })
}
void baseId
say('')
for (const p of patches) say(`  [${CONFIRM ? 'PATCH   ' : 'WOULD   '}] ${p.docId}  ${p.why}`)
for (const s of skipped) say(`  [KEEP    ] ${s}`)
const toCreate = personDocs.filter((d) => !d.exists).length
say(`\n${CONFIRM ? 'Applying' : 'Would apply'}: ${toCreate} person(s) to create (${personDocs.length - toCreate} exist), ${patches.length} placement patch(es), ${skipped.length} kept as is.`)
if (!CONFIRM) { say('Dry run — nothing written.\n'); process.exit(0) }

// ── Write ────────────────────────────────────────────────────────────────────
if (client.config().dataset !== dataset) die('client dataset changed')
if (toCreate) {
  let tx = client.transaction()
  for (const d of personDocs.filter((x) => !x.exists)) tx = tx.createIfNotExists(d.doc)
  await tx.commit({ visibility: 'sync' })
  say(`  ✓ created ${toCreate} person document(s)`)
}
let ok = 0, failed = 0
for (const p of patches) {
  try {
    await client.transaction().patch(p.docId, (x) => x.ifRevisionId(p.rev).set(p.set)).commit({ visibility: 'sync' })
    ok++; say(`  ✓ ${p.docId}`)
  } catch (e) { failed++; say(`  ✗ ${p.docId}: ${e.message} (nothing written for this document; re-run to retry)`) }
}
say(`\nDone: ${ok} patched, ${failed} failed. Fallbacks (members / author / hosts) untouched.\nVerify: *[_type=="person" && projectSlug=="${slug}"]{_id,firstName,lastName}\n`)
process.exit(failed ? 2 : 0)
