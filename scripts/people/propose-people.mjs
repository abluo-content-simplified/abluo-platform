#!/usr/bin/env node
/**
 * People module migration — PROPOSE (ADR-043 D10.2). READ-ONLY.
 *
 * Reads, per project, every teamSection member (pages + legacy homePage,
 * published AND drafts), every postAuthor (with the posts that use it) and every
 * event host, and proposes `person` documents for Tom to confirm. Nothing is
 * written to Sanity (the read token is used; the script has no write path).
 * Same normalised name across sources => ONE proposal. Near-duplicates are
 * flagged "check", never merged. Writes a JSON + Markdown report.
 *
 *   node --env-file=.env.local scripts/people/propose-people.mjs --projects=cyce,studiomartegani
 *   … --out-dir=<folder>      override the report folder
 *
 * The JSON report is the input of apply-people.mjs. Tom edits it: set
 * "decision": "skip" to drop a proposal, "mergeInto": "<other key>" to fold a
 * duplicate into another, or fix names/titles in "person".
 */
import { writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg, makeClient, reportDir } from '../lib/people-io.mjs'
import { authorCandidate, baseId, collapse, groupCandidates, hostCandidates, teamCandidates, teamSectionsOf } from '../lib/people-migration.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const projectsArg = arg('--projects')
const slugs = typeof projectsArg === 'string' ? projectsArg.split(',').map((s) => s.trim()).filter(Boolean) : []
if (!slugs.length) { console.error('Usage: node --env-file=.env.local scripts/people/propose-people.mjs --projects=<slug,...> [--out-dir=<dir>]'); process.exit(1) }

const client = makeClient({ write: false })
const NOT_VERSION = '!(_id in path("versions.**"))'
const loc = (v) => (typeof v === 'string' ? v : v?.en ?? v?.it ?? v?.de ?? Object.values(v ?? {}).find((x) => typeof x === 'string') ?? null)

async function proposeFor(slug) {
  const project = await client.fetch(`*[_type == "project" && projectSlug == $slug && ${NOT_VERSION} && !(_id in path("drafts.**"))][0]{ _id, projectSlug, tenantSlug, "people": count(moduleInstallations[moduleId == "people"]) > 0 }`, { slug })
  if (!project) return { slug, missing: true }

  const [pages, authors, posts, events, mediaAssets, existingPeople] = await Promise.all([
    client.fetch(`*[_type in ["page","homePage"] && projectSlug == $slug && ${NOT_VERSION}]`, { slug }),
    client.fetch(`*[_type == "postAuthor" && projectSlug == $slug && ${NOT_VERSION} && !(_id in path("drafts.**"))]`, { slug }),
    client.fetch(`*[_type == "post" && projectSlug == $slug && ${NOT_VERSION} && defined(author)]{ _id, title, "authorRef": author._ref, authors }`, { slug }),
    client.fetch(`*[_type == "event" && projectSlug == $slug && ${NOT_VERSION} && count(hosts) > 0]{ _id, title, hosts, hostPeople }`, { slug }),
    client.fetch(`*[_type == "mediaAsset" && projectSlug == $slug && ${NOT_VERSION} && !(_id in path("drafts.**")) && defined(image.asset._ref)]{ _id, name, "ref": image.asset._ref }`, { slug }),
    client.fetch(`*[_type == "person" && projectSlug == $slug && ${NOT_VERSION}]{ _id, firstName, lastName, publicId }`, { slug }),
  ])

  const candidates = []
  const stats = { teamSections: 0, teamMembers: 0, authors: authors.length, postsWithAuthor: new Set(posts.map((p) => baseId(p._id))).size, events: new Set(events.map((e) => baseId(e._id))).size, hosts: 0 }
  for (const doc of pages) {
    const sections = teamSectionsOf(doc)
    if (!sections.length) continue
    stats.teamSections += sections.length
    const label = `${doc._type} ${doc._id}${loc(doc.title) ? ` "${loc(doc.title)}"` : ''}`
    const c = teamCandidates(doc, label)
    stats.teamMembers += c.length
    candidates.push(...c)
  }
  for (const a of authors) {
    const c = authorCandidate(a, posts.filter((p) => p.authorRef === a._id).map((p) => ({ ...p, title: loc(p.title) })))
    if (c) candidates.push(c)
  }
  for (const e of events) { const c = hostCandidates({ ...e, title: e.title }); stats.hosts += c.length; candidates.push(...c) }

  const { proposals, checks } = groupCandidates(slug, candidates)
  const mediaByRef = new Map(mediaAssets.map((m) => [m.ref, m]))
  for (const p of proposals) {
    const ref = p.person.photoImageAssetRef
    if (!ref) continue
    const m = mediaByRef.get(ref)
    if (m) { p.person.photoMediaAssetId = m._id; p.person.photoMediaAssetName = m.name ?? null }
    else p.flags.push('photo: needs Media Library asset (the image has no mediaAsset in this project; run scripts/backfill-media-assets.mjs, then re-propose)')
  }
  const already = new Set(existingPeople.map((p) => p._id))
  for (const p of proposals) if (already.has(p.id)) p.alreadyCreated = true

  return { slug, project, stats, proposals, checks, existingPeople: existingPeople.length }
}

function markdown(r, generatedAt) {
  const L = []
  L.push(`# People proposal — ${r.slug}`, '', `Generated ${generatedAt} (read-only). Dataset: ${client.config().dataset}. People module installed on project: ${r.project.people ? 'yes' : 'NO (migration 009 not run)'}.`, '')
  L.push(`- Team sections: ${r.stats.teamSections}, team members found: ${r.stats.teamMembers}`, `- Post authors: ${r.stats.authors} (posts using one: ${r.stats.postsWithAuthor})`, `- Events with hosts: ${r.stats.events} (host entries: ${r.stats.hosts})`, `- Proposed persons: ${r.proposals.length}; duplicates to check: ${r.checks.length}; \`person\` documents already in project: ${r.existingPeople}`, '')
  if (r.checks.length) {
    L.push('## Duplicates to check (never merged automatically)', '')
    for (const c of r.checks) L.push(`- **${c.names[0]}** vs **${c.names[1]}** — ${c.kind}: ${c.note}  \n  keys \`${c.keys[0]}\`, \`${c.keys[1]}\``)
    L.push('', 'To merge: in the JSON, set `"mergeInto": "<key of the one to keep>"` on the other. To drop: `"decision": "skip"`.', '')
  }
  L.push('## Proposals', '')
  for (const p of r.proposals) {
    const x = p.person
    L.push(`### ${[x.honorific?.it ?? x.honorific?.en, x.firstName, x.lastName].filter(Boolean).join(' ')}  \`${p.key}\`  — ${p.decision}${p.alreadyCreated ? ' (already created)' : ''}`)
    L.push(`- id \`${p.id}\`, publicId \`${p.publicId}\``)
    if (x.honorific) L.push(`- honorific: ${JSON.stringify(x.honorific)}`)
    if (x.jobTitle) L.push(`- jobTitle: ${JSON.stringify(x.jobTitle)}`)
    if (x.shortBio) L.push(`- shortBio: ${Object.entries(x.shortBio).map(([k, v]) => `${k}: ${collapse(v).slice(0, 80)}${v.length > 80 ? '…' : ''}`).join(' | ')}`)
    if (x.website) L.push(`- website: ${x.website}`)
    if (x.legacyAnchors.length) L.push(`- legacyAnchors: ${x.legacyAnchors.join(', ')}`)
    L.push(`- photo: ${x.photoMediaAssetId ? `mediaAsset ${x.photoMediaAssetId}` : x.photoImageAssetRef ? 'NEEDS Media Library asset' : 'none'}`)
    L.push(`- sources: ${p.sources.map((s) => `${s.source} "${s.rawName}" (${s.doc.id})`).join('; ')}`)
    const kinds = {}; for (const pl of p.placements) kinds[pl.kind] = (kinds[pl.kind] ?? 0) + 1
    L.push(`- placements to re-point: ${Object.entries(kinds).map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'}`)
    for (const f of p.flags) L.push(`- FLAG: ${f}`)
    for (const [field, vals] of Object.entries(p.conflicts)) L.push(`- CONFLICT ${field}: ${vals.map((v) => `${v.from}=${JSON.stringify(v.value)}`).join(' vs ')}`)
    for (const c of p.checks) L.push(`- CHECK (${c.kind}): ${c.note}`)
    L.push('')
  }
  return L.join('\n')
}

const generatedAt = new Date().toISOString()
console.log(`Propose people · dataset ${client.config().dataset} · READ ONLY · projects: ${slugs.join(', ')}\n`)
for (const slug of slugs) {
  const r = await proposeFor(slug)
  if (r.missing) { console.log(`✗ ${slug}: no project document in Abluo yet — nothing to propose.\n`); continue }
  const outArg = arg('--out-dir')
  const { dir, where } = typeof outArg === 'string' ? { dir: resolve(outArg), where: '--out-dir' } : reportDir(r.project.tenantSlug ?? slug, slug, REPO)
  const base = join(dir, `people-proposal-${slug}`)
  const json = { schema: 'people-proposal/1', generatedAt, dataset: client.config().dataset, projectSlug: slug, projectId: r.project._id, peopleModuleInstalled: r.project.people, stats: r.stats, checks: r.checks, proposals: r.proposals }
  writeFileSync(`${base}.json`, JSON.stringify(json, null, 2) + '\n')
  writeFileSync(`${base}.md`, markdown(r, generatedAt))
  console.log(`• ${slug}: ${r.proposals.length} proposal(s), ${r.checks.length} duplicate check(s), ${r.proposals.filter((p) => p.flags.length).length} flagged — ${where}\n    ${base}.json\n    ${base}.md\n`)
}
