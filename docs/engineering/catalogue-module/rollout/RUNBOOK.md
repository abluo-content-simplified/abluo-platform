# Catalogue V2 — data rollout runbook (C10-6 / C10-7)

**For:** Tom, on the Mac, in a terminal at the repo root (`~/Abluo/abluo-platform`).
**Authority:** `contracts/C2-C5-C10-…-migration.md` §C10-6 (the single ordered plan) and §C10-7 (rollback); data-step definitions in `contracts/C1-C7-C11-…md` (C1.9 D1, C7 D3, C11.5 D4) and audit kinds in `contracts/C6-C8-C9-C12-…md` (C12). Decisions D-10, D-11, D-12, D-13, D-14, D-15 (`DECISIONS-step2-final-2026-11-02.md`).

Run the commands **one at a time**, in order, and read each output before the next. Every script stops with a non-zero exit and prints `REFUSE …` when something is outside the contract. **A refusal means stop: nothing is fixed by hand, Tom decides.**

---

## 0. What the scripts guarantee

| Guarantee | How |
|---|---|
| Staging never writes to production (D-11) | Every script needs `--dataset` (no default) and writes only there. A write to `production` needs `--dataset production --approval <id>`, and the id must name a **green staging report of the same step**. The rehearsal asserts the client is bound to `staging` before its first mutation. Only `staging` and `production` are writable. |
| Dry run first | Every data step is a dry run unless `--apply` is given: the same plan is applied in memory and verified. |
| No second implementation | D1 uses `seedTaxonomyFromTerms` + `legacyCategoriesToAssignment`, D2 `migrateCommerceDoc` / `migrateChannelEntries` / `compareCommerce`, D3 `legacyPresetRecord`, D4 `planPublicNameMigration` — the functions the R1 readers use. |
| Draft and published together | Published, `drafts.*` (and `versions.*`) of one item, and the published + draft copies of a project document, are patched with the same function in the **same transaction**, each guarded by its own revision. |
| Idempotent | A second run of any step plans nothing, writes nothing and records no audit row. An interrupted run is re-run as is. |
| Additive until R3 | D1 keeps `categories`, D2 keeps `offers`, D3 keeps `appliedPreset`. Only D4 unsets `navLabel` (safe: R1 removed every reader). |
| Writer identity | Transaction ids `abluo-migr-<migrationId>-<n>` (C9 `CATALOGUE_WRITER_PREFIXES`), so no migration write is reported as `studio.write_outside_gate`. |
| Payload limit | Transactions are filled against `SANITY_MUTATION_MAX_BYTES` (4 MB) with the 20 % margin; a draft/published pair is never split. |
| Audit is required | Before the first mutation an `--apply` run checks that `catalogue_audit_log` exists and the project resolves in Supabase; if not, it stops having written nothing. Rows: `migration.taxonomy`, `migration.commerce`, `migration.pack_history`, `public_name.migrated` (actor `system`, correlation = migration id). Staging rehearsals audit into **Abluo Sandbox** (`.env.sandbox.local`, `assertSandboxSupabase`); production into **Abluo** (`.env.local`, must be the production project). |
| Markers | After a step verifies, `catalogueMigrations.<step>` is set on the project (published + draft). D2 refuses without the `taxonomy` marker; D4 without `taxonomy`, `commerce`, `packHistory`. |
| Reports | Every run writes JSON to `docs/engineering/catalogue-module/rollout/reports/<report id>.json`. Exports (real content) go to `backups/catalogue/…` (git-ignored) and are **kept untouched until R3 is accepted** — they are the rollback artefacts. |

Scripts (all `npx tsx scripts/catalogue/<name> --help`):
`export-catalogue.mjs` · `preflight-catalogue.mjs` · `import-to-staging.mjs` · `migrate-taxonomy.mjs` (D1) · `migrate-commerce.mjs` (D2) · `migrate-pack-history.mjs` (D3) · `migrate-public-name.mjs` (D4) · `verify-data-step.mjs` (+ `verify-taxonomy.mjs`, `verify-pack-history.mjs`, `verify-public-name.mjs`) · `verify-commerce-equivalence.mjs` (C10-5, existing: compares two snapshot files; `verify-data-step.mjs --step commerce` runs the same `compareCommerce` against the live dataset) · `snapshot-public-output.mjs` (C11 `website-output.unchanged`).

---

## 1. Gates before anything runs

Tick each with a date in the C10-6 gate lines of the contract (they are the record):

1. **M0 done** — `061_catalogue_audit_log.sql` applied on Abluo Sandbox, approved, applied on Abluo.
2. **R1 in production** and its verification green (C10-5 E6/E7 against the live tmz site, C11 `website-output.unchanged`).
3. **Access register** (D-18, C9 9.5a) — completed and dated *before R1 was promoted*: Sanity seats limited to named staff; the only standing write token is the server token; the migration token is issued per run and revoked after it (§2); MCP / CLI / personal tokens read-only.
4. **Allergen evidence retention** (D-20) — does **not** block these data steps, but the allergen slice (`reviewAllergens` writers) is not enabled in production until the privacy/legal decision is recorded in C10-6 gate 2 with date and reference. Five years is the platform audit default meanwhile; nothing here creates allergen evidence.
5. `git status` is clean on `dev` and the scripts are the reviewed version.

## 2. Tokens and credentials

| What | Where it comes from | Scope | Lifetime |
|---|---|---|---|
| `SANITY_API_READ_TOKEN` | already in `.env.local` | read-only (Viewer) | standing |
| `SANITY_MIGRATION_TOKEN` | sanity.io/manage → project → API → Tokens → *Add token*, name `catalogue-migration-<date>-<staging\|production>`, permission **Editor** | **rehearsal: write access to `staging` only**; production run: a second, separate token | one run; **delete it in the same screen right after** |
| Abluo Sandbox Supabase | `.env.sandbox.local` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) | sandbox only (guarded) | standing |
| Abluo Supabase | `.env.local` | production audit rows only | standing |

- Put the migration token in the **shell only**, never in a file: `export SANITY_MIGRATION_TOKEN='<paste>'`. Remove it with `unset SANITY_MIGRATION_TOKEN` and delete the token in Sanity when the run is done. The scripts never fall back to the app's `SANITY_API_WRITE_TOKEN`.
- **Dataset scoping.** If Sanity offers a token or custom role limited to the `staging` dataset on this plan, use it for the rehearsal. If it does not (dataset-level roles may be an Enterprise feature — check the *Add token* / *Roles* screen), the token is project-wide and the protection is the scripts' guards (`--dataset staging` only, client-dataset assertion, approval check for production) plus the token's one-run lifetime. Record which applied in the access register.
- Sandbox must contain a `projects` row for each migrated slug (the audit table references `projects.id`). If the slug is not unique in a Supabase project, pass `--supabase-project <slug>=<uuid>`.

---

## 3. P — export and pre-flight (read-only)

```bash
npx tsx scripts/catalogue/export-catalogue.mjs --dataset production --label p
```
Copy the folder it prints, then:
```bash
export P=backups/catalogue/p-production-<stamp>
```
```bash
npx tsx scripts/catalogue/preflight-catalogue.mjs --dataset production --from $P --label p --audit-for staging
```
Expected for tmz (2026-11-02): items published=10 drafts=6 versions=0; D1 3 categories / 7 tags / 15 item documents assigned, 1 without category; D2 4 priced documents, no channels; D3 `bookshop@1`; D4 copy `{en: Books, it: Libri, de: Bücher}`. Findings to read (decided, not refusals): `item.multiCategory` (the two-category draft → primary `technology`, additional `literature`, D-15), `taxonomy.configListIgnored` (stale `config.categories`, terms win), `publicName.copy`.
**Any `REFUSE` → stop.**

## 4. S — staging rehearsal

Create the staging-only migration token (§2) and `export SANITY_MIGRATION_TOKEN='…'`.

```bash
npx tsx scripts/catalogue/import-to-staging.mjs --dataset staging --from $P
```
```bash
npx tsx scripts/catalogue/import-to-staging.mjs --dataset staging --from $P --apply
```
(`--replace` only when repeating a rehearsal on a non-empty staging.) References to documents outside the export (image assets, media documents) are imported as weak references and listed; verifications ignore the `_weak` flag. Staging pages will show no images — expected.

Then each step, **dry run first, then apply**, always verified against the P export:

```bash
npx tsx scripts/catalogue/migrate-taxonomy.mjs --dataset staging --before $P
```
```bash
npx tsx scripts/catalogue/migrate-taxonomy.mjs --dataset staging --before $P --apply
```
```bash
npx tsx scripts/catalogue/migrate-commerce.mjs --dataset staging --before $P
```
```bash
npx tsx scripts/catalogue/migrate-commerce.mjs --dataset staging --before $P --apply
```
```bash
npx tsx scripts/catalogue/migrate-pack-history.mjs --dataset staging --before $P
```
```bash
npx tsx scripts/catalogue/migrate-pack-history.mjs --dataset staging --before $P --apply
```
```bash
npx tsx scripts/catalogue/migrate-public-name.mjs --dataset staging --before $P
```
```bash
npx tsx scripts/catalogue/migrate-public-name.mjs --dataset staging --before $P --apply
```
Each apply ends with `GREEN` and `report: …/reports/<id>.json`. **Note the four report ids** (`d1-taxonomy-staging-<stamp>`, `d2-commerce-staging-<stamp>`, `d3-pack-history-staging-<stamp>`, `d4-public-name-staging-<stamp>`): they are the approvals for production.

Independent verifications (read-only, before = P, after = staging):
```bash
npx tsx scripts/catalogue/verify-data-step.mjs --step commerce --dataset staging --before $P
```
```bash
npx tsx scripts/catalogue/verify-data-step.mjs --step taxonomy --dataset staging --before $P
```
(repeat with `--step pack-history` and `--step public-name`). Every diff must be empty; class W must be empty.

Idempotency check — run one apply again; it must report `transactions: 0` and `GREEN`:
```bash
npx tsx scripts/catalogue/migrate-taxonomy.mjs --dataset staging --before $P --apply
```

> **⛔ R2 rehearsal — NOT POSSIBLE YET.** C10-6 S also rehearses the R2 writer behaviour from a dedicated preview deployment whose Sanity dataset is `staging` (with the staging-only token; never the shared preview deployment). The R2 writers are not built. This part of S is done when R2 exists, **before** the Stop below.

`unset SANITY_MIGRATION_TOKEN` and delete the staging token in Sanity.

## 5. Reports

Commit the reports folder with the migration slice (one commit, descriptive message), and summarise them in the project doc: `git add docs/engineering/catalogue-module/rollout/reports` then commit. Exports stay in `backups/` (never committed).

## 6. ⛔ STOP — Tom approves

Approval = the four green staging report ids above, written into the release notes with the date.

## 7. R2 in production — ⛔ BLOCKED until R2 is built

C10-6: R2 (writers + Setup + Studio config lock) must be **released and promoted to production before any production data step**. Nothing below runs until `https://abluo.app/api/version` reports the R2 release.

## 8. P′ — refresh before the production data steps (read-only)

```bash
npx tsx scripts/catalogue/export-catalogue.mjs --dataset production --label p-prime
```
```bash
export PP=backups/catalogue/p-prime-production-<stamp>
```
```bash
npx tsx scripts/catalogue/preflight-catalogue.mjs --dataset production --from $PP --label p-prime --audit-for production
```
Compare with the P report: a refusal that was not in P stops the run. `$PP` is **the rollback artefact for D1–D4**; P stays the rehearsal artefact.

Public-output snapshot before (C11 proof 2; add one collection and one item path):
```bash
npx tsx scripts/catalogue/snapshot-public-output.mjs --site https://tmz.it --paths /llms.txt,/sitemap.xml,/en/books,/it/libri,/de/buecher --out backups/catalogue/public-before.json
```
(use the real landing paths of the tmz Catalogue segment per locale.)

## 9. D1 → D4 on production

Create the production migration token (§2), `export SANITY_MIGRATION_TOKEN='…'`. For each step: dry run, then apply with the approval = the staging report id of **that** step. Every script re-runs its own pre-flight on live data before its first mutation.

```bash
npx tsx scripts/catalogue/migrate-taxonomy.mjs --dataset production --before $PP
```
```bash
npx tsx scripts/catalogue/migrate-taxonomy.mjs --dataset production --before $PP --apply --approval d1-taxonomy-staging-<stamp>
```
```bash
npx tsx scripts/catalogue/migrate-commerce.mjs --dataset production --before $PP
```
```bash
npx tsx scripts/catalogue/migrate-commerce.mjs --dataset production --before $PP --apply --approval d2-commerce-staging-<stamp>
```
```bash
npx tsx scripts/catalogue/verify-data-step.mjs --step commerce --dataset production --before $PP
```
```bash
npx tsx scripts/catalogue/migrate-pack-history.mjs --dataset production --before $PP
```
```bash
npx tsx scripts/catalogue/migrate-pack-history.mjs --dataset production --before $PP --apply --approval d3-pack-history-staging-<stamp>
```
```bash
npx tsx scripts/catalogue/migrate-public-name.mjs --dataset production --before $PP
```
```bash
npx tsx scripts/catalogue/migrate-public-name.mjs --dataset production --before $PP --apply --approval d4-public-name-staging-<stamp>
```

Then: `unset SANITY_MIGRATION_TOKEN`, delete the production token in Sanity, record "revoked <date>" in the access register.

## 10. Verification after D4

```bash
npx tsx scripts/catalogue/snapshot-public-output.mjs --site https://tmz.it --paths /llms.txt,/sitemap.xml,/en/books,/it/libri,/de/buecher --out backups/catalogue/public-after.json
```
```bash
npx tsx scripts/catalogue/snapshot-public-output.mjs --compare backups/catalogue/public-before.json backups/catalogue/public-after.json
```
Must print `byte-equal`. In the dashboard the Catalogue is called "Catalogue" (intended, K-2). Each production report shows `marker=<timestamp>` and `audit=recorded`; check the four rows in Supabase → `catalogue_audit_log` for tmz.

## 11. Rule activation (C10-6 step 7)

Nothing to run: C6's new required rules (`primaryCategoryMissing`, price rules, `integrity.*`) switch on **per project** once `catalogueMigrations.taxonomy` and `catalogueMigrations.commerce` are both set — data presence, never a date. The reports show both markers for tmz. Projects created after R2 are born migrated (the install flow writes the markers).

---

## 12. Rollback (C10-7)

Code rollbacks are one release at a time. Data reverts use the step's `--revert` mode (dry run first, then `--apply`; production needs `--approval <Tom's decision reference>`) or the P′ export. Revert in reverse order (D4 → D1). A revert removes the step's marker.

| After | Data revert |
|---|---|
| D4 | `npx tsx scripts/catalogue/migrate-public-name.mjs --dataset production --revert --rollback $PP` then the same with `--apply --approval <ref>` — restores `navLabel` from P′ (= the `public_name.migrated.old` audit payload) and unsets a `publicName` that still equals the copy. A `publicName` edited since is kept and listed. |
| D3 | `npx tsx scripts/catalogue/migrate-pack-history.mjs --dataset production --revert` (+ `--apply --approval <ref>`) — deletes `catalogue-packs.<slug>` (`appliedPreset` was kept). Refuses if a real pack application was added to the history since. |
| D2 | `npx tsx scripts/catalogue/migrate-commerce.mjs --dataset production --revert --rollback $PP` (+ `--apply --approval <ref>`) — unsets `formats`/`channelAvailability` where still equal to the D2 output and restores `serviceChannels` from P′. Lossy cases (multi-format items, format rules, availability the legacy model cannot express, edits since D2) are listed and refused; `--accept-lossy` (Tom's approval) leaves them as they are. |
| D1 | `npx tsx scripts/catalogue/migrate-taxonomy.mjs --dataset production --revert` (+ `--apply --approval <ref>`) — unsets `primaryCategory`/`additionalCategories` where still equal to the D1 output; the taxonomy document stays (pre-R1 code ignores it). |
| R2 live, before D1–D4 | R2 → R1 is safe. R1 → pre-R1 is unsafe once R2 has written: `formatsToLegacyOffers` / `[primary, ...additional]` restore the legacy fields; taxonomy edits made through the service are lossy (hierarchy, rules, archived state) — **not scripted here** (it belongs to the R2 slice); listed and refused without `--accept-lossy` + Tom's approval. |
| R3 | Restore from the P′ export and re-apply edits made since (manual) — the reason R3 waits for Tom. |

A revert is verified by re-planning it on the result: it must plan nothing (`revert.complete`).
