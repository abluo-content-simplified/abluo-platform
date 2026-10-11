# ADR-031 V1 · step 2 — event fields, venues, time zone, publicId, Event JSON-LD

**Status:** built on `dev` 2026-10-11, not released. Authority: ADR-031 (D3, D6, D7).
Decisions taken with Tom: saved venues are a reusable list (not typed per event); the new fields are
editable in Studio **and** the client Agenda.

## What changed
| Area | Change |
|---|---|
| `event` schema | `publicId` (UUID, read-only), `visibility` (public · websiteOnly · unlisted), `eventStatus` (scheduled · cancelled · postponed · soldOut), `attendanceMode` (inPerson · online · mixed), `place` (`kind` location → `locationKey` validated against Website Settings → Locations, or venue → reference to `eventVenue`). All additive; absent = the old behaviour. Free-text `location` kept as fallback. |
| `eventVenue` (new, Events module) | Project-scoped saved venue: name (localized), address, Maps link, pin, optional time zone, `publicId`. Studio: Content → **Venues** (sibling of Events). Template `eventVenueProjectOwned`. |
| `siteConfig.timeZone` | Website Settings → Languages → **Time zone** (IANA). Event dates are shown in venue zone → website zone → server zone (unset = unchanged). |
| Website | Unlisted events: out of every automatic list, the sitemap and related events; `robots noindex`. Event page: status badge, place line with map link + address, dates in the right zone, **schema.org `Event` JSON-LD** (`src/lib/modules/events/structured.ts`). Cards: cancelled/postponed/sold-out badge. |
| Client Agenda | Chips for how people attend, place (site locations + saved venues + "somewhere else"), status, visibility. Server allowlist + validation in `src/lib/api/event-drafts.ts` (a place must be this site's location or this project's venue). New events get `publicId` + defaults. en/it/de copy. |
| Script | `scripts/backfill-public-ids.mjs` — dry run by default; `--apply` sets `publicId` (setIfMissing) on existing events/venues, same id for draft + published. Dry run 2026-10-11: 7 events (4 livener, 3 cyce). |

## Gates (this session)
- `tsc --noEmit` ✅
- `vitest run` ✅ except **2 pre-existing failures** in `src/lib/tenancy/__tests__/step6-routing-flip.test.ts` (Noemi's host is in the generated route table but not in the test's expected list — unrelated to this change; needs its own fix).
- New tests: `src/lib/modules/__tests__/event-structured.test.ts` (19), `event-drafts.test.ts` (+3), `navigation.test.ts` (Venues sibling).
- `npm run build` ✅ (Tom, 2026-10-11 — compiled, TypeScript and 96 static pages OK).
- `npm run verify:dashboard` + visual review (verification.md §3) — **NOT RUN**; needs the Agenda screen checked phone/desktop × light/dark.

## After deploy (in this order)
1. Website Settings → Languages → **Time zone** for each site (livener `Europe/London`, cyce `Europe/Brussels`, Italian sites `Europe/Rome` — confirm).
2. `node scripts/backfill-public-ids.mjs` (dry run) → `--apply`.
3. Spot-check an event page source for the `Event` JSON-LD; Google Rich Results Test.

## Known, not in scope
- The event page renders the stream `<iframe>` directly, not through `ConsentEmbed` (ADR-021). Pre-existing; separate fix.
- Card "Live / Upcoming / Past" badges are hardcoded English. Pre-existing.
- Booking mode (`via TableRes`) is deliberately not added yet — it appears with Connections (V1 step 4+).
