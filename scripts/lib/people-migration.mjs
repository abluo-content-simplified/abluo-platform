// People module (ADR-043 D10) — pure planning helpers for the migration scripts
// scripts/people/propose-people.mjs and apply-people.mjs. No network, no I/O.
//
// Principles: propose, never merge by guess. Same normalised name across
// sources => ONE proposal listing every source. Near-duplicates => flagged
// "check", never merged. The deterministic ids below make a re-run a no-op.
import { createHash } from 'node:crypto'

// ── Names ─────────────────────────────────────────────────────────────────────

/** Honorifics we strip from the front of a name (longest first). value => per language rendering. */
const HONORIFICS = [
  { re: /^dott\.?\s*ssa\.?(?=\s|$)/i, it: 'Dott.ssa', en: 'Dr.', de: 'Dr.', fr: 'Dr', es: 'Dra.' },
  { re: /^dr\.?\s*ssa\.?(?=\s|$)/i, it: 'Dott.ssa', en: 'Dr.', de: 'Dr.', fr: 'Dr', es: 'Dra.' },
  { re: /^dottoressa(?=\s|$)/i, it: 'Dott.ssa', en: 'Dr.', de: 'Dr.', fr: 'Dr', es: 'Dra.' },
  { re: /^dottor(?:e)?(?=\s|$)/i, it: 'Dott.', en: 'Dr.', de: 'Dr.', fr: 'Dr', es: 'Dr.' },
  { re: /^dott\.?(?=\s|$)/i, it: 'Dott.', en: 'Dr.', de: 'Dr.', fr: 'Dr', es: 'Dr.' },
  { re: /^doctor(?=\s|$)/i, it: 'Dott.', en: 'Dr.', de: 'Dr.', fr: 'Dr', es: 'Dr.' },
  { re: /^dr\.?(?=\s|$)/i, it: 'Dott.', en: 'Dr.', de: 'Dr.', fr: 'Dr', es: 'Dr.' },
  { re: /^prof\.?\s*ssa\.?(?=\s|$)/i, it: 'Prof.ssa', en: 'Prof.', de: 'Prof.', fr: 'Prof.', es: 'Prof.' },
  { re: /^professoressa(?=\s|$)/i, it: 'Prof.ssa', en: 'Prof.', de: 'Prof.', fr: 'Prof.', es: 'Prof.' },
  { re: /^professor(?:e)?(?=\s|$)/i, it: 'Prof.', en: 'Prof.', de: 'Prof.', fr: 'Prof.', es: 'Prof.' },
  { re: /^prof\.?(?=\s|$)/i, it: 'Prof.', en: 'Prof.', de: 'Prof.', fr: 'Prof.', es: 'Prof.' },
  { re: /^avv\.?(?=\s|$)/i, it: 'Avv.', en: 'Att.', de: 'RA', fr: 'Me', es: 'Abog.' },
  { re: /^ing\.?(?=\s|$)/i, it: 'Ing.', en: 'Eng.', de: 'Ing.', fr: 'Ing.', es: 'Ing.' },
  { re: /^sig\.?\s*ra\.?(?=\s|$)/i, it: 'Sig.ra', en: 'Mrs', de: 'Frau', fr: 'Mme', es: 'Sra.' },
  { re: /^sig\.?(?=\s|$)/i, it: 'Sig.', en: 'Mr', de: 'Herr', fr: 'M.', es: 'Sr.' },
  { re: /^mr\.?(?=\s|$)/i, it: 'Sig.', en: 'Mr', de: 'Herr', fr: 'M.', es: 'Sr.' },
  { re: /^mrs\.?(?=\s|$)/i, it: 'Sig.ra', en: 'Mrs', de: 'Frau', fr: 'Mme', es: 'Sra.' },
  { re: /^ms\.?(?=\s|$)/i, it: 'Sig.ra', en: 'Ms', de: 'Frau', fr: 'Mme', es: 'Sra.' },
  { re: /^herr(?=\s|$)/i, it: 'Sig.', en: 'Mr', de: 'Herr', fr: 'M.', es: 'Sr.' },
  { re: /^frau(?=\s|$)/i, it: 'Sig.ra', en: 'Mrs', de: 'Frau', fr: 'Mme', es: 'Sra.' },
]

/** Lower-case particles that belong to the surname ("Maria Di Stefano", "Jan van der Berg"). */
const PARTICLES = new Set(['de', 'di', 'da', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'dal', 'dalla', 'dai', 'la', 'le', 'lo', 'van', 'von', 'der', 'den', 'ten', 'ter', 'du', 'des', 'el', 'al', 'bin', 'ibn', "d'", "dell'"])

export const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
export const caseFold = (s) => collapse(s).toLocaleLowerCase('it')
/** Accents folded too — ONLY used to flag near-duplicates; stored names keep accents. */
export const accentFold = (s) => caseFold(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim()

/**
 * Strip leading honorific(s). Returns { name, honorific: {it,en,..}|null, rawHonorific }.
 * "Dott.ssa Maria Rossi" => name "Maria Rossi", honorific { it: 'Dott.ssa', en: 'Dr.', de: 'Dr.' }.
 */
export function stripHonorific(raw) {
  let name = collapse(raw)
  let found = null
  let rawHonorific = null
  for (let i = 0; i < 3; i++) {
    const h = HONORIFICS.find((x) => x.re.test(name))
    if (!h) break
    const m = name.match(h.re)
    rawHonorific = rawHonorific ? `${rawHonorific} ${m[0]}` : m[0]
    if (!found) found = h
    name = collapse(name.slice(m[0].length).replace(/^[.,]\s*/, ''))
  }
  const honorific = found ? Object.fromEntries(Object.entries(found).filter(([k]) => k !== 're')) : null
  return { name, honorific, rawHonorific }
}

/** Split a name into first/last. Particles stay with the surname. Single word => flagged. */
export function splitName(name) {
  const tokens = collapse(name).split(' ').filter(Boolean)
  if (tokens.length === 0) return { firstName: '', lastName: '', singleWord: false, empty: true }
  if (tokens.length === 1) return { firstName: tokens[0], lastName: '', singleWord: true, empty: false }
  let i = tokens.length - 1
  while (i > 1 && PARTICLES.has(tokens[i - 1].toLocaleLowerCase('it'))) i--
  return { firstName: tokens.slice(0, i).join(' '), lastName: tokens.slice(i).join(' '), singleWord: false, empty: false }
}

/** Words that mark an author/host entry as a team or organisation, not a person. */
const ORG_HINT = /\b(team|staff|redazione|editorial|editorial team|studio|clinic|clinica|associazione|club|company|ltd|srl|s\.r\.l\.|gmbh|inc)\b/i

/** Full parse of one raw name. `existingHonorific` is the source's own honorific field (localized), if any. */
/** @param {string} raw @param {any} [existingHonorific] @returns {any} */
export function parseName(raw, existingHonorific = null) {
  const { name, honorific, rawHonorific } = stripHonorific(raw)
  const split = splitName(name)
  const own = cleanLocalized(existingHonorific)
  return {
    cleanName: name,
    firstName: split.firstName,
    lastName: split.lastName,
    singleWord: split.singleWord,
    empty: split.empty,
    looksLikeOrganisation: ORG_HINT.test(name),
    // The source's own honorific field wins; the stripped one fills what is missing.
    honorific: own ? { ...(honorific ?? {}), ...own } : honorific,
    strippedHonorific: rawHonorific,
    exactKey: caseFold(name),
    looseKey: accentFold(name),
    tokensKey: accentFold(name).split(' ').sort().join(' '),
    lastKey: accentFold(split.lastName),
    initial: accentFold(split.firstName).slice(0, 1),
  }
}

// ── Localized values ──────────────────────────────────────────────────────────

/** {_type, it, en, translationStatus,...} => {it,en} without meta and empty strings; null when empty. */
export function cleanLocalized(v) {
  if (!v || typeof v !== 'object') return null
  const out = {}
  for (const [k, val] of Object.entries(v)) {
    if (k.startsWith('_') || k === 'translationStatus') continue
    if (typeof val === 'string' && val.trim()) out[k] = val.trim()
  }
  return Object.keys(out).length ? out : null
}
const sameLocalized = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
function sortKeys(o) { return o ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])) : o }

// ── Ids ───────────────────────────────────────────────────────────────────────

export const sha1 = (s) => createHash('sha1').update(s).digest('hex')
/** Stable identity of a proposal: derived from the project and the ORIGINAL normalised name (never from edits). */
export const proposalKey = (projectSlug, exactKey) => sha1(`${projectSlug}|${exactKey}`).slice(0, 12)
/** Deterministic Sanity id => a re-run finds the person it already created. */
export const personDocId = (projectSlug, key) => `person-${projectSlug}-${key}`
/** Deterministic UUID-shaped publicId (v4 layout) from the same hash, so a re-run never mints a second one. */
export function personPublicId(projectSlug, key) {
  const h = sha1(`publicId|${projectSlug}|${key}`)
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// ── Candidates ────────────────────────────────────────────────────────────────

/**
 * A candidate is one occurrence of a person in existing data:
 *  { source: 'teamMember'|'postAuthor'|'eventHost', rawName, honorific?, role?, bio?, website?, anchorId?, url?,
 *    imageAssetRef?, doc: {id, type, label}, placement: {...} }
 * `placement` says what will be re-pointed (see apply-people.mjs).
 */
const SOURCE_PRIORITY = { teamMember: 0, postAuthor: 1, eventHost: 2 }

/** Group candidates into proposals + duplicate report. */
/** @param {string} projectSlug @param {any[]} candidates @returns {{ proposals: any[], [k: string]: any }} */
export function groupCandidates(projectSlug, candidates) {
  const groups = new Map()
  for (const c of candidates) {
    const parsed = parseName(c.rawName, c.honorific)
    if (parsed.empty) continue
    const k = parsed.exactKey
    if (!groups.has(k)) groups.set(k, { exactKey: k, members: [] })
    groups.get(k).members.push({ ...c, parsed })
  }
  const proposals = [...groups.values()].map((g) => buildProposal(projectSlug, g))
  proposals.sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName))
  const checks = findChecks(proposals)
  for (const p of proposals) p.checks = checks.filter((c) => c.keys.includes(p.key)).map((c) => ({ kind: c.kind, with: c.keys.filter((x) => x !== p.key), note: c.note }))
  return { proposals, checks }
}

function pickFirst(members, get, same) {
  const values = []
  for (const m of members) {
    const v = get(m)
    if (v == null || v === '') continue
    if (!values.some((x) => same(x.value, v))) values.push({ value: v, from: m.source })
  }
  return { value: values[0]?.value ?? null, conflict: values.length > 1 ? values : null }
}

/** @returns {any} */
function buildProposal(projectSlug, group) {
  const members = [...group.members].sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source])
  const key = proposalKey(projectSlug, group.exactKey)
  const lead = members[0].parsed
  const flags = []
  const conflicts = {}
  const jobTitle = pickFirst(members, (m) => cleanLocalized(m.role), sameLocalized)
  const shortBio = pickFirst(members, (m) => cleanLocalized(m.bio), sameLocalized)
  const website = pickFirst(members, (m) => (m.website ? String(m.website).trim() : null), (a, b) => a === b)
  const honorific = pickFirst(members, (m) => m.parsed.honorific, sameLocalized)
  const photo = pickFirst(members, (m) => m.imageAssetRef, (a, b) => a === b)
  if (jobTitle.conflict) conflicts.jobTitle = jobTitle.conflict
  if (shortBio.conflict) conflicts.shortBio = shortBio.conflict
  if (website.conflict) conflicts.website = website.conflict
  if (honorific.conflict) conflicts.honorific = honorific.conflict
  if (photo.conflict) conflicts.photo = photo.conflict
  if (lead.singleWord) flags.push('single-word name: no last name (allowed; add one in the report if known)')
  if (members.every((m) => m.parsed.looksLikeOrganisation)) flags.push('looks like a team or organisation, not a person: probably skip')
  const legacyAnchors = [...new Set(members.map((m) => m.anchorId).filter(Boolean))]
  const hostAnchors = [...new Set(members.map((m) => m.hostAnchor).filter(Boolean))]
  const order = Math.min(...members.map((m) => (typeof m.order === 'number' ? m.order : 1e9)))
  return {
    key,
    id: personDocId(projectSlug, key),
    publicId: personPublicId(projectSlug, key),
    decision: lead.singleWord || flags.some((f) => f.startsWith('looks like')) ? 'review' : 'create',
    mergeInto: null,
    order,
    displayName: collapse(`${lead.firstName} ${lead.lastName}`),
    person: {
      firstName: lead.firstName,
      lastName: lead.lastName,
      honorific: honorific.value,
      jobTitle: jobTitle.value,
      shortBio: shortBio.value,
      website: website.value,
      legacyAnchors,
      photoImageAssetRef: photo.value,
      photoMediaAssetId: null, // filled by the proposer when a mediaAsset already holds the image
    },
    flags,
    conflicts,
    hostAnchors,
    sources: members.map((m) => ({
      source: m.source,
      rawName: m.rawName,
      strippedHonorific: m.parsed.strippedHonorific,
      doc: m.doc,
      label: m.label ?? null,
    })),
    placements: members.flatMap((m) => m.placements ?? []),
    checks: [],
  }
}

/** Duplicate report: exact matches are already grouped; these are the ones that need Tom's eye. */
export function findChecks(proposals) {
  const checks = []
  const seen = new Set()
  const add = (kind, a, b, note) => {
    const id = [kind, ...[a.key, b.key].sort()].join(':')
    if (seen.has(id)) return
    seen.add(id)
    checks.push({ kind, keys: [a.key, b.key], names: [a.displayName, b.displayName], note })
  }
  const info = proposals.map((p) => ({ p, ...parseName(`${p.person.firstName} ${p.person.lastName}`) }))
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const a = info[i], b = info[j]
      if (a.looseKey === b.looseKey) add('accent-or-case', a.p, b.p, 'same name once accents are ignored')
      else if (a.tokensKey === b.tokensKey) add('word-order', a.p, b.p, 'same words in a different order')
      else if (a.lastKey && a.lastKey === b.lastKey && a.initial && a.initial === b.initial) add('same-surname-initial', a.p, b.p, 'same surname and first initial')
      else if (a.singleWord !== undefined && (a.lastKey === '' || b.lastKey === '')) {
        // one-word entry vs a full name containing it ("Florian" vs "Florian Parra")
        const one = a.lastKey === '' ? a : b, full = a.lastKey === '' ? b : a
        if (one.lastKey === '' && one.looseKey && full.looseKey.split(' ').includes(one.looseKey)) add('first-name-only', one.p, full.p, 'a one-word entry matches the first name or surname of another person')
      }
      const aAnchors = a.p.person.legacyAnchors, bAnchors = b.p.person.legacyAnchors
      if (aAnchors.some((x) => bAnchors.includes(x))) add('same-anchor', a.p, b.p, 'share an anchorId')
      else if (aAnchors.some((x) => b.p.hostAnchors.includes(x)) || bAnchors.some((x) => a.p.hostAnchors.includes(x))) add('host-links-to-member', a.p, b.p, 'an event host links to this team member\'s anchor (/page#anchor)')
    }
  }
  return checks
}

/** Hosts that link to /page#anchor where the anchor belongs to a team member: strong hint, flagged as a check. */
export function anchorOf(url) {
  const m = String(url ?? '').match(/#([a-z0-9_-]+)\s*$/i)
  return m ? m[1].toLowerCase() : null
}

// ── Reading the stored document shapes ───────────────────────────────────────

/** Walk any document and yield every object with `_type`, with a patch path built from `_key`s. */
export function* walk(node, path = '') {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const el = node[i]
      const seg = el && typeof el === 'object' && el._key ? `[_key=="${el._key}"]` : `[${i}]`
      yield* walk(el, `${path}${seg}`)
    }
  } else if (node && typeof node === 'object') {
    if (node._type) yield { node, path }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') yield* walk(v, path ? `${path}.${k}` : k)
    }
  }
}

export const baseId = (id) => String(id).replace(/^drafts\./, '')
export const isDraftId = (id) => String(id).startsWith('drafts.')

/** Every teamSection of a page-like document => { path, section }. */
export function teamSectionsOf(doc) {
  const out = []
  for (const { node, path } of walk(doc)) if (node._type === 'teamSection') out.push({ path, section: node })
  return out
}

export const imageRefOf = (img) => (img && img.asset && typeof img.asset._ref === 'string' ? img.asset._ref : null)

/** Candidates from one page/homePage version. Section order across the page defines the site order. */
export function teamCandidates(doc, label) {
  const out = []
  let sectionIndex = 0
  for (const { path, section } of teamSectionsOf(doc)) {
    sectionIndex++
    const members = section.members ?? []
    members.forEach((m, i) => {
      if (!m || !collapse(m.name)) return
      out.push({
        source: 'teamMember',
        rawName: m.name,
        honorific: m.honorific,
        role: m.role,
        bio: m.bio,
        website: m.website,
        anchorId: m.anchorId ?? null,
        imageAssetRef: imageRefOf(m.photo),
        order: sectionIndex * 1000 + i,
        doc: { id: doc._id, type: doc._type, label },
        label: `${label} / team section / #${i + 1}`,
        placements: [{ kind: 'teamSection', docId: doc._id, docType: doc._type, sectionPath: path, memberKey: m._key ?? null, index: i, memberCount: members.length, hasPeople: (section.people ?? []).length > 0 }],
      })
    })
  }
  return out
}

export function authorCandidate(author, posts) {
  if (!collapse(author.name)) return null
  return {
    source: 'postAuthor',
    rawName: author.name,
    role: author.role,
    bio: author.bio,
    imageAssetRef: imageRefOf(author.avatar),
    order: 5e8,
    doc: { id: author._id, type: 'postAuthor', label: author.name },
    label: `postAuthor ${author._id}`,
    placements: posts.map((p) => ({ kind: 'postAuthor', docId: p._id, authorId: author._id, hasAuthors: (p.authors ?? []).length > 0, title: p.title ?? null })),
  }
}

export function hostCandidates(event) {
  const out = []
  const hosts = event.hosts ?? []
  hosts.forEach((h, i) => {
    if (!h || !collapse(h.name)) return
    out.push({
      source: 'eventHost',
      rawName: h.name,
      role: h.role,
      anchorId: null,
      hostAnchor: anchorOf(h.url),
      order: 8e8 + i,
      doc: { id: event._id, type: 'event', label: event.title?.en ?? event.title?.it ?? event._id },
      label: `event ${event._id} / host #${i + 1}`,
      placements: [{ kind: 'eventHost', docId: event._id, index: i, hostKey: h._key ?? null, hostCount: hosts.length, hasHostPeople: (event.hostPeople ?? []).length > 0 }],
    })
  })
  return out
}

// ── Apply planning ────────────────────────────────────────────────────────────

/** Fold `mergeInto` decisions: the merged proposal's sources/placements move to the target. */
export function resolveMerges(proposals) {
  const byKey = new Map(proposals.map((p) => [p.key, p]))
  const errors = []
  const active = []
  for (const p of proposals) {
    if (p.mergeInto) {
      const t = byKey.get(p.mergeInto)
      if (!t || t.mergeInto) { errors.push(`${p.displayName}: mergeInto "${p.mergeInto}" is not a proposal in this report (or itself merged)`); continue }
      t.placements = [...t.placements, ...p.placements.map((x) => ({ ...x, viaKey: p.key }))]
      t.person.legacyAnchors = [...new Set([...(t.person.legacyAnchors ?? []), ...(p.person.legacyAnchors ?? [])])]
      continue
    }
    active.push(p)
  }
  return { proposals: active, errors }
}

/** Why a proposal cannot be applied as it stands. */
export function blockersOf(p) {
  const why = []
  if (p.decision !== 'create') why.push(`decision is "${p.decision}" (set "create" in the report to apply)`)
  if (!collapse(p.person.firstName)) why.push('firstName is empty')
  return why
}

export function localized(type, v) {
  return v ? { _type: type, ...v } : undefined
}

/** The `person` document a proposal creates. Groups stay empty; visibility 'listed'; no slug. */
/** @param {string} projectSlug @param {any} p @param {{ sortOrder?: number }} [opts] @returns {Record<string, any>} */
export function buildPersonDocument(projectSlug, p, { sortOrder } = {}) {
  const x = p.person
  const doc = {
    _id: p.id,
    _type: 'person',
    projectSlug,
    publicId: p.publicId,
    firstName: collapse(x.firstName),
    ...(collapse(x.lastName) ? { lastName: collapse(x.lastName) } : {}),
    visibility: 'listed',
    groups: [],
  }
  const hon = localized('localizedString', x.honorific); if (hon) doc.honorific = hon
  const job = localized('localizedString', x.jobTitle); if (job) doc.jobTitle = job
  const bio = localized('localizedText', x.shortBio); if (bio) doc.shortBio = bio
  if (x.website && /^https?:\/\//i.test(x.website)) doc.website = x.website
  if (x.legacyAnchors?.length) doc.legacyAnchors = x.legacyAnchors
  if (x.photoMediaAssetId) doc.photo = { _type: 'reference', _ref: x.photoMediaAssetId }
  if (typeof sortOrder === 'number') doc.sortOrder = sortOrder
  return doc
}

export const weakRef = (id, key) => ({ _type: 'reference', _ref: id, _weak: true, _key: key })
/** Stable _key for a placement ref, so re-applying the same list is byte-identical. */
export const refKey = (personId) => sha1(`ref|${personId}`).slice(0, 12)
