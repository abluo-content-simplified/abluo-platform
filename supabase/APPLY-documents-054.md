# Apply — migration 054, Documents module (ADR-040 §15, R9)

**Status: NOT APPLIED. Prepared 2026-10-26. Applying needs Tom's explicit approval.**
Target: the shared Supabase project `xsdamzirepfqlutvqfbe`. Dev, preview and production all use it.

## Why it is safe to apply before the R9 code

054 is additive, and the code that is live today (B2.5, dev `6b2fc04`; production ignores Access entirely) keeps working unchanged:

- **Existing documents:** they become `visibility = 'groups'`, which is what they already are.
- **Unchanged functions:** every function the B2.5 code calls (`site_access_create_document`, `_begin_upload`, `_document_for_delivery`, …) keeps its signature and behaviour.
- **`site_access_finish_upload`:** keeps its signature and return value. For a B2.5 upload it does exactly what it did.
- **Files table:** the unique constraint on `site_access_document_files.storage_path` is replaced by a plain index. This only *allows* several languages to share one object, and the B2.5 code never does that.
- **Proof:** `supabase/verify/hardening-054.verify.mjs` has a "B2.5 code paths unchanged" block that runs a document created before 054 and the old functions after it.

## Proof (run right before applying)

```
cd supabase/verify && LANG=C.UTF-8 npx vitest run --config vitest.config.mjs hardening-050 hardening-051 hardening-052 hardening-053 hardening-054 hardening-rollback
```

Expect **107 tests** passing (2026-10-26: 107/107).

## Step (Supabase Dashboard → SQL editor)

1. Copy the file to the clipboard: `pbcopy < ~/Abluo/abluo-platform/supabase/migrations/054_documents_module.sql`
2. Paste it into a new query and Run. Confirm the "destructive operation" prompt. It appears because of the `drop constraint` / `drop function` statements inside the file. The file is one transaction: on any error, nothing changes.
3. The editor shows "Success. No rows returned". The notice `054 self-check passed` is not displayed there, so check with step 4.
4. Run this check:

```sql
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'site_access_%') as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'site_access_documents' and column_name in ('visibility','note','category_term_id','tag_term_ids')) as new_columns,
  (select count(*) from public.grantable_permissions where id like 'documents.%') as permissions,
  (select cardinality(allowed_mime_types) from storage.buckets where id = 'site-access-files') as file_types,
  (select count(*) from public.site_access_documents where visibility <> 'groups') as public_docs,
  has_function_privilege('anon', 'public.site_access_page_documents(uuid, text[])', 'EXECUTE') as anon_can_call;
```

Expected: **14 · 4 · 2 · 4 · 0 · false**.

Then record it in `supabase/APPLIED.md`.

## Rollback

`supabase/verify/rollback-054.sql` undoes 054 in one transaction and restores the catalog **exactly** to its 053 state, including the bucket's type list (proof: `hardening-rollback-054.verify.mjs`).

It **refuses** once anything only 054 can express exists:

- a public document;
- a note, category or tags;
- a placement;
- an image;
- a file shared by several languages;
- a 054 audit event;
- a `documents.*` extra on a membership.

Before rolling back 050–053 (`rollback-050-053.sql`), roll back 054 first.
