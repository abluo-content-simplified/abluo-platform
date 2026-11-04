#!/usr/bin/env node
/**
 * Events 2.0 — C5 migration: Sanity event dates → Supabase schedules (ADR-038 §4 step 2).
 *
 * DRY RUN BY DEFAULT. Reads every event (published, else draft-only) and the
 * existing schedules, and writes a report of what --apply would create. Nothing
 * is written without --apply.
 *
 *   node --env-file=.env.local scripts/events/migrate-event-schedules.mjs              # dry run, all projects
 *   node --env-file=.env.local scripts/events/migrate-event-schedules.mjs --projects=cyce,livener
 *   node --env-file=.env.local scripts/events/migrate-event-schedules.mjs --apply      # after Tom's review (CP3)
 *
 * Rules (ADR-038 D3/D10, Phase 1 plan C5):
 *   - one series + one session per event, origin = 'migrated';
 *   - local time = the stored UTC instant shown in the venue's zone, else the
 *     site's siteConfig.timeZone; an event with neither is reported, not migrated;
 *   - place: location key or venue publicId; attendance mode copied;
 *   - eventStatus 'cancelled' → session cancelled; 'postponed' / 'soldOut' stay
 *     in Sanity (scheduling only knows scheduled / cancelled);
 *   - instructors left empty: event hosts stay on the Sanity event (hostPeople, ADR-043);
 *   - idempotent on (project, publicId): an event whose schedule already has the
 *     same times is skipped; a different one is updated with the stored version.
 *     Re-run any time as a RECONCILE: it repairs schedules that drifted from the
 *     published dates (e.g. an edit published from Studio, ADR-038 C6a).
 */
import { createClient as sanityClient } from '@sanity/client'
import { createClient as supabaseClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const APPLY = process.argv.includes('--apply')
const projArg = process.argv.find((a) => a.startsWith('--projects='))
const only = projArg ? projArg.slice(11).split(',').map((s) => s.trim()).filter(Boolean) : null

for (const k of ['NEXT_PUBLIC_SANITY_PROJECT_ID', 'SANITY_API_READ_TOKEN', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[k]) { console.error(`${k} missing (run with node --env-file=.env.local …)`); process.exit(1) }
}
const sanity = sanityClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: '2026-05-21', token: process.env.SANITY_API_READ_TOKEN, useCdn: false, perspective: 'raw',
})
const db = supabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const NOT_VERSION = '!(_id in path("versions.**"))'
const loc = (v) => (typeof v === 'string' ? v : v?.en ?? v?.it ?? v?.fr ?? v?.de ?? Object.values(v ?? {}).find((x) => typeof x === 'string') ?? null)
const baseId = (id) => id.replace(/^drafts\./, '')

/** UTC ISO → 'YYYY-MM-DDTHH:mm' wall clock in zone. */
function localOf(iso, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
const validZone = (z) => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true } catch { return false } }
const UUID = /^[0-9a-f-]{36}$/

const events = await sanity.fetch(`*[_type == "event" && ${NOT_VERSION}]{
  _id, projectSlug, publicId, title, startDate, endDate, eventStatus, attendanceMode,
  "placeKind": place.kind, "locationKey": place.locationKey,
  "venuePublicId": place.venue->publicId, "venueZone": place.venue->timeZone
}`)
const configs = await sanity.fetch(`*[_type == "siteConfig" && ${NOT_VERSION} && !(_id in path("drafts.**"))]{ projectSlug, timeZone }`)
const zoneOf = new Map(configs.map((c) => [c.projectSlug, c.timeZone]))

// Published wins over draft; draft-only events are included (Phase 1 plan: the Livener draft).
const byId = new Map()
for (const e of events) {
  const id = baseId(e._id); const isDraft = e._id.startsWith('drafts.')
  const prev = byId.get(id)
  if (!prev || (prev.isDraft && !isDraft)) byId.set(id, { ...e, id, isDraft, hasPublished: !isDraft || prev?.hasPublished })
  else if (!isDraft) prev.hasPublished = true
}
let rows = [...byId.values()].filter((e) => !only || only.includes(e.projectSlug))

const slugs = [...new Set(rows.map((e) => e.projectSlug))]
const { data: projects, error: pErr } = await db.from('projects').select('id, slug').in('slug', slugs)
if (pErr) { console.error('Supabase projects read failed:', pErr.message); process.exit(1) }
const projectIds = new Map()
for (const s of slugs) { const m = projects.filter((p) => p.slug === s); if (m.length === 1) projectIds.set(s, m[0].id) }

const { data: existing, error: sErr } = await db.from('event_series')
  .select('id, project_id, event_public_id, origin, version, start_local, end_local, time_zone, removed_at, rule')
  .is('removed_at', null).is('rule', null)
if (sErr) { console.error('Supabase event_series read failed:', sErr.message); process.exit(1) }
const seriesOf = new Map(existing.map((s) => [`${s.project_id}:${s.event_public_id}`, s]))

const plan = []
for (const e of rows.sort((a, b) => (a.projectSlug + a.startDate).localeCompare(b.projectSlug + b.startDate))) {
  const item = { project: e.projectSlug, id: e.id, title: loc(e.title), draftOnly: e.isDraft && !e.hasPublished, publicId: e.publicId ?? null, problems: [] }
  const projectId = projectIds.get(e.projectSlug)
  if (!projectId) item.problems.push('no unique Supabase project for this projectSlug')
  if (!e.publicId || !UUID.test(e.publicId)) item.problems.push('missing/invalid publicId (run scripts/backfill-public-ids.mjs)')
  if (!e.startDate) item.problems.push('no startDate')
  const zone = e.venueZone || zoneOf.get(e.projectSlug)
  if (!zone || !validZone(zone)) item.problems.push(`no valid time zone (venue ${e.venueZone ?? '–'}, site ${zoneOf.get(e.projectSlug) ?? '–'})`)
  let place = null
  if (e.attendanceMode !== 'online') {
    if (e.placeKind === 'location' && e.locationKey) place = { kind: 'location', key: e.locationKey }
    else if (e.placeKind === 'venue') {
      if (e.venuePublicId && UUID.test(e.venuePublicId)) place = { kind: 'venue', venuePublicId: e.venuePublicId }
      else item.problems.push('venue without publicId')
    }
  }
  item.zone = zone ?? null
  if (!item.problems.length) {
    item.startsAt = e.startDate; item.endsAt = e.endDate ?? null
    item.startLocal = localOf(e.startDate, zone); item.endLocal = e.endDate ? localOf(e.endDate, zone) : null
    if (e.endDate && Date.parse(e.endDate) < Date.parse(e.startDate)) item.problems.push('end before start')
  }
  item.place = place; item.attendanceMode = e.attendanceMode ?? 'inPerson'
  item.cancelled = e.eventStatus === 'cancelled'
  item.statusKeptInSanity = ['postponed', 'soldOut'].includes(e.eventStatus) ? e.eventStatus : null
  const s = projectId && e.publicId ? seriesOf.get(`${projectId}:${e.publicId}`) : null
  if (item.problems.length) item.action = 'report-only'
  else if (!s) item.action = 'create'
  else if (s.start_local?.slice(0, 16) === item.startLocal && (s.end_local?.slice(0, 16) ?? null) === item.endLocal && s.time_zone === zone) item.action = 'skip (same)'
  // C6a: the published Sanity dates are the editorial source for one-off events
  // (every dashboard publish syncs them), so a difference means an edit that did
  // not sync (e.g. made in Studio) — repaired with the stored version.
  else { item.action = `update (Sanity differs; schedule origin ${s.origin})`; item.expectedVersion = s.version }
  item.projectId = projectId ?? null
  plan.push(item)
}

const counts = plan.reduce((m, p) => ({ ...m, [p.action]: (m[p.action] ?? 0) + 1 }), {})
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(REPO, 'docs/engineering/events-2.0/reports'); mkdirSync(outDir, { recursive: true })
const md = [
  `# Event schedules migration — ${APPLY ? 'APPLY' : 'DRY RUN'} ${stamp}`, '',
  `Events: ${plan.length} · ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}`, '',
  '| Site | Event | Draft only | Zone | Local start → end | UTC start | Place | Mode | Cancelled | Kept in Sanity | Action | Problems |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...plan.map((p) => `| ${p.project} | ${p.title ?? p.id} | ${p.draftOnly ? 'yes' : ''} | ${p.zone ?? ''} | ${p.startLocal ?? ''}${p.endLocal ? ' → ' + p.endLocal : ''} | ${p.startsAt ?? ''} | ${p.place ? (p.place.kind === 'location' ? 'location ' + p.place.key : 'venue') : ''} | ${p.attendanceMode} | ${p.cancelled ? 'yes' : ''} | ${p.statusKeptInSanity ?? ''} | ${p.action} | ${p.problems.join('; ')} |`),
].join('\n')
writeFileSync(join(outDir, `migration-${APPLY ? 'apply' : 'dry-run'}-${stamp}.md`), md + '\n')
writeFileSync(join(outDir, `migration-${APPLY ? 'apply' : 'dry-run'}-${stamp}.json`), JSON.stringify(plan, null, 2))
console.log(md)

if (!APPLY) { console.log('\nDry run — nothing written.'); process.exit(0) }

// ── APPLY (only after Tom's review, CP3) ──────────────────────────────────────
let ok = 0, failed = 0
for (const p of plan.filter((x) => x.action === 'create' || x.action.startsWith('update'))) {
  const { data, error } = await db.rpc('event_schedule_save_one_off', {
    p_project_id: p.projectId, p_event_public_id: p.publicId, p_time_zone: p.zone,
    p_start_local: p.startLocal, p_end_local: p.endLocal, p_starts_at: p.startsAt, p_ends_at: p.endsAt,
    p_place: p.place, p_attendance_mode: p.attendanceMode, p_instructors: [],
    p_expected_version: p.expectedVersion ?? null, p_actor: null, p_origin: 'migrated',
  })
  if (error) { failed++; console.error(`✗ ${p.project} ${p.title}: ${error.message}`); continue }
  const row = Array.isArray(data) ? data[0] : data
  if (p.cancelled) {
    const occ = await db.from('event_occurrences').select('version').eq('id', row.occurrence_id).eq('project_id', p.projectId).single()
    const r = occ.error ? occ : await db.rpc('event_occurrence_set_status', { p_project_id: p.projectId, p_occurrence_id: row.occurrence_id, p_status: 'cancelled', p_expected_version: occ.data.version })
    if (r.error) console.error(`  ! cancel status failed for ${p.title}: ${r.error.message}`)
  }
  ok++; console.log(`✓ ${p.project} ${p.title}`)
}
console.log(`\nApplied: ${ok} ok, ${failed} failed.`)
process.exit(failed ? 1 : 0)
