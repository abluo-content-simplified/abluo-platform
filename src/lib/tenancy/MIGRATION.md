# Tenant identity migration — runbook

**Status:** EXPAND phase complete (`src/lib/tenancy/project-scope.ts` + tests, merged, not yet
called by anything). MIGRATE and CONTRACT are unexecuted.

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
- `src/lib/sanity/studio/ModuleList.tsx:187` — `deriveTenantSlug()`, feeding the Modules pane and
  the inline Forms list.

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
5. Fix the template at `src/lib/sanity/schema.ts:~4724`,
   `id: 'formDefinitionTenantOwned'`, which does `tenantSlug: params?.projectSlug`. **This is the
   mechanism that created the bug** — it stamps whatever slug the structure pane passes into a
   field named `tenantSlug`, which is how `form-nologo-demo` got `nologo`. Left in place, it will
   re-create the inconsistency on the next form an editor makes for No!Logo. It must take the
   resolved tenant slug, not `projectSlug`. Consider fixing this earlier, in Stage 1 — it is
   independent of the data migration and every day it stays is a chance to re-break the data.
6. Update the comment block at `src/lib/sanity/queries.ts:~490`, which documents both derivations
   as unreliable and names `nologo`/`freeriders` explicitly. Its conclusion — that `headerCta`
   cannot be tenant-scoped inside the query — is a separate, still-open gap (`fetchForTenant`
   passes only `$projectSlug`); the migration removes its stated reason but not the gap. Once
   `project.tenantSlug` exists, injecting `$tenantSlug` alongside `$projectSlug` becomes
   straightforward and should be filed as follow-up work.

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

## 6. Schema change required — `project.tenantSlug` (DESCRIBED, NOT DONE)

`project.tenantSlug` **does not exist in the schema today**. The `project` type
(`src/lib/sanity/schema.ts`, `name: 'project'`, ~line 2894) has `clientRef`, `projectId`,
`projectSlug`, `projectName`, `tenantId`, `customDomain` — no `tenantSlug`. The `client` type has
one (~line 2872, hidden), and that is the value being copied down.

Two edits are needed. **Both files were off-limits to the session that wrote this runbook; neither
change has been made.**

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

- [ ] Stage 1 deployed; form counts unchanged; `[tenancy]` warnings visible
- [ ] `project.tenantSlug` schema field added (hidden, not required)
- [ ] `ProjectLinker` sets and unsets `tenantSlug`
- [ ] Dataset export taken
- [ ] Stage 2 backfill on all five projects, including the `amelie` draft
- [ ] Stage 3 `form-nologo-demo` → `freeriders` (and any draft of it)
- [ ] Stage 4 deployed; all five tenants verified in Studio and on their domains
- [ ] No cross-tenant form offered in any CTA picker
- [ ] Stage 5 both regexes deleted; `formDefinitionTenantOwned` template fixed
- [ ] `rg -n 'replace\(/-main\$/' src` returns nothing
- [ ] `queries.ts` headerCta comment updated; `$tenantSlug` injection filed as follow-up
