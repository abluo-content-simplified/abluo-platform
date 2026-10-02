// Proof that the rollback in supabase/APPLY-2026-10-02.md works: snapshot the
// (drifted) pre-028 state with rollback-snapshot-028.sql, apply 028, replay the
// snapshot, and confirm the pre-028 privileges are back. Local Postgres only.
//   cd supabase/verify && node rollback-028-proof.mjs
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'
import { readFileSync } from 'node:fs'
const M = (f) => new URL('../migrations/' + f, import.meta.url).pathname
const { client } = await startHarness()
for (const f of ['014_inquiries_authz.sql','015_profiles_select_grant.sql','016_form_submissions.sql','017_form_events.sql','018_form_tables_service_role_grants.sql','019_form_events_env_and_status.sql','024_handle_new_user_invite_only.sql','026_drop_leads.sql','027_translation_usage.sql']) await applyMigrationFile(client, M(f))
await client.query(`grant all on public.project_members to anon; grant execute on function public.get_my_project_ids() to anon;`)
const snap = (await client.query(readFileSync(new URL('./rollback-snapshot-028.sql', import.meta.url).pathname, 'utf8'))).rows[0].rollback_sql
const count = async () => (await client.query(`select count(*)::int n from pg_policies where schemaname='public'`)).rows[0].n
const before = await count()
const anonPM = async () => (await client.query(`select has_table_privilege('anon','public.project_members','INSERT') a, has_function_privilege('anon','public.get_my_project_ids()','EXECUTE') f`)).rows[0]
console.log('before', before, await anonPM())
await applyMigrationFile(client, M('028_security_hardening.sql'))
console.log('after028', await count(), await anonPM())
await client.query(`begin; do $$ declare r record; begin for r in select tablename, policyname from pg_policies where schemaname='public' loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop; end $$; ${snap} commit;`)
console.log('rolledback', await count(), await anonPM())
await stopHarness(client)
