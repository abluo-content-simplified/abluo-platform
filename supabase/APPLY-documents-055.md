# Apply — migration 055, Documents: delete for good (ADR-040 §15.10, R9.3)

**Status: NOT APPLIED. Prepared 2026-10-27. Applying needs Tom's explicit approval.**
Target: the shared Supabase project `xsdamzirepfqlutvqfbe`. Dev, preview and production all use it.

## What it adds

- One service-role function, `site_access_delete_documents(project, ids[], actor)`. It deletes **archived** documents of one project for good: all or none, at most 100. Their files, groups, placements and uploads go with them, and the stored objects are queued for the daily sweep, which removes them from private storage.
- The trash reason `document_deleted` and the audit action `document_deleted` (the audit row keeps no title).

Who may call it is decided by the app: `documents.document.delete`, Owner only, never support.

## Why it is safe to apply before the code

It only adds a function and widens two check constraints. Nothing calls the function until the R9.3 code is deployed. The code that is deployed today never reaches it.

## Proof (run right before applying)

```
cd supabase/verify && LANG=C.UTF-8 npx vitest run --config vitest.config.mjs hardening-054 hardening-055 hardening-rollback
```

The 055 block alone is 9 tests. Expect every test passing.

## Step (Supabase Dashboard → SQL editor)

1. `pbcopy < ~/Abluo/abluo-platform/supabase/migrations/055_documents_delete.sql`
2. Paste into a new query and Run. Confirm the "destructive operation" prompt: it appears because of the `drop constraint` statements. The file is one transaction: on any error, nothing changes.
3. Check:

```sql
select
  has_function_privilege('service_role', 'public.site_access_delete_documents(uuid, uuid[], uuid)', 'EXECUTE') as service_can,
  has_function_privilege('anon', 'public.site_access_delete_documents(uuid, uuid[], uuid)', 'EXECUTE') as anon_can,
  has_function_privilege('authenticated', 'public.site_access_delete_documents(uuid, uuid[], uuid)', 'EXECUTE') as users_can;
```

Expected: **true · false · false**. Then record it in `supabase/APPLIED.md`.

## Rollback

`supabase/verify/rollback-055.sql` restores the catalog exactly, which is proven in `hardening-055.verify.mjs`. It refuses once a document has been deleted with 055. `rollback-054.sql` now refuses while 055 is applied.
