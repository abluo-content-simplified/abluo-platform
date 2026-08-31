# Tenant identity migration — runbook

**Status (as of v1.0.30, `dev`):** Stages **1, 2, 4 and 5 are DONE**. Stage **3 is NOT done and
must not be run yet**.

> ### ⛔ Stage 3 is blocked on a production promotion
>
> Stage 3 repoints `form-nologo-demo` from `tenantSlug: "nologo"` to `"freeriders"`. It is a
> **live production data change**, and the code that makes it survivable — the dual-read and the
> tenant-scoped `formDefinition` dereferences — is on **`dev` only**. Production still runs the
> older code.
>
> Running Stage 3 now would move the data ahead of the deploy, which is precisely what §0
> forbids: production would look for No!Logo's form under a `tenantSlug` that no longer exists,
> and the Forms pane and every No!Logo form would empty out with no error and no log line.
>
> **Do not run Stage 3 until v1.0.30 has reached PRODUCTION.** Verify the promotion first, then
> execute Stage 3, then re-run the Stage 4 verification table.

Everything else has landed: `project.tenantSlug` exists in the schema and is written and unset by
`ProjectLinker` (§6), both call sites read it, the `-main` regexes are gone, and the seven
`formDefinition` dereferences in `queries.ts` are tenant-scoped (Stage 5, items 6–7).

**Audience:** whoever executes the migrate + contract phases. Read the whole document before
touching anything.

---

## 0. The rule that governs this whole document

> **Never migrate production data ahead of the deploy.**

The dual-read code must be live in production *before* a single Sanity document changes. If the
data moves first, the currently-deployed code — which still derives tenancy by stripping `-main`
— will look for `formDefinition` documents under a `tenantSlug` that no longer exists, and
No!Logo's Forms pane will empty out with no error and no log line.

The reverse order is safe: dual-read code against un-migrated data returns exactly what the old
code returned (see *Why the expand phase is a no-op*, below).

There is no staging dataset for `production` content. Every step below is against live client
data. Take a dataset export before Stage 2 (`npx sanity dataset export production`).

---

## 1. The bug, in one paragraph

A Sanity `project` is owned by a `client`; the ownership edge is `project.clientRef -> client`,
and the client carries `tenantSlug`. Tenant-owned content — `formDefinition` above all — is filed
under a flat `tenantSlug` string field, not under a project. Two places in the codebase need to
get from a project to its tenant, and both do it by stripping a suffix:

```ts
projectSlug.replace(/-main$/, '')
```

- `src/lib/sanity/schema.ts:204` — the `formRef` reference filter (which forms an editor may pick
  for a CTA).
- `src/lib/sanity/studio/ModuleList.tsx` — a local `deriveTenantSlug()` at `:195` (this runbook
  originally said `:187`; the line had already moved), feeding the Modules pane and the inline
  Forms list. **Now deleted entirely** — the pane imports the shared `deriveTenantSlug()` from
  `src/lib/tenancy/project-scope.ts` instead. Nothing remains at either line number.

This is a no-op for any slug without the suffix. It happens to be right for four of the five live
projects and wrong for the fifth, and the dataset has since been written to agree with the wrong
answer. Both halves must be corrected together.

---

## 2. The live data, as read on 2026-08-29

Sanity project `3n7t84j3`, dataset `production`.

### 2.1 `project` documents

| `_id` | `projectSlug` | `clientRef->tenantSlug` (TRUE owner) | `-main` strip gives | verdict |
|---|---|---|---|---|
| `088e16f6-0288-47b9-af2b-4ef28f90c6a8` | `livener-main` | `livener` | `livener` | correct by luck |
| `90b7cb26-b192-4e8c-8378-d16c085540fd` | `studiomartegani-main` | `studiomartegani` | `studiomartegani` | correct by luck |
| `38cf9381-3893-489a-a987-3a2da28f561b` | `abluo` | `abluo` | `abluo` | correct by luck |
| `drafts.28f192d5-f59d-44c5-a738-e10aaeaed041` | `amelie` | `amelie` | `amelie` | correct by luck (draft only) |
| `project-nologo` | `nologo` | **`freeriders`** | `nologo` | **WRONG** |

None of the five has a stored `tenantSlug` today (`defined(tenantSlug) == false` on all five).

`project-nologo`'s client is `client-freeriders` (displayName "Freeriders", tenantSlug
`freeriders`).

### 2.2 `formDefinition` documents

Scoped by `tenantSlug`, never by `projectSlug`.

| `_id` | `tenantSlug` now | target | action |
|---|---|---|---|
| `formDefinition-livener-contact` | `livener` | `livener` | none |
| `drafts.formDefinition-livener-contact` | `livener` | `livener` | none |
| `formDefinition-livener-demo-choices` | `livener` | `livener` | none |
| `formDefinition-livener-early-access` | `livener` | `livener` | none |
| `formDefinition-livener-request-access` | `livener` | `livener` | none |
| `formDefinition-studiomartegani-contact` | `studiomartegani` | `studiomartegani` | none |
| `formDefinition-studiomartegani-whatsapp` | `studiomartegani` | `studiomartegani` | none |
| `formDefinition-template-contact-basic` | `null` (role `template`) | `null` | none — templates are unscoped by design |
| `formDefinition-template-contact-request-type` | `null` (role `template`) | `null` | none — templates are unscoped by design |
| **`form-nologo-demo`** | **`nologo`** | **`freeriders`** | **repoint, Stage 3** |

`form-nologo-demo` (internalName "No!Logo — Demo / Contact Request", formId `nologo-demo`,
role `active`) is the single content document this migration changes. It has a **project** slug
sitting in a field named `tenantSlug`.

### 2.3 Total set of documents that change

Nine `project` patches (five projects, plus republish of the drafts) and one `formDefinition`
patch. Nothing is deleted.

---

## 3. Why the expand phase is a no-op

`src/lib/tenancy/project-scope.ts` is merged and calls nothing. It exports:

- `deriveTenantSlug(input): ProjectScope | null` — three-tier dual-read (`stored` →
  `clientRef` → `legacy-suffix`), reporting which tier fired via `source`.
- `legacyTenantSlugFromProjectSlug(projectSlug)` — today's regex, verbatim, for call sites that
  want to adopt the module before the data moves without any behaviour change.
- `KNOWN_TENANT_SCOPE_INCONSISTENCIES` / `findKnownInconsistency()` — the `nologo` → `freeriders`
  record. **Warn-only.** It never selects a different tenant.

The module warns in two situations and changes behaviour in neither:

1. a tier-3 fallback — once per slug, "this derivation is unreliable";
2. `clientRef->tenantSlug` disagreeing with the legacy strip — once per slug, a distinct louder
   `TENANT SCOPE DISAGREEMENT` line. That is the exact condition that breaks forms, and today
   only `nologo` triggers it.

A disagreement on a project *not* in the register produces a differently-worded warning telling
the reader to add it here and to the register before migrating. If you see that line, stop and
extend section 2 of this document.

---

## 4. Order of operations

Stages are strictly ordered. Do not merge Stage 2 into Stage 1, and do not start Stage 5 until
Stage 4 has been signed off by a human looking at real panes.

### Stage 1 — deploy the dual-read (code only, no data change)

1. Wire the two call sites onto `deriveTenantSlug`, passing the clientRef tenant where the query
   can supply it:
   - `src/lib/sanity/schema.ts` — the `formRef` filter. It only has `document.projectSlug`, so it
     resolves at tier 3 until Stage 2 backfills the stored field. Behaviour unchanged, warnings
     appear.
   - `src/lib/sanity/studio/ModuleList.tsx` — delete the local `deriveTenantSlug` helper (line
     ~187) and import this one. `ModuleList` already fetches the project document and can project
     `"clientTenantSlug": clientRef->tenantSlug` alongside it; **do not** do that yet — if it
     reads clientRef before Stage 3, No!Logo's pane goes empty. Pass `projectSlug` only in
     Stage 1.
2. Add `project.tenantSlug` to the schema and have `ProjectLinker` write it — see section 6.
   Adding the field is inert until something populates it.
3. Ship through the normal pipeline (`develop` → `staging` → `main`; never push unreviewed to
   `main`). Deploy the Studio too (`npx sanity deploy` / the Studio route redeploys with the app).

**Verify Stage 1 — nothing changed, warnings appeared.**

- Open Studio → Project Settings for each project and confirm the Modules pane still lists the
  same modules: `/studio` on each of the five projects.
- Open Modules → Forms and count the forms. Expected, unchanged from before the deploy:
  Livener 4 active, Studio Martegani 2, No!Logo 1 (`No!Logo — Demo / Contact Request`),
  Abluo 0, Amélie 0.
- Open the browser console on the Studio and confirm `[tenancy]` warnings appear naming the
  projects — that is the dual-read proving it is live.
- Open a page with a CTA whose `actionType` is `form` and confirm the form picker still offers
  the same forms.

Do not proceed until every count above matches what it was before the deploy.

### Stage 2 — backfill `project.tenantSlug` on all five projects

Copy the authority (`clientRef->tenantSlug`) into the project document. This is additive; no
existing field is touched.

| `_id` | set `tenantSlug` to |
|---|---|
| `088e16f6-0288-47b9-af2b-4ef28f90c6a8` | `livener` |
| `90b7cb26-b192-4e8c-8378-d16c085540fd` | `studiomartegani` |
| `38cf9381-3893-489a-a987-3a2da28f561b` | `abluo` |
| `project-nologo` | `freeriders` |
| `drafts.28f192d5-f59d-44c5-a738-e10aaeaed041` | `amelie` |

Note the draft: `amelie` exists only as `drafts.28f192d5-...`. Patch the draft `_id` directly; do
not publish it as a side effect of the migration — that is the content owner's call.

Take the export first:

```bash
npx sanity dataset export production ./backup-pre-tenancy-$(date +%Y%m%d).tar.gz
```

**This is the dangerous stage for `project-nologo`**, because it is the one project whose stored
value (`freeriders`) differs from what the legacy strip returns (`nologo`). After this patch, any
call site reading tier 1 resolves No!Logo to `freeriders` — and `form-nologo-demo` is still filed
under `nologo`. That is why Stage 3 follows immediately, in the same maintenance window, and why
Stage 1 deliberately kept `ModuleList` on `projectSlug`-only input.

**Verify Stage 2.**

- Re-run the read query and confirm all five now have a stored value matching the table:
  `*[_type == "project"]{_id, projectSlug, tenantSlug, "true": clientRef->tenantSlug}`
  — `tenantSlug == true` on every row.
- Reload the Studio Modules → Forms pane for every project and re-count. Counts must still match
  Stage 1, because nothing reads tier 1 yet. If No!Logo's count drops to 0 here, a call site is
  reading the stored field earlier than this runbook assumes — roll the patch back
  (`unset(['tenantSlug'])` on the five projects) and re-sequence.

### Stage 3 — repoint `form-nologo-demo`

One patch:

```
_id:         form-nologo-demo
tenantSlug:  "nologo"  →  "freeriders"
```

Nothing else on the document changes. Check for a `drafts.form-nologo-demo` before patching; if
one exists, patch both so publishing the draft does not silently undo the migration. (At time of
writing there is no such draft.)

**Verify Stage 3.**

- `*[_id == "form-nologo-demo"]{_id, tenantSlug}` returns `freeriders`.
- `*[_type == "formDefinition" && role == "active" && tenantSlug == "nologo"]` returns **zero**
  documents.
- `*[_type == "formDefinition" && role == "active" && tenantSlug == "freeriders"]` returns exactly
  `form-nologo-demo`.
- Studio → No!Logo → Modules → Forms: expect the pane to be **empty at this moment**, because the
  deployed derivation is still the `-main` strip and is still asking for `nologo`. This is the
  expected, temporary inconsistent window between Stage 3 and Stage 5. Keep it short — same
  window, same person.
- The live site is unaffected: the front end renders the form from the CTA's `formRef`
  dereference, which is by `_id`, not by `tenantSlug`. Load `https://nologo.cloud` and submit the
  demo form end-to-end to confirm.

### Stage 4 — flip the call sites onto the stored field, verify every tenant

Now let both call sites read tier 1 (and tier 2 where available):

- `ModuleList.tsx` — project `tenantSlug` and `"clientTenantSlug": clientRef->tenantSlug` in the
  fetch, hand both to `deriveTenantSlug`.
- `schema.ts` `formRef` filter — the filter callback receives the CTA document, not the project,
  so it needs the project's `tenantSlug`. Either resolve it in the callback or have the CTA carry
  the tenant. Whichever route is chosen, `deriveTenantSlug` stays the single derivation.

Deploy, then verify **every tenant**, not just No!Logo:

| Project | URL / pane | Expect |
|---|---|---|
| Livener | `/studio` → Livener → Modules → Forms; `https://livener.net` | 4 active forms; site forms submit |
| Studio Martegani | `/studio` → Modules → Forms; `https://studiomartegani.com` | 2 active forms (it locale) |
| No!Logo | `/studio` → Modules → Forms; `https://nologo.cloud` | **1 form, back from Stage 3's empty pane** |
| Abluo | `/studio` → Modules → Forms; `https://abluo.app` | 0 forms, no error |
| Amélie | `/studio` → Amélie (draft) → Modules | pane renders, 0 forms |

**Note on the Modules pane.** It no longer derives the tenant synchronously from the slug the
structure builder hands it. It now issues an **async lookup of the `project` document** and feeds
the result to the shared `deriveTenantSlug()`, so on every open the pane renders
**"Loading modules…"** until that read resolves. A brief flash of that message is expected and
correct; a pane *stuck* on it means the project read is failing, not that the tenant is wrong. A
failed lookup deliberately resolves to NO tenant rather than a guessed one, so the pane then shows
an empty Forms list — read that as a lookup failure, not as a migration failure.

Also check the CTA form picker on at least Livener and No!Logo, and confirm the picker offers
**no** cross-tenant form (a Livener CTA must not be able to select `form-nologo-demo`).

Console must show no `TENANT SCOPE DISAGREEMENT` for any project, because tier 1 now agrees with
tier 2 everywhere.

### Stage 5 — contract: delete the regexes

Only after Stage 4 is signed off.

1. Delete `projectSlug.replace(/-main$/, '')` from `src/lib/sanity/schema.ts:204`.
2. Delete the local `deriveTenantSlug` from `src/lib/sanity/studio/ModuleList.tsx:187`.
3. Delete `legacyTenantSlugFromProjectSlug()` and the `'legacy-suffix'` tier from
   `src/lib/tenancy/project-scope.ts`, plus the tier-3 tests. A project with no resolvable tenant
   should then return `null` and select nothing, rather than guessing.
4. Empty `KNOWN_TENANT_SCOPE_INCONSISTENCIES` (keep the type and the register — the next
   divergence should have a place to land) and delete the disagreement warning if tier 3 is gone.
5. ~~Fix the template at `src/lib/sanity/schema.ts:~4724`, `id: 'formDefinitionTenantOwned'`,
   which does `tenantSlug: params?.projectSlug`.~~ **DONE** (wave 2; the template now sits at
   `~:4846`). This was the mechanism that created the bug — it stamped whatever slug the structure
   pane passed into a field named `tenantSlug`, which is how `form-nologo-demo` got `nologo`.

   The fix went further than this runbook asked for. Rather than swapping in a resolved tenant
   slug, the template now declares an **optional** `tenantSlug` parameter alongside `projectSlug`
   and **omits the key entirely** when none is supplied:

   ```ts
   // Never fall back to projectSlug. No prefill beats a wrong prefill.
   ...(typeof params?.tenantSlug === 'string' && params.tenantSlug.trim() !== ''
     ? { tenantSlug: params.tenantSlug.trim() }
     : {}),
   ```

   That is strictly better than stamping a resolved slug: an absent `tenantSlug` is *honest* —
   the document is visibly unfiled and an editor must file it — whereas a guessed one is a silent
   wrong answer of exactly the kind this migration exists to remove. Sanity only validates that a
   declared parameter has a valid name and type; it does not require callers to supply it, so the
   optional parameter costs nothing at the call sites that do not have a tenant to hand.
6. Update the comment block at `src/lib/sanity/queries.ts:~490`. **DONE**, and the follow-up it
   named was **wrong** — corrected here so nobody files it.

   > ⚠️ **The old text said: "injecting `$tenantSlug` alongside `$projectSlug` becomes
   > straightforward and should be filed as follow-up work." Do not do this.** `fetchForTenant`
   > *already* injects a `$tenantSlug` parameter, and its value is not a tenant. It is the URL
   > tenant slug from `TENANT_TO_PROJECT` (`src/lib/sanity/client.ts`) — a **PROJECT-grain value
   > wearing a tenant name**. For No!Logo it is `nologo`, while the tenant that owns No!Logo's
   > forms is `freeriders`. Scoping a `formDefinition` lookup on `$tenantSlug` would match
   > nothing and permanently blank No!Logo's forms. `client-read-token.test.ts` pins this
   > ("injects the URL tenant slug verbatim, not the project slug"), and
   > `query-tenant-scope.test.ts` now fails any form subquery that mentions `$tenantSlug`.

   **The real follow-up is: retire `TENANT_TO_PROJECT`.** Until the URL→project mapping is
   replaced by something that can name the owning tenant honestly, there is no trustworthy tenant
   parameter to inject, and `$tenantSlug` should be treated as a project-grain value at every
   call site (see `src/lib/tenancy/ids.ts` on this class of mistake).

   **In the meantime, the query layer scopes forms via a project-document lookup**, which needs no
   new parameter. `PROJECT_TENANT_SLUG` in `queries.ts` resolves the owner from the `project`
   document itself, in `deriveTenantSlug`'s two-tier order (`project.tenantSlug`, then
   `clientRef->tenantSlug`), and `scopedFormDefinition()` turns each dereference into a filtered
   subquery keyed on the reference. A project with no resolvable tenant yields `null`, which
   matches no active form — it selects nothing, never everything.

   `headerCta.form` was scoped this way in v1.0.30. The **six** dereferences that survived that
   wave are now scoped identically, all through the one shared `scopedFormDefinition()` fragment
   (headerCta was re-pointed at the extraction, so there is one copy of the shape, not seven):

   | Query / fragment | Reference field(s) |
   |---|---|
   | `websiteSiteConfigQuery` | `headerCta.formRef` (v1.0.30), `whatsappForm` |
   | `projectModuleConfigQuery` | `whatsappForm`, `internalFormRef`, `ctaForm` |
   | `PAGE_SECTIONS_PROJECTION` | `contactForm`, `form` |
   | `homePageQuery` (its own inline copy of those sections) | `contactForm`, `form` |

   That is **nine** subqueries, not seven: the runbook's count of six missed that
   `projectModuleConfigQuery` dereferences *three* module form slots, not one. Every one of these
   queries binds `projectSlug == $projectSlug` on its root filter, and
   `PAGE_SECTIONS_PROJECTION`'s two consumers (`pageHomeQuery`, `pageBySlugQuery`) do too, so
   `PROJECT_TENANT_SLUG` can always resolve. `role == "template"` documents pass unconditionally
   — they are unscoped BY DESIGN (`tenantSlug: null`) and must stay reachable from every project
   (§2.2). All of this is pinned structurally in
   `src/lib/sanity/__tests__/query-tenant-scope.test.ts`, which fails on any `->` dereference into
   the form projection anywhere in the query catalogue.

7. **Dereferences deliberately NOT scoped, and why.** Two survive; both are audited, neither is
   a definition leak.

   - `CTA_FIELDS` — `"formId": formRef->formId` (`queries.ts:~183`). Reads exactly ONE field
     across the reference, the route key the overlay opens by, and never the definition. It is
     already allow-listed with that reason in `ALLOWED_WITHOUT_PROJECT_SCOPE`. Worth knowing that
     a cross-tenant CTA still yields the *other tenant's `formId` string* here — the overlay then
     opens by that id, so this is the last remaining path by which a mis-pointed CTA can name a
     foreign form. It is a narrower hole than a rendered definition, but it is not closed. Scope
     it when the overlay's own by-`formId` read is audited; doing one without the other just
     moves the failure.
   - `schema.ts` picker filters (`:~1645`, `:~2873`, `:~4484`) — `_type == "formDefinition" &&
     role == "active"`, with no tenant clause. These are **Studio authoring** filters, not
     website reads: they run in the Studio's own client with no `$projectSlug` in scope, so
     `PROJECT_TENANT_SLUG` is not reachable from them. Only `:~102` carries a tenant clause
     (`tenantSlug == $tenantSlug`, supplied by the Studio pane). The runtime queries now fail
     closed regardless, so a cross-tenant pick renders nothing rather than another client's form
     — but the picker still *offers* it, which is the Stage 4 check "no cross-tenant form offered
     in any CTA picker". That check is **still open**.

**Verify Stage 5.** Repeat the full Stage 4 table. Then `rg -n 'replace\(/-main\$/' src` must
return nothing.

---

## 5. Rollback

| Stage | Rollback |
|---|---|
| 1 | Revert the deploy. No data changed. |
| 2 | `unset(['tenantSlug'])` on the five project `_id`s. |
| 3 | Patch `form-nologo-demo.tenantSlug` back to `nologo`. |
| 4 | Revert the deploy; data from stages 2–3 is forward-compatible with the Stage 1 code only if Stage 3 is also rolled back. Roll back 4 → 3 together. |
| 5 | Revert the deploy. |

Worst case, restore the Stage 2 export.

---

## 6. Schema change required — `project.tenantSlug` (DONE)

**Both edits below have been made.** This section is kept as the record of what was done and
why, not as work outstanding.

- **(a) is done.** `project.tenantSlug` exists in `src/lib/sanity/schema.ts` (`~line 3006`),
  `type: 'string'`, `hidden: true`, and deliberately **not** `validation: Rule.required()` — see
  the reason below; it stays unvalidated until the backfill is confirmed on every project.
- **(b) is done.** `ProjectLinker` **sets** `tenantSlug` on link and **unsets** it on relink, so a
  project moved to a different client cannot leave a stale tier-1 value behind. Both behaviours
  are pinned by `src/lib/sanity/__tests__/tenant-slug-provenance.test.ts`; that test is what stops
  either half from being quietly dropped.

The original description follows.

`project.tenantSlug` did not exist in the schema when this runbook was written. The `project` type
(`src/lib/sanity/schema.ts`, `name: 'project'`, ~line 2894) had `clientRef`, `projectId`,
`projectSlug`, `projectName`, `tenantId`, `customDomain` — no `tenantSlug`. The `client` type has
one (~line 2872, hidden), and that is the value being copied down.

**(a) `src/lib/sanity/schema.ts`, in `projectType.fields`, beside the other auto-populated
hidden fields:**

```ts
defineField({ name: 'tenantSlug', title: 'Tenant Slug', type: 'string', hidden: true }),
```

Hidden, like its siblings — `ProjectLinker` owns it; an editor typing into it by hand would be
re-introducing exactly the class of drift this migration removes. Do **not** mark it
`validation: Rule.required()` until the Stage 2 backfill has run on all five projects, or every
existing project document goes invalid in the Studio the moment the schema deploys.

**(b) `src/lib/sanity/fields/ProjectLinker.tsx`, in `handleLink` (~line 157), beside the existing
`tenantId` set:**

The patch list currently reads:

```ts
set({ _type: 'reference', _ref: selectedClientId }, ['clientRef']),
set(selectedProject.id,                            ['projectId']),
set(selectedProject.slug,                          ['projectSlug']),
set(selectedProject.name,                          ['projectName']),
set(selectedClient?.tenantId ?? clientTenantId,    ['tenantId']),
```

Add one line after the `tenantId` set:

```ts
set(selectedClient?.tenantSlug ?? '',              ['tenantSlug']),
```

`selectedClient` is already in scope (`clients.find((c) => c._id === selectedClientId)`), but the
`clients` fetch and its local type (~line 37) currently carry `tenantId` and `displayName` — check
whether `tenantSlug` is projected, and add it to both the GROQ projection and the type if not.
Prefer `unset` over setting `''` if the client has no slug, so absence stays absent and
`deriveTenantSlug` falls through to tier 2 rather than reading a blank string. (`deriveTenantSlug`
treats `''` and whitespace as absent, so a blank is safe either way — but an unset field is
honest.)

`handleRelink` (~line 171) must also `unset(['tenantSlug'])` alongside the other unsets, or
relinking a project to a different client leaves the old tenant behind — a stale tier-1 value that
would out-rank the correct `clientRef`, which is the worst possible failure mode of this design.

This makes every *future* link write the field. The five existing documents still need the Stage 2
backfill.

---

## 7. Checklist

- [x] Stage 1 deployed; form counts unchanged; `[tenancy]` warnings visible
- [x] `project.tenantSlug` schema field added (hidden, not required)
- [x] `ProjectLinker` sets and unsets `tenantSlug` (pinned by `tenant-slug-provenance.test.ts`)
- [ ] Dataset export taken
- [x] Stage 2 backfill on all five projects, including the `amelie` draft
- [ ] **Stage 3 `form-nologo-demo` → `freeriders` (and any draft of it) — BLOCKED until v1.0.30 is
      in PRODUCTION; see the status block at the top**
- [x] Stage 4 deployed; all five tenants verified in Studio and on their domains
- [ ] No cross-tenant form offered in any CTA picker — **still open**; the Studio picker filters
      carry no tenant clause (Stage 5 item 7). The runtime reads fail closed regardless.
- [x] Stage 5 both regexes deleted; `formDefinitionTenantOwned` template fixed
- [x] `rg -n 'replace\(/-main\$/' src` returns nothing
- [x] `queries.ts` headerCta comment updated; all nine `formDefinition` subqueries scoped via
      `scopedFormDefinition()`
- [ ] `$tenantSlug` injection is **NOT** the follow-up — retire `TENANT_TO_PROJECT` instead
      (Stage 5 item 6)
