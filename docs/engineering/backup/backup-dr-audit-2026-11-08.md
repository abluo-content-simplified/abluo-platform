# Abluo — Backup & Disaster Recovery Architecture Audit

**Date:** 2026-11-08 · **Status:** Proposed — awaiting Tom's review and explicit approval. Nothing has been built, changed or run.
**Scope:** investigation and planning only. No code, migrations, provider settings, exports or restores were touched. No secret values or customer data are shown.

**Why we do this:** the pricing page says "Security and backup included". That line matters, but it's not the real reason. The real reason is that Tom should be able to **sleep at night**. Everything that matters is copied automatically, every night, to a place nobody can delete it from. If something breaks, we get an email. If nothing breaks, we hear nothing.

Legend: ✅ verified (code, API or provider docs) · ⚠️ assumption / strong evidence · ❓ needs a check in a provider dashboard

---

## 1. Executive summary

- **There is no automatic backup of anything today.** ⚠️ Supabase is almost certainly on the **Free plan**, and Free has no backups. The evidence is the `keep-alive` cron, which exists only to stop Free-tier pausing. Sanity Growth has document history but no backups, because Sanity's managed backups are Enterprise-only ✅. Supabase Storage files are never in any database backup, on any plan ✅.
- **The data is tiny:** about **65 MB** for one full copy (measured today). So storage is not a cost question. Retention is a GDPR question.
- **Recommendation:**
  - A **nightly GitHub Actions job** exports Sanity (documents and media), dumps the Supabase database (including logins), and copies Supabase Storage files.
  - It encrypts the backup and uploads it to a dedicated **Cloudflare R2 bucket in the EU**. A **bucket lock** stops anyone from deleting or overwriting a backup before it expires. **Lifecycle rules** remove old backups automatically.
  - Retention is **7 daily, 4 weekly and 6 monthly** copies.
  - A free **dead-man check** emails Tom if a night is missed. A **monthly automated restore test** proves the backups actually work.
- **Cost:** about **€0/month** at today's size. Later, add **Supabase Pro ($25/month)** as a second, managed safety net once there are paying clients. PITR (~$100/month) is not justified yet.
- **The most urgent gap (P0)** is the Supabase database: form submissions, bookings, logins, support tickets and protected PDFs. Content in Sanity is partly protected by its history. Supabase data has no protection at all.

---

## 2. Current architecture inventory

### 2.1 Measured data volume (2026-11-08)

| Store | What | Count | Size |
|---|---|---|---|
| Sanity `production` (project `3n7t84j3`) ✅ | Documents, incl. 10 `project` docs | 897 docs | a few MB as NDJSON |
| Sanity assets ✅ | Images / files | 244 / 2 | 42.0 MB / 6.8 MB → **~49 MB** |
| Sanity `staging` ✅ | Rehearsal dataset (Catalogue R2) | — | not part of the backup scope |
| Supabase DB (`xsdamzirepfqlutvqfbe`, Ireland) ✅ | 65 tables exposed via the API | ~1,900 rows | est. 1–5 MB dumped ⚠️ |
| Supabase Auth ✅ | Login accounts | 8 | negligible |
| Supabase Storage ✅ | `avatars` (public) 1 file · `product-updates` (public) 0 · `support-attachments` (private) 8 · `site-access-files` (private) 8 | 17 files | **~12 MB** |
| Cloudflare Stream ✅ (code) / ❓ (count) | Hero and section videos (`customer-aayaptcudal3r1fx`) | ❓ | ❓ |

**One full backup ≈ 65 MB.** Images don't compress, so a compressed copy is about the same size. With 7 + 4 + 6 = 17 copies kept, the total is about **1.1 GB at most**. That is still far below R2's 10 GB free tier.

Largest tables by rows: `analytics_snapshots` 566, `admin_audit_log` 416, `content_audit_log` 212, `event_occurrences` 126, then a long tail (`form_submissions` 26, …).

### 2.2 Component table

| Component | Provider | Data stored | Existing protection | Risk |
|---|---|---|---|---|
| CMS content | Sanity, Growth plan ✅ | Pages, posts, events, catalogue, people, FAQs, design systems, siteConfig, project/client docs | Document history (restore one document in Studio) ✅. Retention window on Growth ❓. **No dataset backup** (Enterprise-only) ✅ | **High.** A bad migration or script, a deleted dataset or a token misuse could lose everything. History doesn't help if the dataset is gone. |
| CMS media | Sanity asset CDN ✅ | 246 images/files | None beyond Sanity itself | **High.** A deleted asset is gone. |
| Operational DB | Supabase Postgres, Ireland ✅. **Free plan** ⚠️ | Projects, memberships, forms and submissions, bookings/reservations, scheduling, billing mirror, support tickets, site access, private person data, testimonials-private, audit logs, analytics | **None** ⚠️ (Free = no backups ✅) | **Critical.** Shared by dev, preview and prod, and every migration hits production directly. |
| Auth | Supabase Auth ✅ | 8 accounts, password hashes, MFA factors | Same as the DB: none ⚠️ | **High.** Losing it locks everyone out. |
| File uploads | Supabase Storage ✅ | Avatars, support attachments, protected PDFs | **None.** Even Pro backups exclude Storage objects ✅ | **High** for the private PDFs (the tenant's originals may not exist elsewhere). |
| Video | Cloudflare Stream ✅ | Hero / section videos | None known ❓ (are originals kept somewhere?) | **Medium.** Re-uploadable only if the originals still exist. |
| Source code | GitHub `abluo-content-simplified/abluo-platform` ✅ | Code, migrations, docs, `vercel.json`, release tags | Git history plus Tom's local clone ✅ | **Low.** |
| Deployments | Vercel, team tmz, Hobby ✅ | Built deployments, domains, crons | Instant rollback to earlier deployments ✅ | **Low** for code. A rollback does **not** undo data changes. |
| Env vars / secrets | Vercel project env ✅, `.env.local` | API keys, service role key, Sanity tokens, `CRON_SECRET`, salts | `.env.local` on Tom's Mac only ⚠️ | **Medium.** Most keys can be regenerated, but `ACCESS_IP_SALT` and webhook secrets need care. |
| Scheduled jobs | Vercel Cron, 8 jobs ✅ | No data of their own | Defined in git ✅ | **Low.** |
| Client source material | `~/Abluo/clients/…` on Tom's Mac | Migration archives, briefs, brand assets | ❓ Time Machine / iCloud? | **Medium.** Out of platform scope, but worth one question. |
| Billing | Stripe ✅ | Customers, subscriptions, invoices | Stripe is the source of truth. The Supabase copy is a mirror (`billing-sync`) | **Low.** |
| Email | Resend ✅ | Delivery logs | Not business data | **Low.** |

---

## 3. Existing backup capabilities — what each one really is

| Mechanism | Type | Protects against | Doesn't protect against |
|---|---|---|---|
| Sanity document history | **Version history** | A wrong edit, or a deleted single document (within the retention window ❓) | A deleted dataset, account loss, a mass delete across hundreds of docs (impractical to undo), assets |
| Sanity managed backups | Backup | — | **Not available on Growth** (Enterprise only ✅) |
| Supabase daily backups | Backup | — | **Not available on Free** ✅. On Pro: 7 days, database only, no Storage ✅ |
| Supabase PITR | Backup (continuous) | — | Not enabled. Paid add-on (~$100/month for 7 days ✅). Replaces daily backups when on ✅ |
| Vercel instant rollback | **Deployment rollback** | Bad code | Bad data, deleted data, failed migrations |
| Git | Version history of code | Lost code | Any data |
| `sanity dataset export` before risky migrations | Manual backup ✅ (in MIGRATION.md / RENAME.md / Catalogue RUNBOOK) | That one migration | Everything else. It also lives on the Mac, not off-site |
| Supabase replication | — | None in use. Replication is **not** a backup anyway, because a delete replicates too | — |

**Conclusion:** today the only things that exist are version history and deployment rollback. Neither of them is a backup.

---

## 4. Gaps and risks — scenario by scenario

| # | Scenario | Protection today | Recoverable now? | What would be lost | What's needed | Affects other tenants? |
|---|---|---|---|---|---|---|
| 1 | One page / CMS document deleted | Sanity history | ✅ usually, in Studio | Nothing, if within history retention ❓ | Nightly export as a second layer | No |
| 2 | Entire tenant deleted (Sanity docs + `projects` row) | Sanity history doc by doc; **nothing for Supabase** | ❌ for Supabase | All of that tenant's form submissions, bookings, schedules, memberships, access groups and PDFs. **Deleting a `projects` row cascades** into ≥ 20 tables (`on delete cascade`, verified in migrations) | Nightly DB dump + a per-project restore script | No, if restore is per project |
| 3 | DB records deleted or corrupted | None | ❌ | Everything since… forever | Nightly dump (RPO 24 h). Later Supabase Pro | Depends: a table-wide mistake hits all tenants |
| 4 | Failed migration | Additive-migration discipline, Sandbox rehearsals, rollback SQL for some (e.g. 050–053) | ⚠️ partial: rollback SQL refuses once data exists, by design | Data written by or after a destructive step | Pre-migration snapshot step (automatic dump before each apply) + nightly dump | **Yes**: one shared DB, so all tenants at once |
| 5 | Failed production deployment | Vercel instant rollback + `promote.sh` gates | ✅ code | Data written by the bad code (e.g. the 2026-08-14 outage pattern) | Rollback + data restore if the code wrote bad data | Yes, platform-wide |
| 6 | Compromised credentials / malicious delete | None. The service role key and Sanity write token can delete everything | ❌ | Everything | **Off-site, delete-locked backups** that the production keys can't reach | Yes |
| 7 | Loss of CMS data or media | None beyond Sanity | ❌ | All content and images | Nightly export **with assets** | Yes |
| 8 | Loss of a provider (account closed, outage, billing lapse) | None | ❌ | Everything at that provider | Backups at a **different** provider + a rebuild runbook | Yes |
| 9 | Restore the whole platform | No procedure | ❌ | — | Runbook + tested restore | — |
| 10 | Restore one tenant only | No procedure | ❌ | — | Per-project export/import scripts (P2) | Must not, by design |

**Tenant isolation:**
- Supabase rows carry `project_id`, and children use composite foreign keys. A dump can therefore be filtered per project.
- Sanity docs carry `projectSlug`, so the export NDJSON can be filtered the same way.
- Two things are shared and need care in a single-tenant restore:
  - **Template design systems** (no `projectSlug`).
  - **Sanity assets**, which belong to no project directly. They are shared via references.

---

## 5. Recommended backup architecture

### 5.1 Overview

```
 GitHub Actions (nightly 02:30 Europe/Rome, scheduled workflow)
   ├─ Sanity:   sanity dataset export production  → data.ndjson + images/ + files/ (.tar.gz)
   ├─ Supabase: pg_dump (custom format) of the database incl. auth + storage metadata
   ├─ Storage:  download all objects of the 4 buckets via the Storage API
   ├─ manifest.json: counts, sizes, SHA-256 of each file, versions, timestamp
   ├─ encrypt (age, public key only on GitHub)
   ├─ upload → Cloudflare R2 bucket "abluo-backups" (EU jurisdiction)
   │             daily/YYYY-MM-DD/…   weekly/YYYY-Www/…   monthly/YYYY-MM/…
   ├─ verify: re-download manifest, compare checksums and minimum counts
   └─ ping Healthchecks.io  (no ping within 26 h → email to Tom)
```

### 5.2 Why GitHub Actions runs it

- **Independent of Vercel.** It still works when Vercel is down, when a deploy is broken, or on Hobby limits. A function also can't run a 65 MB export within Vercel's limits comfortably.
- Already in use (`ci.yml`), free, and logged. Every run is kept with its logs, which gives an audit history for free.
- **Two caveats:**
  - GitHub disables scheduled workflows in repos with no activity for 60 days. That's not a risk while we commit daily, and the dead-man check catches it anyway.
  - The schedule can drift by minutes. That's harmless.
- A **separate private repo** (`abluo-backups-runner`) holding only the workflow is cleaner. Its secrets (read-only tokens) then don't sit next to the platform code. This is recommended but optional.

### 5.3 What each job does

**Sanity**
- `sanity dataset export production` with a **dedicated read-only robot token** (Viewer role).
- Includes drafts and **all image/file assets**. References and `projectSlug` are preserved as-is.
- History and comments are not exported (no tool can export them). That's fine, because history stays in Sanity.
- The `staging` dataset is not backed up. It's a rehearsal copy.

**Supabase database**
- `pg_dump` in custom format over the **session pooler** connection, as a dedicated read-only role ❓ (Supabase supports custom roles; to be confirmed in implementation).
- It covers schema + data for `public`, `auth` (logins, MFA) and `storage` metadata.
- The pg_dump major version must match the server's Postgres version ❓.

**Supabase Storage**
- List and download every object in the 4 buckets with a key used only for this job.
- Small today (12 MB), so a full copy each night is fine. It switches to "only changed files" once it exceeds ~1 GB.

**Cloudflare Stream** (P2)
- Keep the **original video files** in the same R2 bucket under `stream-originals/`. These are kept until deleted by hand, not on the 6-month cycle.
- Stream itself is not a backup of the originals.

**Secrets**
- Not in the backup bucket.
- One "Abluo – environment" entry in Tom's password manager, updated whenever a key changes (the rotation runbook from 2026-10-26 already has this step).

### 5.4 Where to store the backups — Cloudflare R2 vs Amazon S3

Today Abluo uses **Cloudflare for video** (Stream ✅). Amazon is in the code only as **Amazon Associates** (affiliate links), not AWS, so there's no AWS account in use ⚠️.

| | **Cloudflare R2** | **Amazon S3** |
|---|---|---|
| Existing account | ✅ yes (Stream) | ❌ new account, billing, IAM |
| Cost at our size | **€0**: 10 GB/month free, then $0.015/GB ❓ verify | Cents, but **egress fees** on every restore/download |
| Restore cost | No egress fees | Paid per GB downloaded |
| EU data location | ✅ EU jurisdiction bucket | ✅ eu-south-1 (Milan) / eu-central-1 |
| Delete protection | ✅ **Bucket locks** (retention rules per prefix) | ✅ Object Lock (more mature, compliance mode) |
| Auto-delete old copies | ✅ Lifecycle rules | ✅ Lifecycle rules |
| Complexity | Low | Medium–high (IAM policies, KMS, Object Lock config) |

**Recommendation: Cloudflare R2**, in a bucket used only for backups, with:
- **EU jurisdiction**, so the data stays in the EU (GDPR) ✅.
- A **bucket lock** per prefix, so nobody can delete or overwrite a backup during its retention period: `daily/` 7 days, `weekly/` 28 days, `monthly/` 180 days. That includes Tom, a leaked token, and a buggy script.
- **Lifecycle rules** delete each object one day after its lock ends (8 / 29 / 181 days).
- **An API token scoped to that one bucket**, object read/write only, stored only as a GitHub secret. Even if this token leaks, the lock stops deletion.
- **Client-side encryption with `age`.** GitHub holds only the **public** key, so it can encrypt but not decrypt. The **private** key lives in Tom's password manager plus one offline copy. Even someone with Cloudflare access then can't read customer data.

**The one trade-off:**
- Videos and backups would sit in the same Cloudflare account. Protect it with **2FA (hardware key or passkey)** on the Cloudflare login.
- If Tom wants full independence later, the same setup moves to a separate Cloudflare account or to S3 with one config change.
- At today's risk level, one account with a bucket lock is the right balance. AWS would add an account, IAM and egress fees for no real gain at 65 MB.

---

## 6. Backup frequency and retention

| Copy | When | Kept | Count |
|---|---|---|---|
| Daily | every night, 02:30 | 7 days | 7 |
| Weekly | Sunday's nightly, promoted (copied) | 4 weeks | 4 |
| Monthly | 1st of the month's nightly, promoted | 6 months | 6 |
| Pre-migration | automatically before each production migration (P1) | 30 days | as needed |

**Why not the brief's 7 / 8 / 12?** Technically and cost-wise it would be fine (~2 GB). The reason to shorten it is GDPR:
- Backups contain personal data: form submissions, bookings, private person data, logins.
- Every extra month is a month in which a deleted person's data still exists.
- 6 months covers the realistic "we noticed late" cases.

If Tom prefers a year of history for **website content only** (Sanity, mostly public), the monthly Sanity copies can be kept for 12 months under a separate prefix. Optional.

**PITR:** not now. RPO 24 h is acceptable for content sites at this stage. Reconsider when bookings/payments run at volume: either Supabase Pro + PITR, or Pro daily backups + the off-site nightly.

---

## 7. Recovery strategy

**A rollback is not a restore.**
- A **rollback** (Vercel instant rollback, `git revert`) brings back old **code**. Data stays as it is.
- A **restore** brings back old **data**. Code stays as it is.
- Failures like 2026-08-14 (data migrated ahead of the code) need the right one, sometimes both. A restore also overwrites everything written after the backup, so it's never the first move when a rollback is enough.

| # | Scenario | Procedure | RPO | RTO |
|---|---|---|---|---|
| 1 | One CMS document | Studio → History → restore. If outside history: take the doc from last night's NDJSON and create it with the same `_id` | 0 (history) / 24 h | 5–15 min |
| 2 | One tenant's website + data | Download the backup → filter NDJSON by `projectSlug` (+ referenced assets) → `sanity dataset import --replace` for those IDs only. Filter the dump by `project_id` → load into a temp schema → upsert into live tables in FK order. Re-upload that project's Storage objects | 24 h | 1–3 h (P2 script: 30 min) |
| 3 | Deleted DB records | Restore the dump into **Abluo Sandbox** or a temp schema, never straight into production → copy the missing rows back with `insert … on conflict do nothing` | 24 h | 30–90 min |
| 4 | Failed migration | First: rollback SQL if one exists and no data depends on it. Else: the pre-migration snapshot → restore only the affected tables, after reviewing what was written since | 0 (pre-migration snapshot) / 24 h | 30 min – 2 h |
| 5 | Whole platform | Restore Sanity (`import` into an empty dataset, then point the env var at it, or replace `production`), restore the full dump into a new/clean Supabase project, re-upload Storage, re-point env vars, redeploy | 24 h | 4–8 h |
| 6 | Provider loss / rebuild | Runbook: new Supabase project (Ireland) → run migrations 001–0xx from git → load the data dump → new Sanity project/dataset → import → Storage → secrets from the password manager → Vercel env → redeploy → DNS untouched (domains stay in Vercel) | 24 h | 1–2 days |

**Rules for restores**:
- Never restore over production without a **fresh backup of the current state** first.
- Restore into a **side copy**, compare, then merge forwards.
- A tenant restore touches only rows with that `project_id` / `projectSlug`. Shared docs (template design systems, assets used by others) are **never** replaced by a tenant restore.
- Logins (`auth.users`) are restored only in a full-platform restore. Otherwise passwords changed since the backup would be reverted.

---

## 8. Security and GDPR

- **Encryption:** age (client-side, before upload) plus R2 encryption at rest. The private key never touches GitHub, Vercel or the backup bucket.
- **Least privilege:**
  - read-only Sanity robot token;
  - read-only DB role ❓;
  - Storage read key;
  - an R2 token for that one bucket only.
  - **None of them is a production write key.**
- **Protection against a compromised production key:** the production keys (Supabase service role, Sanity write token) have **no access** to R2, and the bucket lock blocks deletes even with the R2 token.
- **Access:** only Tom (Cloudflare 2FA). Restores need the private key from the password manager, i.e. Tom.
- **GDPR:**
  - **Retention** of 6 months, stated in the Abluo privacy policy / DPA ("backups are kept for up to 6 months and then deleted automatically").
  - **Erasure requests:** standard practice (and accepted by EU regulators) is to **not edit old backups**. Instead we keep an **erasure log** (in Supabase: subject + date + what was erased). After any restore, the log is re-applied **before** the restored data goes live. The backups expire on their own within 6 months.
  - **Location:** EU only (Supabase Ireland, R2 EU jurisdiction). Sanity's hosting region and the GitHub runner (US) only *pass through* encrypted or exported data, so mention it in the DPA's sub-processor list ❓.
  - **Tenants as controllers:** the tenant's privacy policy can say "the provider keeps encrypted backups for up to 6 months". A sentence for the tenant legal documents template.

---

## 9. Estimated costs

| Item | Cost | Status |
|---|---|---|
| Cloudflare R2: ~1.1 GB, a few thousand operations/month | **$0** (free tier 10 GB, 1M class-A ops) | ❓ verify current R2 pricing |
| GitHub Actions: ~3–5 min/night ≈ 150 min/month | **$0** (within free minutes for private repos) | ❓ verify the org's plan/minutes |
| Healthchecks.io: 2 checks (nightly backup, monthly restore test) | **$0** (free hobby tier) | ❓ verify |
| Supabase Pro (recommended once there are paying clients; also ends the pause risk the `keep-alive` cron works around) | **$25/month** | ❓ verify; also check compute credits |
| Supabase PITR 7 days | ~$100/month | ✅ (docs) · **not recommended now** |
| Sanity Enterprise (for managed backups) | sales quote | Not needed: our own export does the same |
| Maintenance | ~0 routine. ~1 h/quarter to read the restore-test report; a bit more when Supabase upgrades Postgres (pg_dump version) | — |

**Total today: €0/month.** It becomes $25/month when Supabase moves to Pro, which is advisable anyway.

---

## 10. Prioritised implementation roadmap

### P0 — Critical (irreversible-loss risks)

| Item | What | Systems / files | Complexity | Test |
|---|---|---|---|---|
| P0-1 | **Confirm the Supabase plan** (Dashboard → Billing). If Free, there are no backups at all → P0-2 is urgent | Supabase dashboard | 1 min | — |
| P0-2 | **First nightly backup to R2**: Sanity export + pg_dump + Storage copy, encrypted, with the manifest | New workflow (separate repo or `.github/workflows/backup.yml`), R2 bucket, 5 GitHub secrets | Medium (1 session) | First run, then download and decrypt one backup by hand and check counts against production |
| P0-3 | **Bucket lock + lifecycle rules** on R2 (7/28/180 days, delete +1) | Cloudflare dashboard (or API) | Low | Try to delete a fresh object with the job's token → must fail |
| P0-4 | **Private key + secrets in the password manager**, plus one offline copy | Tom | Low | A restore drill needs only the password manager |

### P1 — Essential

| Item | What | Complexity | Test |
|---|---|---|---|
| P1-1 | **Dead-man monitoring**: Healthchecks.io ping on success, email on a miss (> 26 h). GitHub failure emails on | Low | Pause the workflow for a day → email arrives |
| P1-2 | **Weekly/monthly promotion** (copy, not move) + verify step (checksums, minimum counts: docs ≥ 90% of yesterday, etc. — a sudden drop fails loudly) | Low | Simulate a "half-empty" export → job fails |
| P1-3 | **Monthly automated restore test**: restore the latest backup into **Abluo Sandbox** + a scratch Sanity dataset `restore-test`. Compare counts per table/type and per project. Post the result to Healthchecks. Then wipe the scratch copy | Medium | Its own report. Wipe verified. Never targets production (`assertSandboxSupabase`-style guard) |
| P1-4 | **Pre-migration snapshot**: `scripts/backup-now.sh` (same job, `workflow_dispatch`), run by `APPLY-*.md` runbooks before every production migration | Low | Run once before the next migration |
| P1-5 | **Runbook** `docs/engineering/backup-and-restore.md`: scenarios 1–6 from §7, step by step | Medium | Walk through scenario 3 on Sandbox |
| P1-6 | **Erasure log** + privacy-policy sentence (6 months) | Low–medium | Re-apply the log after the restore test |
| P1-7 | **Supabase Pro** when the first client pays (pause risk + managed daily backups as a second layer) | Billing | — |

### P2 — Improvements

| Item | What |
|---|---|
| P2-1 | **Single-tenant restore scripts** (Sanity filter by `projectSlug` + referenced assets; DB by `project_id` in FK order; Storage by path prefix), tested on Sandbox |
| P2-2 | **Cloudflare Stream originals** archived in R2 (`stream-originals/`), plus a check that every Stream video has an original |
| P2-3 | "Last successful backup" line on the Admin dashboard (reads the manifest; read-only) |
| P2-4 | Incremental Storage copy once it exceeds ~1 GB |
| P2-5 | Reconsider PITR when bookings/payments volume grows |
| P2-6 | Optional: move the backups to a separate Cloudflare account for full independence |

**Dependencies:**
- P0-1 → P0-2 → P0-3. P1-1, P1-2 and P1-3 need P0-2.
- P1-3 needs the Abluo Sandbox project (exists ✅) and a scratch dataset.
- P2-1 needs P1-3 green.

**Risks:**
- The dump job's credentials are sensitive (read access to all personal data). Hence the separate runner repo and read-only roles.
- The restore test must never point at production. Hard guard + separate secrets.

---

## 11. Open questions — need a dashboard check

1. **Supabase plan** for `xsdamzirepfqlutvqfbe`: Free or Pro? (Evidence says Free.) Postgres major version?
2. **Sanity Growth history retention**: how many days? (Sanity's backup docs don't state it.)
3. **Cloudflare**: which account holds Stream? Is 2FA on? Is R2 enabled? Confirm the EU-jurisdiction bucket option and current free-tier limits.
4. **Stream videos**: how many, and do the originals exist anywhere else?
5. **GitHub org plan**: Actions minutes for private repos. OK to create a private `abluo-backups-runner` repo?
6. **Password manager**: which one (1Password / Apple Passwords / Bitwarden)? Where should the offline key copy go?
7. **Supabase custom read-only role** for pg_dump: allowed on the plan in use?
8. **`~/Abluo/clients/…`** (outside platform scope): covered by Time Machine / iCloud?
9. **Pricing page wording** "Security and backup included": keep, or add "daily, encrypted, kept in the EU for 6 months" once P0/P1 are live?

---

## Final recommendation

> **If Abluo were to implement its backup system today, this is the architecture we should choose:** a nightly, scheduled GitHub Actions job exports the Sanity dataset with all media, dumps the Supabase database including logins, and copies Supabase Storage. It encrypts everything with a key only Tom can use to decrypt and uploads it to a dedicated, EU-located **Cloudflare R2** bucket. **Bucket locks** make each copy undeletable for its lifetime, and **lifecycle rules** delete it afterwards (7 daily, 4 weekly, 6 monthly). A dead-man check emails Tom if a night is missed, and a monthly automated restore into Abluo Sandbox proves the copies work.
>
> **Why:** it covers the one real hole today (Supabase has no backup at all) and protects against the scenarios that hurt most (a bad migration, a leaked key, a lost provider). It uses accounts Abluo already has, costs nothing at today's ~65 MB, and needs no routine attention. That's what "backup included" should mean: Tom sleeps at night. Supabase Pro joins as a managed second layer when the first client pays. PITR and Sanity Enterprise wait until the scale justifies them.

**Next step:** Tom reviews and answers §11 (at least Q1, Q3, Q5, Q6). After explicit approval, the build of P0 starts.

---

Sources: [Supabase – Database Backups](https://supabase.com/docs/guides/platform/backups) · [Supabase – Free plan backups](https://supabase.com/kb/faqs/platform/free-plan-backups) · [Supabase – PITR usage](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery) · [Sanity – Backups](https://www.sanity.io/docs/content-lake/backups) · [Sanity – History](https://www.sanity.io/docs/user-guides/history-experience) · [Cloudflare R2 – Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) · [Cloudflare R2 – Pricing](https://developers.cloudflare.com/r2/pricing/)
