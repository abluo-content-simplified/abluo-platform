
## Handoff E — People page renamed to Users (2026-11-03)

**Done.** The old ADR-028 "People" page (who can log in, invitations) is now **Users**: route `/{project}/users`, nav id/segment `users`, group `project` (order: Users · Connected Apps · Settings · Billing), labels Users / Utenti / Benutzer. `/people` is free for the People module (agent B). `'people'` kept in `src/lib/proxy/client-surface.ts` and `reserved-slugs.ts`; `'users'` added to both. There is NO `people` nav entry or route now; agent B adds it.

Moved (mv): route folder `src/app/[locale]/(client)/[tenant]/people` -> `users`; `src/components/client/people` -> `users` (PeopleBrowser/Sheets/Table/PhoneList -> Users*, `people-bits` -> `users-bits`, `PEOPLE_ICONS` -> `USERS_ICONS`); `src/lib/people` -> `src/lib/users` (service, ownership, access-log + tests; function names such as `listProjectPeople`, type `Person` unchanged); `src/lib/client/people-filter.ts` (+ test) -> `users-filter` (`applyUsersFilters` etc.); `src/lib/api/dashboard/people.ts` -> `users.ts` (`getUsersDashboard`, `getUsersAttention`). All imports updated (admin owner actions/project page, account page, ProfilePanel, admin users components, billing, support-tickets, viewer-account, filters, route-auth-matrix test).
Changed: `surfaces.ts` (people nav removed, `users` added), `client-navigation.ts` (`PEOPLE_SEGMENT` -> `USERS_SEGMENT`), `ClientSidebar.tsx` (icon `users`; `people` icon key kept for B), Home page link `link('users')`, `list-screens.test.ts` KIND path. Tests updated: client-navigation, order, surfaces, setup-checklist, attention.
**messages/*.json (edited, as the brief allowed for moved keys):** `clientDashboard.people` renamed to `clientDashboard.users` (same position), title Users/Utenti/Benutzer, search placeholder label, Home attention actions "See users"; added `clientDashboard.nav.users`. `clientDashboard.nav.people` ("People") left in place for the People module. `interface-translation-status.json`: keys renamed, hashes refreshed for changed English. `admin.users.tiles.people` untouched (admin).
**Agent B:** use namespace `clientDashboard.persons` (the `people` namespace no longer exists); `nav.people` already present in all 3 bundles.

Tests: `npx tsc --noEmit` clean (apart from stale `.next/types/validator.ts` still pointing at the old route; regenerates on build). vitest: modules, client, lab, i18n, lib/users, lib/api, lib/billing, app, components/client, tenancy, taxonomy all green. Two cold-import 5 s timeouts (owner-actions, billing client-actions "anonymous") pass with `--testTimeout=60000` (sandbox slowness). `npm run lab:usage` regenerated `usage.generated.json` (also picks up Catalogue V2 churn); handmade baseline had no people paths.
Sandbox notes: `node_modules` only had darwin binaries, so I extracted `@rollup/rollup-linux-arm64-gnu` and `@esbuild/linux-arm64` into `node_modules` (untracked) to run vitest here. A scratch file `.tmp_i18n.py` at the repo root could not be deleted (EPERM): please `rm` it.
Open: no redirect from old `/people` URL (by design, internal URL); docs outside code (CLAUDE.md list-screen "People" Records example) still say People, now equally true of the new module.

## Handoff A — People module foundation (2026-11-03)

**Done, not committed.** API for B/C/D/F is in CONTRACTS.md §6.

Created:
- `src/lib/modules/people/` — `model.ts` (constants, permission ids, display-name / initials helpers), `schema.ts` (`person` readOnly in Studio, `personContact`, `personQualification`, `personBioText`), `fields.ts` (`peopleRefsField`), `projection.ts` (`PERSON_PUBLIC_FIELDS`, `PersonPublic`, visibility conditions, `personRefsProjection`), `queries.ts` (placement fragments + stand-alone website queries, routable pattern, sitemap), `__tests__/` (people-module, people-queries [groq-js fixtures], projection [whitelist scanner]).
- `src/lib/api/persons.ts`, `persons-lifecycle.ts`, `persons-private.ts`, `persons-guard.ts` + `src/lib/api/__tests__/persons.test.ts`, `persons-guard.test.ts`.
- `supabase/migrations/063_person_private.sql` (NOT APPLIED; CHECK block at the end proves anon/authenticated have no access).
- `src/lib/sanity/migrations/009-install-people-module.ts` (NOT RUN; dry-run default; `--projects=cyce`).
- Message fragments `docs/engineering/people-module/messages/a.{en,it,de}.json` (`clientDashboard.discover.modules.people`, `clientDashboard.persons.errors.*`).

Changed (targeted edits): `src/lib/modules/registry.ts` (People manifest after Documents, `peopleSchemaTypes` import; `integratesWith` + `people` on blog and events), `src/lib/modules/order.ts` (`people` closes Show) + `__tests__/order.test.ts`, `src/lib/modules/discover.ts` (icon), `src/lib/modules/__tests__/permissions.test.ts` (42 → 48), `src/lib/client/surfaces.ts` (taxonomy entry gains `people` / `people.taxonomy.write` / `people.person.read`; `people: 'notYetBuilt'` in `MODULES_WITHOUT_TENANT_SURFACE` — **B removes that line when adding the nav entry**), `src/lib/sanity/schema.ts` (teamSection `people` + `groupFilter`), `src/lib/modules/blog/schema.ts` (`authors`), `src/lib/modules/events/schema.ts` (`hostPeople`), `src/lib/sanity/types.ts` (TeamSection / Post / Event fields), `src/lib/sanity/queries.ts` (fragments spliced into PAGE_SECTIONS_PROJECTION, homePageQuery, 5 post projections, EVENT_ENGAGEMENT_FIELDS), `src/lib/lifecycle/__tests__/public-delivery-coverage.test.ts` (OTHER_READERS + persons-lifecycle.ts).

Tests: `npx tsc --noEmit` clean except stale `.next/types/validator.ts` (E's route move). eslint clean on new files. vitest: people (3 files), api persons (2 files) all green; neighbours modules, taxonomy, lifecycle, sanity, faq, api, client, access, i18n, seo, components, app, rest of src/lib — green except (a) `root-document-lang.test.tsx` (lightningcss native binary missing in the sandbox — environment), (b) `reserved-slugs.test.ts` + `proxy/client-surface.test.ts` (3 tests, files in agent E's rename, not touched by A), (c) `private-dataset-readiness` passes with `--testTimeout=120000` (slow FUSE walk).

Deviations from the contracts / decisions taken:
1. **`person` is NOT a lifecycle public type** (`LIFECYCLE_PUBLIC_RULES` unchanged): that rule means "archived ⇒ not public", but D4 keeps archived people on content that names them. Visibility is `PERSON_RENDERABLE` / `PERSON_LISTABLE` / `PERSON_HAS_PAGE`, enforced by the projection test instead. The lifecycle *service* is still used for archive/restore/delete (descriptor built per call so delete also checks Supabase schedules); restore removes the `expiresAt` the service writes (FAQ pattern).
2. **Hand-picked team sections use the listing rule** (archived left out), since D4 says archived people leave team listings; authors/hosts/publicId reads keep archived people.
3. **Weak references** in `peopleRefsField` (draft people attachable; deletion checked by the service, not by Sanity's strong-ref refusal).
4. **Contact move order is "add, then remove"** (both directions) instead of strictly "Sanity first": public→private writes Supabase first, then removes from Sanity (published + draft, at once — privacy first); a failure in step 2 undoes step 1. Never loses a contact.
5. **Anonymise is audited as `deleted`** with `detail.anonymised = true` (content_audit_log's action CHECK has no "anonymised"). Names are stored as empty strings, visibility `off`, `anonymisedAt` set; draft deleted; private row removed; `publicId`/`_id`/`sortOrder` kept.
6. Archive permission: the descriptor's `write` is `people.person.archive` (owner) — the generic service checks "write" for archive/restore. Editors cannot archive.
7. `publicIdField` from events was not reused (group `meta`, initialValue); `person.publicId` is set by `createPerson` (and on publish if ever missing).
8. Groups use plain string arrays in Studio (the existing `CategorySelectInput` reads the legacy config list, not taxonomyTerm records; Studio is read-only anyway).
9. People placed in module group **Show** (after Documents) — the dashboard nav group (`library`) is B's `moduleNav(…, 'library')` argument; `MODULE_GROUPS` has no Library group. This also puts People in "More You Can Add" (copy in fragment; `nav.people` already exists).
10. Module installation is per project (migration 009 with `--projects=`): nothing that renders today depends on it.

Open issues / for others:
- **B**: remove `people: 'notYetBuilt'` from `MODULES_WITHOUT_TENANT_SURFACE`; Categories & Tags shows the People tab labelled `nav.people` ("People") and its section heading says "Categories" — a "Groups" wording for kind `category` of module `people` is a TaxonomyManager/i18n change (not done).
- **C**: installation gate for rendering refs; profile route reads `profileSegment` from module config (no segment validator/reserved-word check yet — consider adding one like `catalogue.publicSegment`); sitemap/JSON-LD/obfuscation.
- **D**: guard takes publicIds; post/event refs carry Sanity `_id`s.
- **F**: write `legacyAnchors` from `teamMemberObject.anchorId`; create people with `publicId` (UUID v4) and `projectSlug`.
- **Tom**: review & apply `063_person_private.sql` on the Sandbox, then production, run its CHECK block, record in `supabase/APPLIED.md`; run migration 009 per project when People goes live there.

## Handoff F — Data-migration scripts (2026-11-03)

**Done, not committed. Nothing was applied; no Sanity/Supabase write of any kind was made (reads only, read token).**

Files: `scripts/people/propose-people.mjs`, `scripts/people/apply-people.mjs`, `scripts/lib/people-migration.mjs` (pure planner), `scripts/lib/people-io.mjs` (client + report folder), `scripts/__tests__/people-migration.test.ts` (22 tests, green), reports in `docs/engineering/people-module/reports/` (`people-proposal-cyce.{json,md}`, `people-proposal-studiomartegani.{json,md}`).

### How to run
1. Propose (read-only, `SANITY_API_READ_TOKEN`): `node --env-file=.env.local scripts/people/propose-people.mjs --projects=cyce,studiomartegani`. Reports go to `~/Abluo/clients/<tenant>[/<project>]/` if that folder exists (also tries `$ABLUO_WORKSPACE`, `~/mnt/Abluo`), else `docs/engineering/people-module/reports/` (today: the latter — `Abluo/clients/` does not exist on this machine). `--out-dir=` overrides.
2. Tom reviews the `.md`, then edits the `.json`: `"decision": "skip"` drops a proposal; `"decision": "create"` confirms a `review` one; `"mergeInto": "<key>"` folds a duplicate into another (its placements follow); fix `person.firstName/lastName/jobTitle/…` freely (ids derive from the original name, so edits never change ids).
3. Install the module first (agent A's migration 009), deploy the readers, then: `node --env-file=.env.local scripts/people/apply-people.mjs --projects=cyce --report=<json>` (dry run, default), and with `--reader-deployed --confirm` to write (uses `SANITY_API_WRITE_TOKEN`).

### What gets read / proposed
teamSection members (page + legacy homePage, published and drafts; found by walking the document, so nested sections count), `postAuthor` (+ the posts using it), `event.hosts[]`. Names: trim, case-fold, honorific stripped (Dott./Dott.ssa/Dr./Prof./Avv./Ing./Sig./Mr/Mrs/Herr/Frau…) into `honorific` per language (it/en/de/fr/es); the source's own `honorific` field wins. Accents kept in stored names; matching is case-fold exact. Surname particles (Van, Di, De…) stay with the surname. Same exact name across sources = one proposal; near-duplicates (accent-only, word order, same surname + first initial, one-word vs full name, shared/linked anchor) are `checks`, never merged. Photo: the existing `mediaAsset` holding the same image asset is linked; otherwise flagged "needs Media Library asset" (fix with `scripts/backfill-media-assets.mjs`, re-propose). `anchorId` → `legacyAnchors`. Groups are never invented (empty).

### Apply guarantees
Dry run unless `--confirm`. `--confirm` refuses unless the People module is installed on the project (009), `--reader-deployed` is passed (**your explicit assertion that the ADR-043 readers are live in production** — there is no automatic deploy sentinel; the 2026-08-14 rule), report project/dataset match, client bound to the report's dataset. Creates `person` with `createIfNotExists`, **deterministic `_id` `person-<project>-<sha1(project|normalised name)[:12]>` and deterministic UUID-shaped `publicId`** (no `migratedFrom` field exists, so this is the idempotence marker; re-running creates nothing twice and never overwrites later edits). Published directly (readers dereference published docs), `visibility: listed`, no slug, `sortOrder` = report order (omitted when the project already has people). Placements are additive and weak-ref (`teamSection.people` in member order, `post.authors`, `event.hostPeople`), set only when the target is still empty and **every** member/host of that section/event resolves to a person (otherwise the inline fallback stays); `members` / `author` / `hosts` are never touched; each patch has `ifRevisionID`; published and draft versions are patched separately.

### Reports (production dataset, 2026-11-03)
- **CYCE** (project exists, `cyce`; People not installed): 16 proposals from 15 team members (one section, `cyce-page-teachers`) + 4 event host entries (3 events); 0 duplicate checks; 3 persons appear as both teacher and host (Anne-Marie Raison, Elena Constantinides, Thierry Van Brabant → grouped); 1 person is host-only (Henri-Denis Golenvaux, no photo/bio). **Tom must decide:** `Emmanuelle` and `Dorota` are single-word names — supply surnames (or `skip`), otherwise the teachers section is NOT re-pointed (all-or-nothing, so it keeps showing inline members). Palle Dyrvall's photo is the shared `cyce-media-teacher-placeholder` asset. Dry-run plan: 14 persons, 3 event patches, teachers section waits for the two surnames.
- **Studio Martegani** (`studiomartegani`): 8 proposals from 8 team members (one section on the home page); the single `postAuthor` "Paolo Martegani" is grouped with the team member of the same name (no post uses it yet); 0 duplicate checks; no events/hosts. **Tom to confirm** the jobTitle for Paolo: team "Odontoiatra · Chirurgia e Protesi" is used, the author record says "Il Dottore"/"The Doctor". Dott./Dott.ssa honorifics come from the members' own field (Diana Zanoni Martins and Marta D'Amico have none). Dry-run plan: 8 persons, 1 section patch. All photos link existing media assets.

### Open issues
- Reports contain candidate personal data (bios): they sit in the repo's `reports/` folder; move to the client folder once `~/Abluo/clients/<tenant>` exists. Do not commit if undesired.
- Hosts without a matching team member become new persons (e.g. Golenvaux); `postAuthor` entries that are teams (name contains Team/Studio…) are flagged `review`.
- Only top-level fields of nested `sections` are re-pointed (path from `_key`s works for nested ones too); other document types holding a `teamSection` are found but patched only if listed in the report.
- Scheduling `instructor_public_ids` (Supabase) are not migrated here (agent D's area; the generated `publicId`s are in the report).
- A scratch file `scripts/people_probe_tmp.mjs` (empty) could not be deleted (EPERM): please `rm` it.

## Handoff C — People on the public website (2026-11-03)

**Done, not committed.** No `messages/*.json` fragment is needed: website strings follow the existing website pattern (TS locale dictionaries, 7 languages), not the interface bundles.

Created:
- `src/components/people/` — `PersonAvatar` (photo + Media Library focal point, else initials on a tint of `--color-primary`), `PersonCard` (+ `memberToCardData` / `personToCardData`: inline members and persons share ONE card markup), `PeopleGrid`, `PersonByline` (first = main author, "and" via `Intl.ListFormat`; `variant="post"` avatar header, `"inline"` sentence for hosts), `PersonContacts` + `contacts.ts` + client `ObfuscatedEmail` (address reversed+base64 in the HTML, mailto assembled in the browser; WhatsApp `https://wa.me/<digits>`, `tel:`, outbound links `rel="noopener noreferrer"`, malformed values dropped), `PersonProfile` (article rich-text renderer for the bio), `PersonJsonLd` (`buildPersonSchema`, no e-mail/phone), `PersonRoute` (route body + `personRouteMetadata`, SlugMapProvider, hreflang only where slug AND segment exist).
- `src/lib/modules/people/website.ts` (pure: module gating, per-language `profileSegment` read from module config with validation, `teamSource` / `namedPeople` fallback rule, `personHref`, `planPeopleRoute`, `resolvePersonRoute`, `archivedTarget`, group-label helpers, 2 small queries), `route.ts` (`loadPersonRoute`: the three `fetchForTenant` call sites, kept literal for `fetch-for-tenant-call-sites.test`).
- `src/lib/i18n/people-messages.ts` (en/it/de/fr/es/pt/nl).
- `src/lib/seo/sitemap-people.ts` (`peopleSitemapEntries`).
- Tests: `src/components/people/__tests__/people-components.test.tsx`, `src/components/sections/__tests__/team-section-people-ssr.test.tsx`, `src/lib/modules/people/__tests__/website.test.ts`, `src/lib/seo/__tests__/sitemap-people.test.ts`; `website.ts` and `route.ts` added to `MODULES` in `projection.test.ts`.

Changed (targeted): `TeamSection.tsx` (cards via PeopleGrid; props `enabledModuleIds`, `moduleConfig`, `tenantSlug`, `hostScoped`), `SectionRenderer.tsx` (passes them), `PostArticle.tsx` (optional prop `people={{ segment }}`; absent = legacy author), `blog/[slug]/page.tsx` + `preview/post/[id]/page.tsx`, `events/[slug]/page.tsx` (now also reads module config; `PersonByline` from `hostPeople`), `JsonLd.tsx` (`ArticleSchemaInput.authors` → Person with profile `url`; replaces `authorName`), `[...slug]/page.tsx` (People dispatch after the catalogue, in metadata and page), `src/app/sitemap.ts` (project query gains `peopleSegment`; one `SITEMAP_PEOPLE_QUERY` read per project that set a segment).

Behaviour:
- Fallback (CONTRACTS 6.3): `peopleCount > 0` ⇒ hand-picked (never inline, even if none is listable); else `groupFilter` ⇒ `groupPeople` (an empty group renders nothing, not the inline members); else inline `members`. Same for `authorCount`→`author`, `hostPeopleCount`→`hosts`. People module not installed ⇒ legacy fields everywhere; unresolved module list fails open (like sections).
- Profile route = catch-all dispatch like the Catalogue: `/{profileSegment[locale]}/{slug}` (exactly two segments). Found ⇒ profile; retired slug ⇒ 308 to the current; archived ⇒ 308 to `/{segment}` if a page exists at that slug, else the site root; no match ⇒ falls through to the page lookup (a real page at the same path still works). Catalogue wins if both claim a segment (evaluated first).
- Segment validation is in the route (no config-surface validator): one lowercase url-safe segment, not in `RESERVED_SLUGS` (so `people`, `users`, `blog`, `news`, `events`, `catalogue`… are ignored => no links, no dispatch, no sitemap rows).
- Legacy anchors: `legacyAnchors` become element ids on the card (first as the card id, the rest as empty targets), so `/teachers#florian-parra` lands. `PERSON_BY_LEGACY_ANCHOR_QUERY` is unused (a URL fragment never reaches the server).

Tests: `npx tsc --noEmit` clean for my files (remaining errors are agent B's in-progress `components/client/persons`). vitest green: people (7 files, 125), `src/components/sections`, `src/components/__tests__`, `src/lib/seo`, `src/lib/lifecycle`, `src/lib/modules/__tests__`, `src/lib/sanity/__tests__` (incl. fetch-for-tenant call sites, public-delivery coverage, sitemap). Not mine: `root-document-lang` (lightningcss binary), `reserved-slugs.test` ("users" duplicated by agent E), `message-keys` (B's strings not merged yet). Under heavy parallel load some whole files report FAIL by timeout; they pass alone.

Deviations / open:
1. Dictionaries in TS instead of fragments (above). Group labels on the profile come from a tiny `taxonomyTerm` query (people/category); cards show the job title only.
2. Event cards (`EventHostsLine` in `EventEngagement` / `EventCard`) still read legacy `hosts` only; only the event detail page shows `hostPeople`. Follow-up if wanted.
3. No "people index" page exists: the archived redirect target is the page at the segment slug if one exists, else the site root.
4. No `profileSegment` validator in the module config UI (localizedString has no validator hook; the manifest field has none). Add one like `catalogue.publicSegment` (clash with page first segments, catalogue segment) in B/E's config work.
5. The Person page is not behind the access gate/`noindex` options of pages; hasPage = visibility `page` + listable only.
6. Draft preview of a person is not built.

## Handoff B — People in the client dashboard (2026-11-03)

**Done, not committed.** Strings: `messages/b.{en,it,de}.json` (informal Italian/German; 276 keys: `clientDashboard.persons.*`, `app.ui.personPicker.*`). Merge them with A's fragments. (`messages/_gen_b.py` is the generator I used; it could not be deleted (EPERM), please `rm` it.)

Created:
- Route `src/app/[locale]/(client)/[tenant]/people/`: `page.tsx` (list), `[id]/page.tsx` (editor), `actions.ts`, `error.tsx`, `loading.tsx`.
- `src/components/client/persons/`: `PeopleBrowser` (Content kind: ListToolbar + DataTable + ContentCard grid + ViewSwitch, list first, `useViewPreference`), `PeopleFilters`, `PeopleTable`, `PeopleCards`, `NewPersonDialog`, `PersonAnonymiseDialog`, `PersonUsedInLoader`, `person-bits`, `person-actions`, `PersonEditor` (autosave shell), `PersonEditorTabs` (Profile / About / Contact / On the website), `person-editor-types`.
- `src/components/app/ui/PersonPicker.tsx` + Lab entry `person-picker` + `src/lab/demos/person-picker.demo.tsx` (fake data, no backend).
- `src/lib/client/persons-filter.ts`, `src/lib/client/person-editor.ts`, `src/lib/api/person-ai.ts` (AI Shorten, needs AI_FEATURES `improve`), `src/lib/api/persons-groups.ts`; tests next to each.

Changed (targeted): `surfaces.ts` (People nav entry in the library group, `notYetBuilt` removed), `ClientSidebar.tsx` (icon), `surfaces.test.ts`, `client-navigation.test.ts`, `order.test.ts`, `src/lab/registry.ts` (+person-picker), `src/lab/__tests__/list-screens.test.ts` (KIND for `PeopleBrowser`).

### PersonPicker (for D)
`import { PersonPicker, type PersonPickerPerson } from '@/components/app/ui/PersonPicker'`
- `PersonPickerPerson`: `{ id, name, photoUrl?, jobTitle?, groups?, archived? }`
- Props: `label`, `mode?: 'multiple'|'single'`, `value: PersonPickerPerson[]` (ordered; the caller holds the objects), `onChange(next)`, `search(query) => Promise<PersonPickerPerson[]>` (injected; reject = "couldn't load" + retry), `onCreate?({firstName,lastName}) => Promise<PersonPickerPerson>` (injected; omit = no "Add new person"), `primaryLabel?` (marks the first as main), `max?`, `groupLabel?`, `disabled?`, `disabledReason?`.
- The picker reaches no backend. Server side, wire `search` to `searchPersonsAction` and `onCreate` to `createPersonAction` in `people/actions.ts`.

### Tests
- `tsc --noEmit`: clean except `scripts/__tests__/people-migration.test.ts` (F).
- `src/lab/__tests__` (handmade, list-screens, lab-guards): 157 pass, handmade baseline not grown. `npm run lab:usage` runs.
- `src/lib/client`, `src/lib/modules`, `src/lib/api/__tests__/person*`, `src/lib/i18n`, `src/i18n`: 3122 pass, 1 fails: `message-keys.test` reports my keys missing until the b.* fragments are merged into `messages/*.json`.

### Deviations / open
1. Translate not built: `/api/translate` needs an Abluo admin, no client-dashboard helper exists.
2. "Groups" label: TaxonomyManager has no per-module labels, so the People taxonomy still reads "Categories" there. Groups label is used inside People only.
3. Drag-reorder done with the shared DragGrip in the list view and the phone list; shown only when sorted by "Your order" with no filters. Cards view has no drag.
4. AI Shorten done (`shortenPersonBioAction`); hidden/disabled with a reason when AI is off.
5. Activity sheet (`getPersonActivity`) not surfaced.
6. Private contacts/birthday/notes depend on migration 063; without it the Contact tab shows a notice and public contacts still work.
7. Half-typed contacts and empty names stay local and are not sent to the server.

## Handoff D — People in the post and event editors, ownership enforced (2026-11-03)

**Done, not committed.** Strings: `messages/d.{en,it,de}.json` (`clientDashboard.create.authors.*`, `clientDashboard.create.stepNames.authors`, `clientDashboard.events.editor.hosts.*`; informal it/de). Until merged, `src/lib/i18n/__tests__/message-keys.test.ts` fails ONLY for those 13 keys.

Created: `src/lib/api/persons-guard.ts` additions `personRefs()` (rebuilds weak refs + ownership check; ONE raw read; new ids must be a non-archived, non-anonymised person of the grant's project, published or draft-only; ids already stored stay with their `_key`, so reordering never fails) and `personRefIds()`; `src/components/client/persons/PersonPickerField.tsx` (PersonPicker wired to `searchPersonsAction` / `createPersonAction`); `src/components/client/create/steps/AuthorsStep.tsx`; `src/lib/scheduling/guarded.server.ts` (`guardInstructors`, `guardInstructorOverride`, `saveOneOffGuarded`); tests `src/lib/api/__tests__/people-placements.test.ts` (18), `src/lib/scheduling/__tests__/guarded.test.ts` (5), `src/components/events/__tests__/event-card-hosts.test.tsx` (4), +3 in `src/lib/client/__tests__/wizard-steps.test.ts`.

Changed (targeted): `post-drafts.ts` (`authors` patch path: People module + `people.person.read` checked before any read; max 10; weak refs; `[]`/null unsets; `WIZARD_STEPS` + `authors`; snapshot `authors: string[]`), `wizard-steps.ts` (step `authors` after `faq`, only with `site.people`; overview section optional/done), `create/{types,snapshot}.ts`, `WizardShell.tsx`, `ReviewStep.tsx`, `posts/write/[id]/page.tsx` (resolves names of current authors, `site.people = { initial, canCreate }` only with People installed + read), `event-drafts.ts` (`hostPeople` patch path, same checks, max 50; snapshot `hostPeople` + read-only `legacyHosts`), `events/capabilities.ts` (`hostPeople` follows `hosts`), `EventEditor.tsx` + `agenda/[id]/page.tsx` (Hosts section: PersonPicker; legacy inline hosts shown as an info notice, never deleted or patched), `EventEngagement.tsx` (`EventCardExtras` prefers `hostPeople` via `PersonByline` when `hostPeopleCount > 0`, new prop `peopleOn` default true), `post-drafts.test.ts` (snapshot has `authors`).

Behaviour: no authors/hosts = publishes as before (publish copies the draft; refs are weak). Hosts field needs Events `hosts` capability AND People module AND `people.person.read`; "Add new person" needs `people.person.write`. Foreign/unknown/duplicate/over-limit ids → opaque `invalid_value`, before any write.

Scheduling (task 3): the ONLY writer is `store.saveOneOff` (series instructors) and it has no caller yet; there is no instructors UI, no occurrence-override writer and no `events.instructor.*` permission id anywhere in code (only ADR-038 prose, already marked amended). So only the server guard was added: **the event/scheduling API must call `saveOneOffGuarded(grant.projectSlug, input)` (or `guardInstructors` / `guardInstructorOverride` before its own write) — never `store.saveOneOff` directly.** Override semantics preserved: `null` = same as course, `[]` = nobody, neither needs a check. Errors map to `ScheduleError('invalid' | 'unavailable')`.

Tests: `npx tsc --noEmit` clean (only agent F's `scripts/__tests__/people-migration.test.ts` and stale `.next`). vitest green: `src/lib/api` (41 files), `src/lib/client`, `src/components/client`, `src/components/people`, `src/lib/scheduling`, `src/components/events`, `src/lab/__tests__` (157; handmade baseline not grown), `src/lib/modules`, `src/app`; `npm run lab:usage` ran. Note: `/sessions` disk was at 100% during the run (one full-tree run hit ENOSPC); suites were re-run in batches.

Deviations / open:
1. Authors is a wizard step (like Gallery/FAQ), not a field on the story step; `WIZARD_STEPS` gains `authors` (a stored `authors` step resumes at the next step where People is off).
2. Event cards cannot know whether People is installed (listings do not resolve modules): `peopleOn` defaults to true; data only exists once someone attached people.
3. Hosts capability on but People not installed: the editor shows only the legacy-hosts notice (and they no longer count as "Studio-only" content).
4. Preview/publish steps do not list authors; the live post reads `authors` (agent C). Draft-only people attached to a post are weak refs and render nothing until published.
5. `person.publicId` ↔ ref: post/event refs carry the Sanity `_id`, the guard for schedules takes publicIds (as specified).

## Handoff H — Profile-address validator and profile draft preview (2026-11-03)

**Done, not committed.** No `messages/*.json` fragment: the validator is Studio/admin UI text (English, like the Catalogue's), preview has no UI of its own.

### 1. `profileSegment` validator
- `src/lib/modules/config-validators.ts` (targeted): new named validator `people.profileSegment` (runs per language on the localizedString), new data source `catalogueSegment` (project's enabled catalogue `publicSegment`, scoped by `projectSlug`), new `pageFirstSegmentsByLocale`, exported `profileSegmentError`. Rules per language, with messages naming language and word: one lowercase url-safe segment (`validateSegment`, max 64), not reserved (`RESERVED_SLUGS` + ADR list), not the first segment of one of THAT language's pages (raw perspective, drafts included), not the Catalogue segment. An unchanged saved value is not re-litigated; the same word in two languages is fine.
- `src/lib/modules/registry.ts`: `validator: 'people.profileSegment'` on the manifest field. It runs wherever the Modules pane (`ModuleList.tsx`) validates and saves module config (live per keystroke and on save, data re-fetched at save); that is the only module-config save path (the Catalogue's own `settings/service.ts` is Catalogue-only). No `ModuleList.tsx` change was needed.
- The route's defensive check (`cleanProfileSegment`) is unchanged. Catalogue's retired segments (history) are not checked, only its current one.

### 2. Draft preview — `/{locale}/{project}/preview/person/{id}?t=<token>`
- Same model as posts/galleries: signed 15-minute token (kind `person`, new `k:'p'` in `draft-preview-token.ts`; old tokens unaffected), `authorizePersonPreview` in `src/lib/preview/authorize.ts` (id shape, token kind/person/project, host may serve the project, then the document must be a `person` of that project and not anonymised; draft first, else published; every refusal = 404, nothing read before token/URL/host agree). Route `src/app/[locale]/(website)/[tenant]/preview/person/[id]/page.tsx`: `PersonProfile` from `drafts.<id>` else `<id>` via `src/lib/modules/people/preview-query.ts` (`PERSON_PUBLIC_FIELDS`, perspective raw; visibility/archived deliberately not applied, anonymised never), `noindex, nofollow, nocache`, no-referrer, `force-dynamic`. `proxy/draft-preview.ts` regex now includes `person` (so proxy `X-Robots-Tag` / `no-store` and the layout's preview marker apply).
- Minting: `src/lib/api/person-preview.ts` `mintPersonPreview(ctx, projectId, { id, host, proto })` (needs `people.person.read` + People installed; person re-read, must belong to the grant's project) and server action `src/app/[locale]/(client)/[tenant]/people/preview-action.ts` `mintPersonPreviewAction({ projectSlug, id })` (same result shape as `mintDraftPreviewAction`).

### For the dashboard agent (wire the Preview link; I did not touch `components/client/persons/**`)
```ts
import { mintPersonPreviewAction } from '@/app/[locale]/(client)/[tenant]/people/preview-action'
import { personPreviewUrl } from '@/lib/client/preview-url'
const r = await mintPersonPreviewAction({ projectSlug, id: person.id })   // id = Sanity base id
if (r.ok) window.open(personPreviewUrl({ origin: r.origin, locale, projectSlug: r.projectSlug, id: person.id, token: r.token }), '_blank')
```
Same pattern as `PostsBrowser.preview`. `locale` = language to preview (the editor's current/default). Needs one interface string for the button and one for the failure toast (add in your fragment; posts use `previewFailed`). `r.themes` gives the site's themes if you want a Light/Dark switch (`&theme=`).

### Tests
- New/extended: `config-validators.test.ts` (valid, invalid syntax, reserved, page clash per language, catalogue clash, multi-language, unchanged saved, data loader), `authorize.test.ts` (`authorizePersonPreview`: unauthenticated, wrong kind, other person/project/host, expired, other project's doc, anonymised, read error), `draft-preview-token.test.ts`, `draft-preview-proxy.test.ts` (path), `api/__tests__/person-preview.test.ts` (mint), `people/__tests__/person-preview-route.test.tsx` (route: noindex metadata, 404 without reading, draft-then-published read).
- `npx tsc --noEmit` clean (needs `NODE_OPTIONS=--max-old-space-size=6144`). Green: `src/lib/modules/people`, `src/lib/modules/__tests__`, `src/components/people`, `src/lib/lifecycle`, `src/lib/preview`, `src/lib/proxy`, `src/lib/platform`, `src/lib/client/__tests__`, and in `src/lib/sanity/__tests__` fetch-for-tenant-call-sites, query-tenant-scope, website-tenant-scope-guard, post-preview-query, public-id-guard. Large multi-file runs (`src/app`, whole `src/lib/sanity/__tests__`, `src/lib/modules/catalogue`, `src/lib/seo`) hit `ENOSPC` on the machine (not code): run them after freeing disk; use `NODE_DISABLE_COMPILE_CACHE=1 --no-file-parallelism`.

### Open
1. Preview does not render the page chrome of the live profile route (JSON-LD, hreflang) — intentionally; language switcher map is empty.
2. Preview ignores `visibility`; a person set to "off" still previews (by design) but the live page will 404.
3. Catalogue segment history is not part of the clash check.

## Handoff G — Translate on People fields, Activity sheet, "Groups" label (2026-11-03)

**Done, not committed.** Strings: `messages/g.{en,it,de}.json` (informal it/de): `clientDashboard.taxonomy.modules.people.category.*` (the "Groups" wording) and `clientDashboard.persons.editor.menu.activity`. Merge with the other fragments. The Translate button needs NO new strings: it uses `src/lib/i18n/translate-messages.ts` (ADR-023 §9, 7 languages) with the user's interface locale.

### 1. Translate (ADR-023 allows tenant use: §1 "swapping `requireAbluoAdmin()` for `translate.use`", slice 5) — built
- `src/lib/api/person-translate.ts` `translatePersonFields(ctx, projectId, { id, fields, sourceLocale })` + `translatePersonFieldsAction` in `people/actions.ts`. Gates: `people.person.write` (People installed, owner/editor) AND `translate` in the grant's `enabledModuleIds` (else `module_disabled`); the site is the GRANT's. Then the SAME engine as `/api/translate` (`runTranslate`): provider + monthly quota from the Translate module config, keys from env only, Supabase metering (`translation_usage`, actor = caller, `sanity_document_id` = person id), quota fails closed, metering failure before the provider = refused.
- The source text is read from the SAVED person (draft ?? published), never taken from the browser (no open "translate any text" door). The editor flushes its autosave first.
- A target is translated only if empty or an untouched `machine` value (`isWritableTarget`); `original`/`reviewed` are reported as `skipped: protected`. A result longer than the field limit is `skipped: too_long`. Nothing is written by the action; it returns `{ text, meta }` per field/language.
- Storage: `savePersonDraft` accepts a new path `translation.<honorific|jobTitle|shortBio>.<loc>` (meta object or null) next to `<field>.<loc>`, written to `<field>.translationStatus.<loc>` (nested object ensured with a second `setIfMissing`). The server validates the meta shape, re-hashes against the CLEANED text (a trimmed machine value stays machine), flips machine -> `reviewed` when the text it receives differs from the hash, flips a stored machine status to `reviewed` when a plain text save edits that value, and unsets the status when the value is cleared. `PersonSnapshot.translations` exposes the stored statuses.
- UI: `PersonEditorTabs.tsx` `TranslateRow` (AssistButton, "Translate from IT" + "Machine translation" note) under Title and under Short bio, shown only when the Translate module is on (`canTranslate` from the page), the person is editable and the site has 2+ languages. A target typed into while the request was in flight is left alone.
- Not covered: `bio` (rich text) — the Portable Text translator (ADR-023 §10, slice 4) does not exist in `src/lib/translate`. Qualification titles also not wired. "Mark as reviewed" and re-translate of reviewed text (ADR slice 4) not built; editing the text marks it reviewed.
- Limit: a client can send a `machine` status for text it typed (harmless: it only makes that value overwritable by Translate, bound to its hash).

### 2. Activity sheet — built
`src/components/client/persons/PersonActivitySheet.tsx` (copy of `FaqSetActivitySheet`, there is no shared base; same `clientDashboard.activity` wording) opened from the editor's ⋯ menu ("Activity"), using the existing `getPersonActivityAction`.

### 3. "Groups" label — built
`kindKey(has, module, kind, key)` in `taxonomy-view.ts`: a module can override a section's wording with `clientDashboard.taxonomy.modules.<module>.<kind>.<key>`; otherwise the shared `<kind>.<key>`. Used by `TermSection`, `TermSheet` and the manager's search label. Only the People overrides exist, so other modules are unchanged. (TermPicker keeps "category" wording; the People editor passes its own labels.)

### Tests
- New: `src/lib/api/__tests__/person-translate.test.ts` (14), +6 in `persons.test.ts` (translationStatus), `src/components/client/persons/__tests__/person-activity-sheet.test.tsx` (2), `kindKey` in `taxonomy-view.test.ts` (+2), `people-groups-label.test.ts` (4; reads the g.* fragments until merged).
- `npx tsc --noEmit` clean (apart from stale `.next/`).
- vitest run file by file with `--maxWorkers=1`: see the report in the chat for the exact result; `module.test.ts` and `taxonomy/schema.test.ts` hit `ENOSPC` on this machine (heavy Sanity-schema import), not a failure of the code.
