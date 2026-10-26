# Apply — Site Access migrations 050–053 (ADR-040)

**Status: NOT APPLIED. Prepared in B2.6 Stage 1 (2026-10-24). Applying needs Tom's explicit approval.**
Target: the shared Supabase project `xsdamzirepfqlutvqfbe` (dev, preview and production all use it).

## What they do

All four are additive and touch nothing outside the Access objects, except two rows in `grantable_permissions`. This is proven against a real Postgres: a catalog snapshot is taken before and after applying, and the two must be identical.

| # | File | Adds | Needs |
|---|---|---|---|
| 050 | `050_site_access.sql` | 11 `site_access_*` tables, 13 functions, triggers, and the private bucket `site-access-files` (PDF only, 20 MB) | 005 (`set_updated_at`), `projects` |
| 051 | `051_site_access_grantable.sql` | 2 rows in `grantable_permissions` (`members.access.read` / `.manage`) | 029 |
| 052 | `052_site_access_documents.sql` | `site_access_uploads`, `site_access_storage_trash`, 11 functions; widens the audit check on its own table | 050 |
| 053 | `053_site_access_session_summary.sql` | 1 read-only function (signed-in counts) | 050 |

Every table has RLS on and **no** grants to `anon` or `authenticated`. Every function is executable by `service_role` only. Each file runs as one transaction, refuses to run twice, and ends with a self-check that rolls everything back if the result is wrong.

**State on 2026-10-24.** These were read-only checks: one OpenAPI GET and three selects with the service role.
- 049 is applied.
- No `site_access_*` table or RPC exists.
- No `members.access.*` rows exist in `grantable_permissions`.
- The existing buckets are `avatars`, `product-updates` and `support-attachments`, so there is no name clash.

## Before applying

1. **Code first (the 2026-08-14 rule).** The Access code must be deployed where it will be tested (dev) before the tables exist. Production on v1.0.66 never references these objects, so applying does not change it. The Access code also handles both states: a missing table shows "Access is almost ready", and the cron skips quietly.
2. **Storage limit.** In Supabase → Settings → Storage, the project-wide upload limit must be at least 20 MB.
3. **Proof re-run.** Run this locally right before applying, in `supabase/verify`:
   `LANG=C.UTF-8 npx vitest run --config vitest.config.mjs hardening-050 hardening-051 hardening-052 hardening-053 hardening-rollback`
   Expect 79 tests to pass.

## Steps (Supabase Dashboard → SQL editor, one file per run, in this order)

1. Paste `050_site_access.sql` and run it. Expect the notice `050 self-check passed`.
2. Paste `051_site_access_grantable.sql` and run it. Expect `051 self-check passed`.
3. Paste `052_site_access_documents.sql` and run it. Expect `052 self-check passed`.
4. Paste `053_site_access_session_summary.sql` and run it. Expect `053 self-check passed`.

If any file errors, stop there. That file's transaction has already rolled itself back, and the earlier files are complete on their own.

## After applying (read-only)

```sql
select count(*) from pg_tables where schemaname = 'public' and tablename like 'site_access_%';   -- 13
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'site-access-files';  -- false, 20971520, {application/pdf}
select id from public.grantable_permissions where id like 'members.access.%';                     -- 2 rows
select has_function_privilege('anon', 'public.site_access_resolve(uuid, text, text, boolean)', 'EXECUTE');  -- false
```

Then record all four in `supabase/APPLIED.md`.

## Rollback

`supabase/verify/rollback-050-053.sql` removes all four migrations in one transaction (the proof is `hardening-rollback-050-053.verify.mjs`). It works after a partial apply too.

It **refuses** in two cases:
- any group, password, visitor session or document exists — it never destroys real access data;
- a membership still holds an Access extra.

The empty bucket must then be removed through Dashboard → Storage, because Supabase does not allow direct SQL deletes on storage tables.
