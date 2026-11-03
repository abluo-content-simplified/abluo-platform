# People module — build contracts (ADR-043)

Shared brief for every agent building the People module. Authority: `docs/architecture/ADR-043-people-module.md` (decisions), `CLAUDE.md` (repo rules). Read both first. This file fixes NAMES and FILE OWNERSHIP so parallel work does not collide.

## 0. Ground rules for every agent

- **A second session is building Catalogue V2 in this same working tree, right now.** Never touch `src/lib/modules/catalogue/**`, `src/components/client/catalogue/**`, `scripts/catalogue/**`, `docs/engineering/catalogue-module/**`. In shared files (`registry.ts`, `schema.ts`, `queries.ts`, `types.ts`, `surfaces.ts`, `client-navigation.ts`, `src/lab/registry.ts`, `messages/*.json`…) make **minimal targeted edits**: re-read the file immediately before editing, replace exact strings (python read-modify-write or the Edit tool), never rewrite a whole shared file from memory, never reformat.
- **Do not commit, push, tag or run `scripts/release.sh`.** The orchestrator commits. Git reads only with `git --no-optional-locks`.
- **Do not edit `messages/*.json`.** Put every new interface string in fragments: `docs/engineering/people-module/messages/<agent-letter>.<locale>.json` (en, it, de — write real Italian and German, informal "tu"/"du" as the existing bundles do). Same nesting as the real bundles (e.g. `{"clientDashboard": {"persons": {...}}}`). The orchestrator merges them. Tests that need the strings may be run after merge; say which.
- Tests: `npx vitest run <paths>` and `npx tsc --noEmit` work in the mount. `npm run build` does NOT (unlink EPERM) — skip it; the orchestrator builds in a mirror.
- Sandbox cannot delete files (`rm` fails). Moving with `mv` works. Don't create junk files in the repo.
- English nav labels Title Case. Times 24 h. No new colours. Checkboxes square. Top-aligned card content. Dashboard UI only from Component Lab components (`src/lab/registry.ts`); rule of two.
- No user-facing hardcoded strings in website/dashboard components (locale dictionaries or Sanity).
- When done, append a short "Handoff <letter>" section to `docs/engineering/people-module/HANDOFF.md` (create if missing — append, don't overwrite): files created/changed, tests run + result, open issues.

## 1. Names (fixed)

| Thing | Name |
|---|---|
| Module id (registry, nav id, permissions prefix) | `people` |
| Sanity document type | `person` |
| Supabase table | `public.person_private` — migration `supabase/migrations/063_person_private.sql` (062 is reserved by Catalogue) |
| Permissions | `people.person.read` (owner, editor, viewer) · `people.person.write` (owner, editor) · `people.person.archive` (owner) · `people.person.anonymise` (owner) · `people.person.delete` (owner) · `people.taxonomy.write` (owner, editor) |
| Groups | the People module's taxonomy ("Groups"), managed in Categories & Tags (ADR-033 Amendment J pattern); stored on the person as stable keys `groups: string[]` |
| Field helper | `peopleRefsField({ name, title, description?, group? })` in `src/lib/modules/people/fields.ts` — ordered, unique array of references to `person`, `options.filter: scopedRef` |
| Public projection | `PERSON_PUBLIC_FIELDS` (GROQ fragment) + `PersonPublic` TS type in `src/lib/modules/people/projection.ts` |
| Ownership guard | `assertPeopleBelongToProject(projectSlug, publicIds)` in `src/lib/api/persons-guard.ts` |
| Dashboard service | `src/lib/api/persons.ts` (+ `persons-lifecycle.ts`, `persons-private.ts`) |
| Dashboard route (new module) | `src/app/[locale]/(client)/[tenant]/people/**` — only AFTER agent E has moved the old users page away |
| Dashboard components (new) | `src/components/client/persons/**` |
| Shared picker | `src/components/app/ui/PersonPicker.tsx` (Lab entry + demo) |
| Website components | `src/components/people/**` |
| Users page (old ADR-028 "People") | route `users`, nav id `users`, group `project`, label "Users"; components `src/components/client/users/**`; service stays callable (agent E may rename `src/lib/people` → `src/lib/users`) |

## 2. `person` document (Sanity, public)

`projectSlug`, `publicId` (publicIdField), `firstName`* (string), `lastName`* (string), `displayName` (string), `honorific` (localizedString), `jobTitle` (localizedString — "professional title"), `groups` (string[] taxonomy keys), `photo` (reference → `mediaAsset`, focal point from the asset), `shortBio` (localizedText), `bio` (localized restricted rich text type `personBioText`, same restrictions as `faqAnswerText`), `languages` (string[] ISO 639-1), `website` (url), `contacts` (array of `personContact` {`kind`: email|phone|whatsapp|instagram|linkedin|website|url, `value`, `label` string, `preferred` boolean} — PUBLIC ones only), `qualifications` (array of `personQualification` {`title` localizedString, `issuer` string, `issuedOn` date, `expiresOn` date}), `visibility` ('off'|'listed'|'page', default 'listed'), `slug` (localizedSlug), `redirectFrom`, `sortOrder` (number), `legacyAnchors` (string[], hidden — from migrated teamMember anchorIds), `anonymisedAt` (datetime, hidden), plus `archivedFields()` and the standard draft → publish lifecycle (like `faqSet`).

Display name rule: `displayName` if set, else `firstName lastName`; honorific prefixes it on the website.

## 3. `person_private` (Supabase, server-only)

`project_id uuid` (public.projects.id), `person_public_id uuid`, PK both; `contacts jsonb` (same shape as personContact, private ones), `birthday date null`, `notes text null`, `linked_user_id uuid null` (unused V1), `version int`, timestamps. RLS on, no grants to anon/authenticated, service role only (ADR-038 D8 pattern). Code must treat "table missing" as: private section unavailable, everything else works (migration is applied by Tom after review).

## 4. Placement fields (added additively by agent A)

| Doc/section | New field | Kept (deprecated fallback) |
|---|---|---|
| `teamSection` | `people` (peopleRefsField) + `groupFilter` (string, one taxonomy key) | `members` (inline) |
| `post` | `authors` (peopleRefsField; first = main) | `author` → postAuthor |
| `event` | `hostPeople` (peopleRefsField) | `hosts` (inline) |
| scheduling (Supabase, existing) | `instructor_public_ids` / `instructor_override` hold `person.publicId` | — |

Rendering rule (ADR-043 D4): visibility 'off' or anonymised → not rendered; archived → rendered on content that references them, excluded from team listings and group filters; own page only when visibility 'page' and not archived.

## 5. Waves and owners

| Agent | Scope | Starts |
|---|---|---|
| **A** foundation | module folder `src/lib/modules/people/` (schema, fields, projection, taxonomy declaration, manifest entry in `registry.ts`), placement fields (§4), queries for website (`src/lib/modules/people/queries.ts`), `063_person_private.sql`, services `src/lib/api/persons*.ts`, guard, tests | wave 1 |
| **E** users rename | old People page (logins & invitations) → **Users** under **Project**, route `/{project}/users`, nav id `users`, all links/tests/i18n updated. The `/people` segment is then free for the new module (internal dashboard URL, no redirect needed). Also rename `src/lib/people` → `src/lib/users` and `src/components/client/people` → `src/components/client/users`. | wave 1 |
| **B** dashboard | People list (Content kind, list ⇄ cards), editor (Profile · About · Contact · On the website), archive/anonymise/delete, reorder, `PersonPicker` shared component, nav entry (group `library`), AI Shorten + Translate | wave 2 |
| **C** website | team section with refs/groupFilter, `PersonByline` (posts/events), profile page route + 5-requirement checklist + sitemap, `Person` JSON-LD, initials avatar, email obfuscation, WhatsApp link | wave 2 |
| **F** migration | dry-run scripts `scripts/people/` proposing persons from teamMember / postAuthor / eventHost per project, duplicate report, apply step (never auto-merge); CYCE then Studio Martegani | wave 2 |
| **D** placements | post editor authors (PersonPicker), event editor hosts + series/occurrence instructors, guard wired into scheduling + post + event writes | wave 3 |

## 6. API (agent A)

Binding for B, C, D, F. Everything below exists and is tested (2026-11-03). Errors are `PersonError` (`code: PersonErrorCode`, opaque; `detail.usedIn` on `in_use`); permission failures throw `TenantAuthorizationError` before any I/O. Interface strings for every code: fragment `messages/a.<locale>.json` → `clientDashboard.persons.errors.<code>`.

### 6.1 Shared constants and helpers — `src/lib/modules/people/model.ts` (pure, browser-safe)

```ts
PEOPLE_MODULE_ID = 'people'
PERSON_CONTACT_KINDS = ['email','phone','whatsapp','instagram','linkedin','website','url'] as const; type PersonContactKind
PERSON_VISIBILITIES = ['off','listed','page'] as const; type PersonVisibility; DEFAULT_PERSON_VISIBILITY = 'listed'
PEOPLE_PERMISSIONS = { read:'people.person.read', write:'people.person.write', archive:'people.person.archive', anonymise:'people.person.anonymise', delete:'people.person.delete', taxonomy:'people.taxonomy.write' }
PEOPLE_GROUP_KIND = 'category'            // Groups = taxonomyTerm { module:'people', kind:'category' }
personDisplayName(p): string              // displayName || "first last"   (no honorific)
personFullName(p): string                 // honorific (already locale-resolved) + display name — website
personInitials(p): string                 // avatar without photo (D7)
```

### 6.2 Schema — `src/lib/modules/people/schema.ts`, `fields.ts`

- Types: `person` (document, **readOnly in Studio**), `personContact`, `personQualification`, `personBioText` (same block rules as `faqAnswerText`; sanitize with `sanitizeFaqAnswer`). Fields exactly as §2; `publicId` set at creation by the service (not by an initialValue).
- `peopleRefsField({ name, title, description?, group?, max? })` — ordered, unique array of **weak** references to `person`, `options.filter: scopedRef`. Stored items: `{ _type:'reference', _ref:<person _id>, _key, _weak:true }`. Weak on purpose: a just-created draft person can be attached, a deleted/anonymised person never invalidates a post.
- Placements (§4): `teamSection.people` + `teamSection.groupFilter` (string, a taxonomy term key), `post.authors` (max 10), `event.hostPeople` (max 50). `members`, `author`, `hosts` untouched.
- Module config: `profileSegment` (localizedString, optional) = per-language base path of profile pages; empty ⇒ no profile pages. Read it from `project.moduleInstallations[moduleId=="people" && enabled != false][0].config.profileSegment[$locale]`.

### 6.3 Website reads (agent C) — `src/lib/modules/people/projection.ts`, `queries.ts`

```ts
PERSON_PUBLIC_FIELDS            // the ONLY person projection (test-enforced)
PERSON_PUBLIC_KEYS              // its top-level keys
interface PersonPublic {
  publicId: string; firstName?; lastName?; displayName?; honorific?: string|null; jobTitle?: string|null;
  groups?: string[]|null; photo?: (ResolvedImage & { lqip?; dimensions? })|null; shortBio?: string|null;
  bio?: PortableTextContent|null  /* links carry internalTarget like article bodies */;
  languages?: string[]|null; website?: string|null; contacts?: PersonPublicContact[]|null /* PUBLIC only */;
  qualifications?: PersonPublicQualification[]|null; visibility: 'off'|'listed'|'page';
  archived: boolean; hasPage: boolean /* own page in THIS language */; slug: { current?: string|null } /* no fallback */;
  legacyAnchors?: string[]|null }
PERSON_RENDERABLE / PERSON_LISTABLE / PERSON_HAS_PAGE   // GROQ visibility conditions (D4)
PERSON_ORDER                                            // order(coalesce(sortOrder, 999999) asc, lower(lastName) asc, lower(firstName) asc)
personRefsProjection(field, 'listing' | 'named')        // (field[]->)[person of this project && rule]{ PERSON_PUBLIC_FIELDS }
```

Already spliced into `src/lib/sanity/queries.ts` (every route: `PAGE_SECTIONS_PROJECTION` → `pageHomeQuery` / `pageBySlugQuery` / module pages, legacy `homePageQuery`, all 5 post projections, `EVENT_ENGAGEMENT_FIELDS` → every event query):

| Placement | Projected keys (types.ts) | Rule |
|---|---|---|
| teamSection | `people: PersonPublic[]\|null` (hand-picked, editor order), `peopleCount` (stored refs), `groupFilter`, `groupPeople: PersonPublic[]\|null` (only when nothing is hand-picked) | listing: off/anonymised/archived out |
| post | `authors: PersonPublic[]\|null` (first = main), `authorCount` | named: archived **kept**, off/anonymised out |
| event | `hostPeople: PersonPublic[]\|null`, `hostPeopleCount` | named |

Fallback rule for C (mirrors `faqSetCount`): `peopleCount > 0` ⇒ never render inline `members`; `!peopleCount && groupFilter` ⇒ `groupPeople`; else `members`. Same for `authorCount`→`author`, `hostPeopleCount`→`hosts`. The People module installation gate is C's decision (the data is projected regardless).

Stand-alone queries (params `$projectSlug $locale $defaultLocale` + listed): `PEOPLE_BY_PUBLIC_IDS_QUERY` (`$publicIds`; schedule instructors; named rule), `PEOPLE_BY_GROUP_QUERY` (`$group`), `PEOPLE_LISTING_QUERY`, `PERSON_BY_SLUG_QUERY` (`$slug`; returns `slugMap` + public fields; own page only), `PERSON_BY_OLD_SLUG_QUERY` (`$slug` → `{ currentSlug }`), `PERSON_SLUG_ARCHIVED_QUERY` (`$slug` → boolean; 308 to the people page), `PERSON_BY_LEGACY_ANCHOR_QUERY` (`$anchor` → `{ currentSlug }`), `SITEMAP_PEOPLE_QUERY` (`{ slugMap, _updatedAt }[]`). Fragments: `TEAM_SECTION_PEOPLE_FIELDS`, `POST_AUTHORS_FIELDS`, `EVENT_HOST_PEOPLE_FIELDS`. A new person query must use these or `PERSON_PUBLIC_FIELDS` + a rule, or `src/lib/modules/people/__tests__/projection.test.ts` fails (add new query modules to its `MODULES`).

### 6.4 Dashboard service (agent B) — `src/lib/api/persons.ts`

All take `(ctx: TenantAuthorizationContext, projectId: string, input, deps?: PersonDeps)`; `deps` is for tests. Sanity ids are base ids (never `drafts.`).

```ts
listPersons(ctx, projectId): Promise<{ persons: PersonListItem[]; site: PersonSite }>                       // read; site order
getPersonForEdit(ctx, projectId, id: string): Promise<PersonSnapshot>                                     // read; draft ?? published + private
createPerson(ctx, projectId, { firstName, lastName }): Promise<{ id; publicId; rev }>                    // write; draft only
openPersonForEdit(ctx, projectId, { id }): Promise<{ id; rev; created }>                                  // write; makes drafts.<id>
savePersonDraft(ctx, projectId, { id, rev, set }): Promise<{ rev }>                                       // write; autosave
publishPersonDraft(ctx, projectId, { id, rev }): Promise<{ rev }>                                         // write
discardPersonDraft(ctx, projectId, { id, rev }): Promise<void>                                            // write
savePersonPrivate(ctx, projectId, { id, version: number|null, birthday?, notes?, contacts? }): Promise<{ version }>   // write; Supabase
movePersonContact(ctx, projectId, { id, rev, key, to: 'public'|'private', privateVersion: number|null }): Promise<{ rev; privateVersion }>  // write
reorderPersons(ctx, projectId, { ids: string[] }): Promise<void>                                          // write; full order
searchPersons(ctx, projectId, { query?, limit?, includeArchived?, ids?, publicIds? }): Promise<PersonPickerItem[]>   // read; PersonPicker
runPersonLifecycle(ctx, projectId, { id, op: 'archive'|'restore'|'deleteDraft'|'deletePermanently' }): Promise<{ rev: string|null; privateRemoved?: boolean }>  // archive/restore: archive perm; delete*: delete perm
anonymisePerson(ctx, projectId, { id }): Promise<{ rev; privateRemoved: boolean }>                       // anonymise perm; idempotent
getPersonActivity(ctx, projectId, { id }): Promise<ActivityItem[]>                                       // read
compareSiteOrder(a, b), normalisePersonSlug(s), cleanContact(raw, newKey, seen)                           // pure helpers
```

`savePersonDraft.set` paths (anything else → `invalid_field` before any read): `firstName`, `lastName` (required, non-empty), `displayName` (null/'' unsets), `honorific.<loc>`, `jobTitle.<loc>`, `shortBio.<loc>` (string; '' unsets), `bio.<loc>` (Portable Text blocks, FAQ-answer rules), `groups` (term keys of this project's People groups), `photo` (mediaAsset `_id` of this project, or null), `languages` (ISO 639-1), `website` (http/https or ''), `contacts` (PUBLIC contacts: `{ _key?, kind, value, label?, preferred? }[]`, ≤20, validated by kind), `qualifications` (`{ _key?, title: {<loc>: string}, issuer?, issuedOn?, expiresOn? }[]`, dates `YYYY-MM-DD`), `visibility`, `slug.<loc>` (normalised; unique among this project's people → else `slug_taken`). `<loc>` = a site language (or one already stored). Private contacts, birthday and notes go through `savePersonPrivate` / `movePersonContact`, never `set`.

Types (exported): `PersonState = 'draft'|'published'|'changes'|'archived'`; `PersonSite { defaultLocale; languages }`; `PersonListItem { id, publicId, firstName, lastName, displayName, name, photoUrl, groups, jobTitle, visibility, state, hasDraft, isPublished, archivedAt, anonymised, sortOrder, usage: { pages, posts, events, sessions: number|null }, updatedAt, createdAt, searchText }`; `PersonSnapshot { id, publicId, rev, hasDraft, isPublished, archivedAt, anonymisedAt, state, firstName, lastName, displayName, honorific, jobTitle, groups, photo: { assetId, url }|null, shortBio, bio, languages, website, contacts: PersonContactValue[] (visibility 'public'|'private'), qualifications: PersonQualificationValue[], visibility, slug, sortOrder, private: { available:false } | { available:true, birthday, notes, version|null }, live, usedIn: PersonUsage[], site }`; `PersonPickerItem { id, publicId, name, photoUrl, groups, jobTitle, visibility, state, archived }`; `PersonUsage { kind: 'page'|'post'|'event'|'sessions', id, title, published, count? }`.

Error codes (`PersonErrorCode`): `forbidden, not_found, invalid_field, invalid_value, too_large, conflict, in_use, archive_first, archived, anonymised, missing_name, missing_slug, slug_taken, private_unavailable, failed`.

Behaviour B must know: archived people cannot be edited (restore first); anonymised people cannot be edited at all (only deleted when unreferenced); `publish` needs a slug in the default language when visibility is `page`, and keeps a changed slug as a redirect; making a contact **private** applies at once to the live person (no publish), making it **public** lands in the draft; `private.available === false` (migration 063 not applied) ⇒ hide/disable the private section, everything else works; delete is refused (`in_use`, `detail.usedIn`) while any page/post/event (any version) or event schedule names the person — published people must be archived first (`archive_first`).

### 6.5 Supporting modules

- `src/lib/api/persons-lifecycle.ts`: permission constants `PEOPLE_*_PERMISSION`, `PersonError`, `isPersonId`, `UUID_RE`, `PERSON_USAGE_QUERY`, `PERSON_DELETE_REFERRERS`, `sanityPersonUsage(client, projectSlug, ids, locale)`, `createScheduleUsage(db?) → (projectId, publicIds) => Map<publicId(lowercase), count> | null`, `personLifecycle({ projectId, publicId, scheduleUsage })` (descriptor).
- `src/lib/api/persons-private.ts`: `createSupabasePersonPrivateStore(db?) → PersonPrivateStore { read, save, remove }`, types `PersonPrivateRow`, `PersonPrivateContact`, `PersonPrivateRead`, `isMissingPersonPrivateTable`.

### 6.6 Guard (agent D) — `src/lib/api/persons-guard.ts`

```ts
assertPeopleBelongToProject(projectSlug: string, publicIds: readonly string[], deps?: { client? }): Promise<void>
PEOPLE_GUARD_QUERY, PEOPLE_GUARD_MAX = 200
```
Every id must be a UUID and the `publicId` of a `person` (published or draft) of `projectSlug` (from the GRANT). Empty list passes without I/O. Otherwise throws `PersonError('invalid_value')` (same message for foreign and unknown ids) or `PersonError('failed')` when Sanity cannot be read. For post authors / event hosts (Sanity `_id` references), map refs to publicIds first or check `_id`s with an equivalent query — the guard takes publicIds only.
