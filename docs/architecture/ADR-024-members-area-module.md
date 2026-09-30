# ADR-024 — Members area as a module (protected documents)

**Status:** Proposed
**Date:** 2026-09-30
**Owner:** Tom
**Relates:** ADR-014 (one configuration surface), ADR-015 / ADR-017 (actor, `TenantAuthorizationContext`, `assertModuleAction`, per-project membership), ADR-018 (forms — rate-limit store pattern, `tokens.ts` hashing), ADR-019 (Resend is wired — needed only for personal access later), ADR-020 (modules first-class, module config), ADR-021 (consent — the members cookie is strictly necessary), ADR-022 / ADR-023 (module shape precedents), tenant isolation audit + `docs/engineering/sanity-private-dataset.md` (the Sanity dataset is PUBLIC), Multilingual-first principle (CLAUDE.md)

---

## Context

CYCE (yoga association, EN + FR, default EN) publishes a **monthly timetable PDF** that only members may read. On the Webflow site it sits behind one shared password; members receive the password by email. Tom wants this as a platform capability, not a CYCE special case.

Requirements (Tom, 2026-09-30):

1. A **Members area** module, switched on/off per project like every other module.
2. Now: **one shared password per area**. Later: **personal access** (per-person accounts or magic links). Nothing decided now may close that door.
3. Protected content for launch: one PDF per language (EN/FR), falling back to the site's default language when a language is missing.
4. Protected pages are `noindex` and never in the sitemap. Access is an **httpOnly signed cookie** set after the password is entered. Password attempts are **rate-limited**. The password is stored **only as a hash**. Editors can change it, and **changing it invalidates every existing cookie**.
5. Files **never** live in Sanity assets — the dataset and its CDN are public (tenant isolation audit; `sanity-private-dataset.md` §0: anyone with the project id reads every document and every asset URL). Files go to a **private Supabase Storage bucket**, served through **short-lived signed URLs**, only after the cookie check.
6. Roles at launch: Owner + Editors. Permission ids like `members.manage` in the manifest; extensible.
7. Every visitor-facing message comes from locale dictionaries.
8. Calm, minimal UX.

**Hard constraint — the Sanity attribute budget.** The shared dataset is at its **2,000 unique-attribute limit** with about a dozen paths of headroom. Every new field name (path × datatype) that ever gets a value costs one attribute, for the whole dataset, for every tenant. The design must add as few new Sanity paths as possible.

Verified facts this ADR builds on:

- `MODULE_REGISTRY` (`src/lib/modules/registry.ts`) — manifests declare `permissions[]` with `defaultRoles` (`TenantRole = 'owner' | 'editor' | 'viewer'`, `src/lib/types/roles.ts`), `configSchema`, `placement`, `dataStore.primary`. Installation state is `project.moduleInstallations[]` (`moduleId`, `version`, `enabled`, `installedAt`, `provenance`, `config`) — a module with an empty `configSchema` gets only a hidden, never-written `config.unconfigured` placeholder (`src/lib/modules/config-schema.ts`).
- Module config fields are generated into Sanity (`moduleInstallations[].config.<fieldId>`), i.e. **every config field is a new Sanity attribute**, and the closed `ModuleConfigFieldType` union has no "custom pane backed by Supabase" type.
- `page.noindex` (boolean, SEO group) already exists and is honoured in page metadata (`queries.ts` ~L1690). **`src/app/sitemap.ts` does not filter on it today** — the page query is `*[_type == "page" && defined(projectSlug) && pageType != "home"]`. A noindex page is currently still listed.
- The client dashboard has one write precedent: the Submissions status Server Action (`src/app/[locale]/(client)/[tenant]/submissions/actions.ts`) → `getTenantAuthorizationContext()` → `resolveProjectGrant()` → `assertModuleAction()` (`src/lib/api/module-action-guard.ts`) → RLS-scoped update. Content editing in the dashboard does not exist yet (ADR-017 slice 6: read-only).
- RLS style (migrations 007–027): RLS on for every table, `SECURITY DEFINER` helpers `get_my_project_ids()` / `get_my_writable_project_ids()`, member `select` policies, writes by service role after an application-level guard, no `is_abluo_admin()` dependency (migration 025 is optional and unapplied). Latest migration: `027_translation_usage.sql`.
- Rate limiting without Redis already exists: `src/lib/forms/spam.ts` counts recent rows in Supabase per IP and per project, fail-closed on the strict tier.
- Hash + constant-time compare helpers exist in `src/lib/forms/tokens.ts` (`createHash`, `timingSafeEqual`). No password KDF exists yet.
- No Supabase Storage usage exists in the codebase yet — this module introduces the first private bucket.

## Decision

### 1. Module shape

A `membersArea` manifest in `MODULE_REGISTRY`:

- `category: 'engagement'`, `dataStore.primary: 'operational'` (Supabase holds areas, password hashes, document metadata and files; Sanity holds only *where* an area is shown).
- `sectionTypes: ['membersDocumentsSection']` — the **presentation** half (Sections vs Modules: the section presents, the module owns the data and the rules).
- `schemaTypes: ['membersDocumentsSection']`. No document types, no Studio collections in Sanity.
- `configSchema: []` — deliberately. Module config generates Sanity fields (§9); all configuration lives in Supabase and is edited through the module's operational pane (§8).
- `placement.surfaces`: `{ kind: 'sections', description: 'Members documents section — a password prompt, then the area\'s documents.' }`.
- Permissions (extensible, same pattern as `gallery.*` / `translate.*`):

| id | label | defaultRoles |
|---|---|---|
| `members.read` | See the members area and its documents in the dashboard | `owner`, `editor`, `viewer` |
| `members.manage` | Upload and replace documents, change the area password | `owner`, `editor` |
| `members.people.manage` *(declared when personal access ships, §11)* | Invite and revoke individual members | `owner`, `editor` |

Enforcement: slice 1 admin surface is `requireAbluoAdmin()` (Studio); the dashboard surface (slice 2) is `assertModuleAction(ctx, projectId, 'members.manage')`. Installed/disabled state is checked first everywhere: a project without the installation (or with it disabled) answers every members endpoint with `area_unavailable`, and the section renders nothing.

### 2. Data model — Supabase (migration `028_members_area.sql`, additive)

```sql
-- One protected area per row. A project may have several (e.g. "Members", "Teachers").
create table public.members_areas (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  key             text not null check (key ~ '^[a-z0-9][a-z0-9-]{1,39}$'),  -- referenced by the Sanity section
  internal_name   text not null,                                              -- admin/dashboard label only, never public
  access_mode     text not null default 'shared_password'
                    check (access_mode in ('shared_password')),               -- widened to 'personal' | 'either' later (§11)
  session_days    integer not null default 30 check (session_days between 1 and 365),
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, key)
);

-- The secret, split out so no select policy can ever expose it.
create table public.members_area_secrets (
  area_id            uuid primary key references public.members_areas (id) on delete cascade,
  password_hash      text not null,             -- 'scrypt$N$r$p$<salt b64>$<hash b64>'
  password_version   integer not null default 1,-- bumped on every change; embedded in cookies
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id) on delete set null
);

-- A logical document ("Timetable"), one file per locale.
create table public.members_documents (
  id           uuid primary key default gen_random_uuid(),
  area_id      uuid not null references public.members_areas (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,  -- denormalised for RLS
  title        jsonb not null default '{}'::jsonb,   -- { "en": "Timetable", "fr": "Horaire" } — localized, NOT in Sanity
  sort_order   integer not null default 0,
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.members_document_files (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references public.members_documents (id) on delete cascade,
  project_id         uuid not null references public.projects (id) on delete cascade,
  locale             text not null,
  storage_path       text not null unique,        -- '<project_id>/<area_id>/<document_id>/<locale>/<file uuid>.pdf'
  mime_type          text not null check (mime_type = 'application/pdf'),  -- widened deliberately, never implicitly
  size_bytes         integer not null check (size_bytes > 0 and size_bytes <= 20971520),
  original_filename  text,
  sha256             text not null,
  uploaded_by        uuid references auth.users (id) on delete set null,
  uploaded_at        timestamptz not null default now(),
  unique (document_id, locale)                    -- replacing = new object + row swap, old object deleted after
);

-- Rate-limit store (same idea as forms/spam.ts). No raw IPs.
create table public.members_access_attempts (
  id          bigint generated always as identity primary key,
  area_id     uuid not null references public.members_areas (id) on delete cascade,
  ip_hash     text not null,          -- sha256(ip || MEMBERS_IP_SALT)
  succeeded   boolean not null,
  created_at  timestamptz not null default now()
);
create index members_access_attempts_window_idx on public.members_access_attempts (area_id, ip_hash, created_at);
create index members_access_attempts_area_idx   on public.members_access_attempts (area_id, created_at);
```

**RLS** (all five tables `enable row level security`; style of 007/017/027):

- `members_areas`, `members_documents`, `members_document_files`: `select` for `authenticated` where `project_id in (select public.get_my_project_ids())` — the dashboard lists them for members of the project. No insert/update/delete policies: writes go through server code **after** `assertModuleAction(… 'members.manage')` (dashboard) or `requireAbluoAdmin()` (Studio), using the service role wrapped in `runAsTrustedSystemOperation()` with a justification comment (ADR-017 D6). Rationale: every write also touches Storage and hashing, which must be server-side anyway; one guarded path is simpler to audit than RLS write policies plus a Storage policy that must agree with them.
- `members_area_secrets`, `members_access_attempts`: RLS on, **no policies, no grants to `anon`/`authenticated`** — service role only. A browser session can never read a hash or forge/erase an attempt.
- No `anon` grant on any table. Website visitors never talk to Supabase directly; they talk to the members API (§4).

**Storage:** bucket `members-files`, `public = false`, `file_size_limit = 20MB`, `allowed_mime_types = ['application/pdf']`. **No `storage.objects` policies** for `anon` or `authenticated` in slice 1 — only the service role reads or writes it, and only after the guards above. Object paths start with `project_id/` so a later RLS-based upload policy (`(storage.foldername(name))[1]::uuid in get_my_writable_project_ids()`) is possible without moving files.

### 3. Password handling

- **KDF:** Node `crypto.scrypt` (no new dependency), N = 2^15, r = 8, p = 1, 16-byte random salt, 32-byte output, stored as a self-describing string so parameters can be raised later and verified per row. Verification uses `timingSafeEqual`.
- **Never stored or logged in clear.** The API receives it once over HTTPS, hashes it, and discards it. It is never written to Sanity, never returned by any endpoint, never shown again after saving.
- **Policy:** minimum 10 characters; the editing UI offers *Generate* (three random words + digits, from a platform word list) because the password is typed by members from an email.
- **Rotation:** saving a new password writes a new hash **and** increments `password_version` in the same statement. Every cookie carries the version it was issued for; a cookie with an older version is rejected on its next use (§5). Rotation therefore logs everyone out — which is the point: it is how an association "removes" former members.
- **Timing:** the access endpoint always runs one scrypt verification, even when the area key is unknown or disabled (against a fixed dummy hash), so response time does not reveal which areas exist.

### 4. Visitor flow and server path

The page that contains the section stays **statically rendered / cacheable** like every other page. The section is a small client island; all protected state is fetched at runtime from the members API, so no protected data is ever baked into cached HTML and the page does not become per-request dynamic.

Routes (project comes from the URL segment and is re-resolved server-side through the scoped Sanity client + Supabase `projects`, the same pattern as `/api/forms/[projectSlug]/…`):

| Route | Does |
|---|---|
| `POST /api/members/[projectSlug]/[areaKey]/access` | Body `{ password }`. Rate-limit check → scrypt verify → on success set cookie (§5), record `succeeded = true`, `204`. On failure record `succeeded = false`, `401 { code: 'wrong_password' }`. |
| `GET  /api/members/[projectSlug]/[areaKey]/documents?locale=xx` | Cookie check. `401 { code: 'locked' }` without a valid cookie. Otherwise the published documents with the title and file resolved for `locale` (§7): `[{ id, title, servedLocale, isFallback, updatedAt, sizeBytes }]`. |
| `GET  /api/members/[projectSlug]/[areaKey]/files/[documentId]?locale=xx` | Cookie check → resolve file (§7) → `createSignedUrl(path, 60, { download: <localized filename> })` → `303` to it. |
| `POST /api/members/[projectSlug]/[areaKey]/leave` | Clears the cookie (*Forget this device*). |

All members responses: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`. The API returns **codes**, never sentences (§6). Signed URLs are 60-second, single-object URLs: if one is forwarded, it is dead within a minute; the durable secret is the password, not the link.

### 5. Cookie design

- **One cookie per area**, name `__Host-abluo-ma-<areaId first 8 hex>` in production (`__Host-` forces `Secure`, `Path=/`, no `Domain` → bound to the exact site host); plain `abluo-ma-…` on `http://localhost`.
- `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age = session_days × 86400`.
- **Value:** `base64url(payload) + "." + base64url(HMAC-SHA256(payload, MEMBERS_COOKIE_SECRET))`, payload:
  ```json
  { "v": 1, "p": "<project uuid>", "a": "<area uuid>", "pv": 3, "m": "shared", "sub": null, "iat": 1790000000, "exp": 1792592000 }
  ```
- **Verification on every API call:** HMAC valid (constant-time) → not expired → `p` equals the project resolved from the URL (so a cookie from one project, on a shared preview host like `preview.abluo.app/<project>`, is useless for another) → `a` is that area → area installed + enabled → `pv` equals the current `password_version` (one indexed read). Any failure = `locked`; the cookie is cleared.
- **Server secret rotation:** `MEMBERS_COOKIE_SECRET` in Vercel env (never Sanity). An optional `MEMBERS_COOKIE_SECRET_PREVIOUS` is accepted for verification only, so the platform secret can rotate without logging everyone out.
- **Consent (ADR-021):** set only after the visitor submits the password, used only to keep them signed in → *strictly necessary*; no consent prompt, listed in the cookie register as such.
- `m` / `sub` are the hooks for personal access (§11): a personal cookie will carry `m: "person"` and the member id, and verification adds "member not revoked".

### 6. Rate limiting

Counted in SQL over `members_access_attempts` (`count(*)`, never row selection — the PostgREST 1,000-row cap lesson from ADR-023):

- **Per area + IP:** 5 failed attempts in 15 minutes → `429 { code: 'too_many_attempts', retryAfterMinutes }`.
- **Per area, all IPs:** 50 failed attempts in 15 minutes → the prompt answers `too_many_attempts` for 15 minutes for everyone without a valid cookie (distributed guessing). Members already signed in are unaffected (cookie check does not consult the limiter).
- **Fail closed:** if the attempts count cannot be read, the attempt is refused (`try_later`) — same reasoning as the strict tier in `forms/spam.ts`.
- IPs are stored only as `sha256(ip + MEMBERS_IP_SALT)`. Rows older than 30 days are purged by a new sweep in the existing `src/app/api/cron/` family.

### 7. Multilingual

**Visitor-facing interface text** — prompt heading, password label, show/hide, submit, wrong password, too many attempts (with minutes), try later, area unavailable, *only available in {language}* fallback note, download label + size, *Forget this device*, empty state — all from `src/lib/i18n/members-messages.ts` (`getMembersMessages(locale)`), in all seven platform locales, following `gallery-messages.ts` / `translate-messages.ts`. The section component contains no literal strings; aria labels included.

**Section content** (optional heading/eyebrow above the prompt) — the section's existing-name localized fields in Sanity (§9).

**Document titles** — `members_documents.title` jsonb keyed by locale, resolved `title[locale] ?? title[defaultLocale] ?? first non-empty`. Kept in Supabase, not Sanity, to spend no attributes; the dashboard edits it with one input per `siteConfig.supportedLocales` entry (same "inputs derive from the site's languages" rule as localized config lists). The Translate module (ADR-023) can fill it later through the same provider interface.

**Files** — requested `locale` → the site's `defaultLocale` (from `siteConfig`, not hard-coded EN) → none. When a fallback is served, the list says so (`isFallback`, `servedLocale`) and the section shows the localized *only available in English* note. No other cross-language guessing.

### 8. Where it is configured (ADR-014) and who edits it

**One surface: Project Settings → Modules → Members area.** On/off is the normal installation toggle. Below it, the module's **operational pane** — a Studio component rendered inside that same module page — manages everything the module owns: the area(s) (key, internal name, session length), the password (*Change password* / *Generate*; never displays the current one; shows *last changed on … by …*), and the documents (per-locale upload/replace/remove, title per language, order, published). It reads and writes through `/api/members/admin/*` guarded by `requireAbluoAdmin()`.

This needs one small registry extension, because today a module's settings can only be generated Sanity fields: an optional `platformContract.operationalPane?: { component: string }` that the Modules pane renders after the generated config form. It is the ADR-014 `storage: 'operational'` idea applied to modules — the admin sees one page per module whatever the storage behind it. `settings-structure.test.ts` gains an assertion that a module with an `operationalPane` has no second Studio entry.

Documents are *content*, not configuration, but they belong to the module and have no Sanity representation, so the same pane holds them; the dashboard gets its own page for clients (below). No part of this ever appears in Website Settings.

**Client dashboard (slice 2).** Clients never see Sanity, and CYCE's editors must be able to replace the monthly PDF and change the password themselves. A `/[locale]/[tenant]/members` page in the client dashboard, shown when the module is installed and the caller holds `members.read`; upload/replace/password actions are Server Actions following the Submissions precedent exactly: `getTenantAuthorizationContext()` → `resolveProjectGrant()` → `assertModuleAction(ctx, projectId, 'members.manage')` → service-role write. This is the dashboard's first content write and first file upload; uploads go through the Server Action (≤ 20 MB, PDF magic bytes `%PDF-` checked server-side, not only the MIME type), not a browser-side Storage upload, so no Storage policy is needed yet. The dashboard UI copy uses the dashboard's interface dictionaries (next-intl), not the visitor dictionary.

### 9. Sanity footprint and attribute count

The only Sanity change is the section type `membersDocumentsSection`, placed in a page's `sections[]` like any other section:

| Field | Type | Sanity path | New attribute? |
|---|---|---|---|
| `membersArea` | string (the area `key`; Studio input is a dropdown filled from `/api/members/admin/areas`) | `sections[].membersArea` | **yes — 1** |
| `eyebrow` | localizedString | `sections[].eyebrow.<locale>` | no — existing section field, same type |
| `title` | localizedString | `sections[].title.<locale>` | no — existing section field, same type |
| `anchorId` | string (shared `anchorIdField`) | `sections[].anchorId` | no — existing |
| `background` | string (shared surface options) | `sections[].background` | no — existing |

Things that cost **nothing**:

- The installation entry: `moduleInstallations[]` members (`moduleId`, `enabled`, `version`, `installedAt`, `provenance`) already exist as paths; `membersArea` is only a *value*. `configSchema: []` means only the hidden `config.unconfigured` placeholder, which is never written.
- `_type: "membersDocumentsSection"` is a value of the existing `sections[]._type` path.
- **noindex is derived, not stored:** a page is treated as protected when `count(sections[_type == "membersDocumentsSection"]) > 0`. No page-level flag is added (the existing `page.noindex` still works and is also set by the editor if they wish).
- Area config, password hash, document titles, file metadata and files: all Supabase.

**New Sanity attribute paths: 1** (`sections[].membersArea`, string). Before the slice-1 schema deploy, a read-only GROQ check confirms that `sections[].title`, `sections[].eyebrow`, `sections[].anchorId` and `sections[].background` already hold values of the same types in the dataset (they do in current schema usage, but the attribute count is about stored data, not schema). A field whose path is not yet present is dropped from the section rather than spent. **Worst case:** 1. If even that one must be avoided, the fallback is 0 paths: the section carries no key and shows the project's single area, with the key field added only when a project gets a second area — rejected as the default because it makes the multi-area case a later schema change.

Guard: a unit test asserts `membersDocumentsSection` declares no field other than the five above, so a future edit cannot silently spend attributes.

### 10. SEO, discoverability and what is (not) protected

- **Page metadata:** a page with a members section emits `robots: noindex, nofollow` (the same code path as `page.noindex`), regardless of the `noindex` checkbox.
- **Sitemap:** `src/app/sitemap.ts` excludes pages where `noindex == true` **or** a members section is present. (Fixes the existing gap noted in Context for all noindex pages.)
- **`/llms.txt`:** the same exclusion.
- **Structured data:** no JSON-LD for the documents; the section emits nothing about them in HTML.
- **Members API and file responses:** `X-Robots-Tag: noindex, nofollow`.
- **What is protected is the files.** Page text lives in Sanity, and the dataset is public: anything written in a page's sections — including the members page's own intro — is readable by anyone with the project id, cookie or not. Confidential material must be a document in the area, never page text. The section's Studio description says this in one line. (If the dataset is flipped to private per `sanity-private-dataset.md`, this remains good practice: the page HTML is public until the password is entered.)

### 11. Upgrade path to personal access (not built now)

Nothing above assumes "one password forever":

- `members_areas.access_mode` widens to `'personal' | 'either'`.
- New `members_people (id, area_id, project_id, email citext, display_name, status invited|active|revoked, created_at, last_seen_at, unique(area_id, email))` and `members_login_tokens (id, person_id, token_hash, expires_at, used_at)` — magic links sent through the already-wired Resend path (ADR-019), token hashing via `forms/tokens.ts`.
- Cookie payload already carries `m` and `sub`; personal cookies set `m: "person"`, `sub: <person id>`, and verification adds `status = 'active'`. Revoking one person is immediate without rotating the shared password.
- `members.people.manage` is declared then; `members_access_attempts` gains a nullable `person_id`.
- **Members are not Supabase Auth users** in this plan. `auth.users` is the dashboard identity plane (`tenant_members`, `project_members`, invite-only signup, migration 024); mixing website members into it would let a yoga member exist in the same table that grants dashboard access, and every RLS helper would need to exclude them. A separate, area-scoped identity is smaller and cannot escalate. (Open question 9.)
- The section, API routes and dictionaries do not change shape: the prompt gains an *email me a link* variant when `access_mode` allows it.

## Alternatives considered

- **Files as Sanity assets (a `file` field on the section or a document).** Rejected: the dataset and its asset CDN are public, and asset URLs are stable and guessable from document reads. Also spends several attributes per file field.
- **Area config and password hash in Sanity module config.** Rejected: a hash in a public dataset is an offline brute-force target for a short, human-typed shared password; and each config field is a new attribute.
- **Protect the whole page route (middleware gate, server-rendered per request).** Rejected for now: it makes protected pages dynamic, complicates the host-based routing in `src/proxy.ts`, and protects nothing extra — page text is public in Sanity anyway (§10). The section-island approach protects exactly what can be protected.
- **Streaming the PDF through our own route instead of redirecting to a signed URL.** Viable, and hides the storage host entirely, but doubles bandwidth through Vercel functions and hits response-size limits for larger PDFs. The 60-second signed URL gives the same practical protection. Revisit if a client needs watermarking.
- **Vercel Password Protection / Basic Auth.** Per deployment, not per page; no rotation UI for clients; no localized prompt.
- **Upstash/Redis rate limiter.** Better under heavy attack, but a new vendor and env for a low-traffic prompt; the Supabase-count pattern is already proven in forms.
- **Supabase Auth users as members (now).** Deferred to the personal-access decision (§11); not needed for a shared password.
- **A page-level `membersArea` field instead of a section.** Same attribute cost, but couples a module to the page document and cannot say *where* on the page the documents appear. The section is the Abluo way (Sections vs Modules).

## Consequences

- Adding a protected area to any site is: install the module, create an area, set a password, upload files, drop the section on a page. No code per tenant.
- First private Storage bucket and first signed-URL flow on the platform; the helpers (upload with magic-byte check, signed-URL redirect) are reusable for any future private file.
- First module with an operational (Supabase-backed) settings pane — a small registry extension that the ADR-014 test must cover.
- One new Sanity attribute path.
- New env vars: `MEMBERS_COOKIE_SECRET` (required), `MEMBERS_COOKIE_SECRET_PREVIOUS` (optional), `MEMBERS_IP_SALT` (required). Missing required secrets → every members endpoint answers `area_unavailable` and logs an error; it never falls back to an unsigned cookie.
- Risk: a shared password leaks by nature (forwarded emails). Mitigation is cheap rotation that logs everyone out; the real fix is personal access (§11).
- Risk: editors put confidential text on the members page thinking it is protected. Mitigated by the Studio description and dashboard copy; eliminated only by the private-dataset flip.

## Delivery slices

1. **This ADR.**
2. **Slice 1 — what CYCE needs (Tom operates it).**
   - Migration `028_members_area.sql` (tables, RLS, grants, count function) + bucket creation step. Not applied until Tom runs it.
   - `src/lib/members/`: scrypt hash/verify, cookie sign/verify (+ previous-secret), rate-limit counts, locale fallback resolver, storage helpers. Unit tests: hash round-trip and wrong password, cookie tamper/expiry/project mismatch/area mismatch/stale `pv`, rate-limit thresholds and fail-closed, fallback matrix (fr→fr, fr→en default, none).
   - Public routes (§4) + cross-tenant tests in the existing harness (a cookie for project A is rejected by project B's routes).
   - `membersArea` manifest, `membersDocumentsSection` (five fields, attribute guard test), client island, `members-messages.ts` in seven locales.
   - SEO: noindex derivation, sitemap + llms.txt exclusion (also for `page.noindex`), response headers.
   - Registry `operationalPane` + Studio pane: area, password change/generate, per-locale PDF upload/replace, titles.
   - For CYCE: area `members`, document *Timetable* with EN + FR files, section on the members page.
3. **Slice 2 — CYCE editors self-serve.** Dashboard *Members area* page: replace this month's PDF per language, change password, see last change. `members.read` / `members.manage` enforced via `assertModuleAction`.
4. **Slice 3 — comfort.** Scheduled publish (upload next month's timetable, live on the 1st), keep previous months as an archive list, attempts purge cron, optional "copy the new password" helper text for the members email.
5. **Slice 4 — personal access** (§11), when a client needs it.

## Rollout (per slice 1)

Order respects "never migrate ahead of the reading code" and "deploy the secret before the code that needs it":

1. Apply migration 028 and create the private bucket (additive; nothing reads them yet).
2. Set `MEMBERS_COOKIE_SECRET` and `MEMBERS_IP_SALT` in Vercel (all environments) and `.env.local`.
3. Deploy dev → preview → main. The section type is additive; no existing content changes.
4. Run the read-only attribute check (§9) before the Studio schema deploy that introduces `membersArea`.
5. Install the module on CYCE, create the area, set the password, upload EN/FR, add the section. Verify: prompt, wrong password, 6th attempt → 429, correct password → list, download, FR→EN fallback note, rotation logs out an existing browser, page absent from `sitemap.xml`, `noindex` in the head.

## Open questions for Tom

1. **Who uploads the timetable at launch?** Tom via Studio (slice 1 is enough to go live), or CYCE editors via the dashboard (slice 2 must ship before go-live)?
2. **How long does "remember me" last?** Proposed 30 days per area. Longer (e.g. a season) means fewer re-entries; shorter means a leaked password stays useful for less time.
3. **Rotation cadence for CYCE** — never, yearly (new membership season), or monthly with the timetable? Affects how often members get an email.
4. **One area or more for CYCE?** Just "Members", or also e.g. teachers-only material? And are the **recordings** members-only too (they are video links or files — which)?
5. **Missing language:** show the default-language PDF with an *only available in English* note (proposed), or hide the document for that language?
6. **Past timetables:** only the current month, or keep an archive of previous months visible to members?
7. **Global lockout:** accept the per-area 15-minute lockout after 50 failures from many IPs (protects the password, may briefly block a member who is not yet signed in), or per-IP only?
8. **Page text is public.** OK to treat only files as protected (proposed), or should the Sanity dataset be made private (runbook exists) before CYCE launches?
9. **Personal access identity (later):** separate member records + magic links (recommended), or Supabase Auth accounts shared with the dashboard?
10. **Dashboard viewers:** should `viewer` see the members area page (read-only) — proposed yes — and download the files without the password?
11. **File types and size:** PDF only, 20 MB max — enough, or also images/ZIP later?
