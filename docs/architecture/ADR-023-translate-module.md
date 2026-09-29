# ADR-023 — Translate as a module (one-click machine translation, stored, metered)

**Status:** Proposed — slices 1–3 implemented on `feat/translate-module` (2026-09-29), not yet released
**Date:** 2026-09-29
**Owner:** Tom
**Relates:** ADR-020 (modules first-class, module config as the configuration surface), ADR-014 (one configuration surface per concept), ADR-015 (actor / `requireAbluoAdmin`), ADR-017 slice 6 (client dashboard read-only today), tenant isolation audit (public dataset → no secrets in Sanity), Multilingual-first principle (CLAUDE.md)

---

## Context

Every Abluo site is multilingual-first, and every translatable field is one of three platform types: `localizedString`, `localizedText`, `localizedPortableText` (`src/lib/sanity/schema.ts`). Today the second language is typed by hand, or pasted from a translation made outside the platform. On CYCE (EN + FR, ~46,500 characters for the whole site in both languages) the second language was produced as a machine overlay during migration (`clients/cyce/content/translations/translations.json`).

Tom wants a **Translate** button beside every translatable field: one click fills the other language(s) from the source text; the result is **stored** (never translated per visitor); a human may review it — or not.

Decisions already taken by Tom (2026-09-29):

1. It is a module, switched on/off per project (`project.moduleInstallations`).
2. The provider is swappable per project. Google Cloud Translation first; DeepL and Claude as alternatives. One interface, adapters behind it.
3. Metering from day one: every call records characters, per project, per provider.
4. Optional monthly quota per project. When reached, the button is disabled with a friendly localized message. No billing yet — only the numbers that make billing possible later.
5. Every translated value carries a status: `original` · `machine` · `reviewed`. Editing UI only, never on the public site. Editing a machine value by hand turns it into `reviewed`.
6. Public sites stay one language per URL (hreflang, sitemap unchanged). No mixed-language pages.

## Decision

### 1. Module shape

A `translate` manifest in `MODULE_REGISTRY` (`src/lib/modules/registry.ts`):

- **No** schema types, sections, collections or page type. It adds a capability to existing fields; it owns no content. (Sections vs Modules principle: nothing to split.)
- `category: 'platform'`, `dataStore.primary: 'hybrid'` — configuration in Sanity (module config), usage records in Supabase.
- `placement.surfaces: []` — no website surface. Decision 6 holds by construction: the public site never calls a provider.
- Permissions:
  - `translate.use` — *Translate content*, default roles `owner`, `editor`.
  - `translate.usage.read` — *See translation usage*, default role `owner`.
  v1 enforcement is `requireAbluoAdmin()` (the button is in Studio only). The permissions are declared now so the dashboard button (when ADR-017 editing ships) needs no redesign — the same pattern as ADR-022's `gallery.*`.

### 2. Configuration surface — module config, not the Integration Registry

Provider and quota are **module config** (ADR-020), edited in *Project Settings → Modules → Translate*. Not the Integration Registry: integrations (ADR-014) are third-party scripts rendered on the public website under the consent regime; a translation provider is a server-side capability of an editorial module with permissions. Putting it in both would be the second surface ADR-014 forbids; putting it in integrations would drag it under consent/tracking semantics that do not apply.

`configSchema`:

| id | type | default | meaning |
|---|---|---|---|
| `provider` | select `google` \| `deepl` \| `claude` | `google` | Which engine this site uses. |
| `monthlyCharacterQuota` | number | empty | Characters per calendar month (UTC). Empty or `0` = no limit. |

**Secrets are never in Sanity** (the dataset is public — tenant isolation audit). Keys live in environment variables only:

| Provider | Env var | Endpoint |
|---|---|---|
| Google Cloud Translation (Basic, v2) | `GOOGLE_TRANSLATE_API_KEY` | `translation.googleapis.com/language/translate/v2` |
| DeepL | `DEEPL_API_KEY` (a `:fx` key targets `api-free.deepl.com`) | `/v2/translate` |
| Claude | `ANTHROPIC_API_KEY` (+ optional `TRANSLATE_CLAUDE_MODEL`) | `/v1/messages` |

A provider selected in config whose key is absent answers `provider_not_configured` — the button explains, nothing is sent. Keys are one per Abluo account, shared by all tenants (Google's 500k free characters/month is per Abluo account, not per client — this is exactly why metering is per project).

### 3. Provider interface

`src/lib/translate/providers/types.ts`:

```ts
interface TranslationProvider {
  id: 'google' | 'deepl' | 'claude'
  isConfigured(): boolean
  translate(req: {
    texts: string[]            // one batch, order preserved
    source: SupportedLocale
    target: SupportedLocale
    format: 'text' | 'html'    // html = markup preserved (Portable Text path)
  }): Promise<{ texts: string[]; billedCharacters: number }>
}
```

- One target per call; the service loops targets. Every adapter maps platform locales to provider codes itself (e.g. DeepL `EN-GB`, `PT-PT`).
- `billedCharacters` is the provider's own count where it reports one (DeepL `billed_characters`), otherwise the source character count (Google bills per source character per target, markup included). Claude is metered in characters too, so all three are comparable; tokens are not recorded in v1.
- Adapters are pure `fetch` — no SDK dependencies. They are unit-tested against a stubbed `fetch`.
- Provider errors are normalised to `TranslateError` codes; raw provider messages go to the server log only, never to the client.

### 4. Status model — stored beside the value, in Sanity

Each localized type gains **one hidden, optional field**, `translationStatus`, an object keyed by locale:

```
title: {
  en: "Our teachers",
  fr: "Nos professeurs",
  translationStatus: {
    fr: { status: "machine", provider: "google", sourceLocale: "en",
          translatedAt: "2026-09-29T…", textHash: "…", sourceHash: "…" }
  }
}
```

- **Additive and safe.** A new optional field on an object type; no existing value changes shape; no migration. GROQ reads `field[$locale]`, which is unaffected. It is `hidden`, so the Studio form never renders it, and `LocalizedInput`'s member filter already passes unknown members through.
- **Absent = `original`.** Everything typed before this ADR, and every value typed by hand, is `original`. The module never writes `original` explicitly.
- **`machine` → `reviewed`, automatically.** `textHash` is a hash of the text as the machine wrote it. When the editor changes that locale's text, its hash no longer matches and the input writes `status: "reviewed"`. This survives reloads and other editors because the evidence is in the document, not in component state.
- **`reviewed` without editing.** A *Mark reviewed* action beside the badge (slice 4) — a machine translation that is already right should not need a fake edit.
- **`sourceHash`** records the source text that was translated, so a later slice can flag *"source changed since translation"* without another model.
- **Never on the public site.** No website query projects `translationStatus`; a test asserts `queries.ts` never mentions it.

Why Sanity and not Supabase: the status belongs to the value and must travel with it (drafts, publish, export/import, document duplication). A side table keyed by document path would drift the first time a section is reordered.

### 5. What one click does

*Translate from EN* on a field:

1. Source = the chosen source locale (default: the site's default locale, i.e. the first `supportedLocales` entry that has text).
2. Targets = the site's other `supportedLocales` where the value is **empty or still `machine`**. `original` and `reviewed` values are **never overwritten** by the one-click action. (Overwriting a human's work is a separate, explicit per-locale *Re-translate* action, slice 4.)
3. Server translates, meters, returns; the input writes each target value and its `translationStatus` in one patch.

### 6. Server path

`POST /api/translate` (admin-only in v1), body `{ projectSlug, sourceLocale, targetLocales[], texts[], format, documentId? }`:

1. `requireAbluoAdmin()` → 403 otherwise.
2. Validate input: locales in the platform registry, targets ≠ source, ≤ 50 texts, ≤ 20,000 source characters per request (`MAX_CHARS_PER_REQUEST`).
3. Resolve the Sanity `project` by `projectSlug` through `tenantClient` (scoped): Supabase `projectId` + the `translate` installation. Not installed / disabled → `module_disabled`.
4. Meterability: the Supabase `projects` row must exist (usage rows reference it). If not, or if the check fails → `usage_unavailable`, **before** any provider credit is spent. Metering is not optional.
5. Quota: if `monthlyCharacterQuota > 0`, sum this project's `characters` for the current UTC month; if `used + requested > quota` → `quota_reached` (HTTP 429). **Fails closed**: if usage cannot be read while a quota is set, the request is refused (`usage_unavailable`).
6. Call the provider once per target.
7. Record one `translation_usage` row per target with the billed characters. If recording fails the translation is still returned (the provider has already charged; refusing would waste it) and the failure is logged at error level.
8. Return `{ translations: { fr: [...] }, provider, usage: { charactersThisRequest, monthToDate, quota } }`.

`GET /api/translate/status?projectSlug=` returns `{ enabled, provider, providerConfigured, quota, monthToDate }` so the Studio can show, disable or explain the button before anyone clicks.

### 7. Metering — Supabase `translation_usage`

Migration `027_translation_usage.sql`:

```sql
create table public.translation_usage (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  provider        text not null check (provider in ('google','deepl','claude')),
  source_locale   text not null,
  target_locale   text not null,
  characters      integer not null check (characters >= 0),
  text_count      integer not null default 1,
  format          text not null default 'text' check (format in ('text','html')),
  sanity_document_id text,
  actor_id        uuid references auth.users (id) on delete set null,
  environment     text not null default 'production',
  created_at      timestamptz not null default now()
);
```

- Index `(project_id, created_at)` for the monthly sum.
- The monthly total is summed **in SQL** by `translation_usage_month_total(project_id, since)` (service role only). Summing selected rows in application code would silently stop at PostgREST's 1,000-row page and the quota would never trigger on a busy site.
- RLS on. `select` for members of the project (`get_my_project_ids()`) and for Abluo admins (`is_abluo_admin()`), matching migrations 017/025. Inserts are **service-role only** (no insert policy) — a client can never forge or erase usage.
- `environment` (`VERCEL_ENV` or `development`) so dev/preview clicks can be excluded from a billing view — they spend the same real provider credit, so they are recorded, not dropped.
- One row per target language per click. At CYCE's scale this is a few hundred rows a year; no rollup table until one is needed.

### 8. Quota behaviour

- Soft limit per project per calendar month (UTC), in characters.
- When reached, `status` reports it, the button is disabled and shows the localized *quota reached — contact us* message. Tom then turns the module off, raises the limit, or charges for it.
- A request that would cross the limit is refused whole (no partial translation).
- It is a **soft** limit: two simultaneous clicks can each pass the check and together overshoot by one request, and DeepL's billed count can differ slightly from the estimate. Acceptable for a billing signal; an atomic reservation is not worth its complexity at this scale.

### 9. Messages

Every user-facing message (button labels, errors, quota reached, badge labels) comes from `src/lib/i18n/translate-messages.ts` (`getTranslateMessages(locale)`), in all seven platform locales. The API returns **codes**, never sentences. Studio today renders the `en` dictionary; the dashboard will pass the user's interface locale.

### 10. Portable Text (slice 4)

`localizedPortableText` is translated as HTML: each block serialises to one HTML string with marks as tags (`<strong>`, `<em>`, `<code>`, …) and annotations as `<a data-k="markDefKey">`; `format: 'html'` makes Google/DeepL keep the markup; the result is parsed back into spans reusing the original `markDefs` by key. Block style, list type and level are carried over from the source block, never translated. This is the TypeScript counterpart of the Hoffmann `to_portable_text.py` round-trip, and gets the same round-trip test (no provider: identity translation must reproduce the input exactly).

## Consequences

- Adding a provider = one adapter file + one select option + one env var. Nothing else changes.
- Switching a site's provider is one config change; usage history keeps each row's provider.
- The dashboard button (post ADR-017 editing) reuses the same API, swapping `requireAbluoAdmin()` for `translate.use` via `resolveTenantContext`.
- Hand-typed content is untouched: status absent = original.
- Risk: a provider may alter placeholders or markup; html format + round-trip tests (slice 4) are the guard.

## Delivery slices

1. **This ADR.**
2. **Provider interface + Google adapter (+ DeepL, Claude) + metering + API routes**, server-side only. Migration 027 (not applied until Tom runs it). Tests: adapters against stubbed fetch, quota maths, input validation, status hashing.
3. **Studio action** *Translate from X* on `localizedString` / `localizedText`, writing `translationStatus`, auto `machine → reviewed` on edit, status chips with *Mark as reviewed*. A target typed into while the request was in flight is left alone.
4. Portable Text, per-locale *Re-translate* / *Mark reviewed*, stale-source flag, usage view for Tom (per project, per month, per provider).
5. Dashboard button when ADR-017 editing ships.

## Rollout

1. Apply migration 027 (additive; nothing reads it until the code ships).
2. Set `GOOGLE_TRANSLATE_API_KEY` in Vercel (all environments) and `.env.local`.
3. Deploy through dev → preview → main. The schema change (hidden field) is additive; the deployed website ignores it.
4. Install the `translate` module on CYCE in *Project Settings → Modules*. Optionally set a quota.
