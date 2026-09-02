#!/usr/bin/env node
// ===========================================================================
// applied-check.mjs — which migrations are ACTUALLY applied to the live DB?
// ===========================================================================
//
// WHY THIS EXISTS
// ---------------
// `supabase/APPLIED.md` is a hand-maintained ledger and it has been provably
// wrong: `010_project_member_invite_trigger.sql.draft`, whose own header says
// "NOT APPLIED", was found running in production on 2026-09-02. A ledger that
// can be wrong about one row cannot be trusted about any row.
//
// This project has no Supabase CLI and no `supabase_migrations.schema_migrations`
// table, so there is nothing to ASK. Instead this tool DERIVES the answer: for
// each migration it names a FINGERPRINT — something observable in the live
// catalog that is true if and only if that migration ran — and reports the
// observation.
//
// HONESTY RULE (the whole point): where a migration leaves no distinguishable
// trace, this tool reports UNDETERMINABLE and says why. It never invents a weak
// signal. A confident wrong answer is what produced the current mess.
//
// TWO TIERS, BECAUSE PostgREST DOES NOT EXPOSE pg_catalog
// -------------------------------------------------------
//   Tier 1 (automatic, no human)  — PostgREST's OpenAPI document at
//       GET /rest/v1/ with the service-role key. It is generated from the LIVE
//       catalog and carries: every exposed table, every column, type, NOT NULL,
//       default, PK/FK, every exposed RPC, and — decisively — the live
//       `comment on table` / `comment on column` text. Several migrations
//       rewrite a comment, which makes the comment a genuine fingerprint.
//   Tier 2 (one paste, by Tom)    — policies, GRANTs, function bodies,
//       triggers and constraints are invisible to PostgREST. `--sql` emits ONE
//       read-only SQL statement for the dashboard SQL editor that returns a
//       single JSON cell, one object per migration, with its own verdict.
//       Feed that back with `--merge <file>` to get the combined table.
//
// This tool is STRICTLY READ-ONLY. Tier 1 issues one GET. Tier 2 emits a single
// SELECT (no DDL, no temp objects, no writes) that Tom runs himself.
//
// USAGE
// -----
//   node applied-check.mjs                 # Tier 1 against the live project
//   node applied-check.mjs --sql           # write applied-check.sql for Tier 2
//   node applied-check.mjs --merge out.json  # Tier 1 + pasted Tier 2 results
//   node applied-check.mjs --json          # machine-readable
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the repo's
// .env.local (or the environment). Never prints either.
//
// Conventions: matches supabase/verify/ — ESM .mjs, node builtins only (no new
// dependency; `fetch` is global on Node 18+), own package.json script.
// ===========================================================================

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VERIFY_DIR = __dirname
const REPO_ROOT = path.resolve(VERIFY_DIR, '..', '..')
const SQL_OUT = path.join(VERIFY_DIR, 'applied-check.sql')

// Verdict vocabulary. Keep it small and unambiguous.
const APPLIED = 'APPLIED'
const NOT_APPLIED = 'NOT APPLIED'
const PARTIAL = 'APPLIED (NOT VERBATIM)' // object present, file's own COMMENT text absent
const UNDET = 'UNDETERMINABLE'
const NEEDS_CATALOG = 'NEEDS CATALOG (run --sql)'

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
function loadEnv() {
  const out = { ...process.env }
  try {
    const raw = readFileSync(path.join(REPO_ROOT, '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!m) continue
      let v = m[2].trim().replace(/^["']|["']$/g, '')
      if (out[m[1]] === undefined) out[m[1]] = v
    }
  } catch {
    /* .env.local absent — fall back to the ambient environment */
  }
  return out
}

// ---------------------------------------------------------------------------
// TIER 1 — fingerprints readable from PostgREST's OpenAPI document
// ---------------------------------------------------------------------------
// Each entry: { id, file, fingerprint, run(ctx) -> { observed, verdict, note? } }
// ctx = { defs, rpcs }
const REMOTE_CHECKS = [
  {
    id: '001',
    fingerprint: 'column public.leads.lead_status exists',
    run: ({ defs }) => {
      const present = has(defs, 'leads', 'lead_status')
      if (!present) return { observed: 'leads.lead_status absent', verdict: NOT_APPLIED }
      return {
        observed: 'leads.lead_status present',
        verdict: UNDET,
        note:
          'Effect IS present live. But schema.sql also declares lead_status, so the ' +
          'column cannot distinguish "the 001 file ran" from "schema.sql was run". ' +
          '001 adds no comment and no other object, so nothing can. File-level: undeterminable.',
      }
    },
  },
  {
    id: '002',
    fingerprint: 'table public.projects exists; its table comment text',
    run: ({ defs }) => {
      if (!defs.projects) return { observed: 'projects table absent', verdict: NOT_APPLIED }
      return {
        observed: 'projects table present, ' + Object.keys(defs.projects.properties).length + ' columns',
        verdict: UNDET,
        note:
          'Effect present. schema.sql creates the same table with a byte-identical ' +
          'comment, so the catalog alone cannot separate them. Its seed INSERTs are ' +
          'data, not catalog, and are not a safe fingerprint. See the 004 note: there ' +
          'is strong INFERENTIAL evidence schema.sql was never run here at all (it ' +
          'uses bare CREATE TABLE, which would have failed), in which case this table ' +
          'came from the 002 file — but that is reasoning, not an observation.',
      }
    },
  },
  {
    id: '003',
    fingerprint: 'table public.tenant_members + its comment + role column comment',
    run: ({ defs }) => {
      if (!defs.tenant_members) return { observed: 'tenant_members absent', verdict: NOT_APPLIED }
      const c = defs.tenant_members.description || ''
      return {
        observed: 'tenant_members present; table comment ' + (c ? 'present' : 'ABSENT'),
        verdict: UNDET,
        note:
          'Effect present, and the comments 003 writes ARE live — but schema.sql ' +
          'carries the same table and the same comments, so this cannot separate them. ' +
          'get_my_owned_tenant_ids() (also in both) is checked in Tier 2. Same caveat ' +
          'as 002 about schema.sql probably never having run.',
      }
    },
  },
  {
    id: '004',
    fingerprint:
      'public.profiles has NO tenant_id / role column, and HAS avatar_url carrying 004 comment text',
    run: ({ defs }) => {
      const p = defs.profiles
      if (!p) return { observed: 'profiles absent', verdict: NOT_APPLIED }
      const dropped = !has(defs, 'profiles', 'tenant_id') && !has(defs, 'profiles', 'role')
      const av = cdesc(defs, 'profiles', 'avatar_url')
      const avOk = /Optional profile picture URL/i.test(av || '')
      return {
        observed:
          'tenant_id/role ' + (dropped ? 'gone' : 'STILL PRESENT') +
          '; avatar_url comment ' + (avOk ? 'matches 004' : 'missing/different'),
        verdict: dropped && avOk ? APPLIED : dropped ? PARTIAL : NOT_APPLIED,
        note:
          'The live profiles TABLE comment is "Links auth.users to a tenant + role" — the ' +
          'pre-004 text, and NOT schema.sql\'s "Identity record for each auth user...". ' +
          'That is direct evidence the live DB was NOT built by running schema.sql: it ' +
          'grew from the original 001 schema by migration. Policy/function halves of 004 ' +
          'are in Tier 2.',
      }
    },
  },
  {
    id: '005',
    fingerprint:
      'table public.inquiries exists AND carries the four comments the 005 FILE writes',
    run: ({ defs }) => {
      const t = defs.inquiries
      if (!t) return { observed: 'inquiries absent', verdict: NOT_APPLIED }
      const tc = t.description || ''
      const dc = cdesc(defs, 'inquiries', 'data') || ''
      const fileRan = /Platform-wide generic table/i.test(tc) && /Flexible JSONB bag/i.test(dc)
      return {
        observed:
          'inquiries present; 005 table comment ' + (fileRan ? 'present' : 'ABSENT') +
          '; 005 data column comment ' + (dc ? 'present' : 'ABSENT'),
        verdict: fileRan ? APPLIED : PARTIAL,
        note:
          'Decisive discriminator: schema.sql creates inquiries with NO comments; the 005 ' +
          'file writes five. Live has none. So the TABLE exists (effect present) but the ' +
          '005 file as written did not run — schema.sql (or an equivalent) created it.',
      }
    },
  },
  {
    id: '006',
    fingerprint: 'RPC public.custom_access_token_hook(jsonb) exposed by PostgREST',
    run: ({ rpcs }) => {
      const present = rpcs.includes('custom_access_token_hook')
      return {
        observed: present ? 'RPC present' : 'RPC absent',
        verdict: present ? APPLIED : NOT_APPLIED,
        note:
          'This function exists ONLY in 006 — schema.sql does not declare it — so its ' +
          'presence is a clean fingerprint. Confirms the header claim of 2026-07-29. ' +
          'It does NOT prove the Dashboard->Auth->Hooks wiring; that is not in the catalog ' +
          'at all and must be eyeballed in the dashboard.',
      }
    },
  },
  {
    id: '007',
    fingerprint:
      'table public.project_members + RPCs get_my_project_ids / get_my_writable_project_ids + 007 comments',
    run: ({ defs, rpcs }) => {
      const t = defs.project_members
      const fns =
        rpcs.includes('get_my_project_ids') && rpcs.includes('get_my_writable_project_ids')
      if (!t || !fns)
        return {
          observed:
            'table ' + (t ? 'present' : 'ABSENT') + '; helper functions ' + (fns ? 'present' : 'ABSENT'),
          verdict: NOT_APPLIED,
        }
      const tc = t.description || ''
      const rc = cdesc(defs, 'project_members', 'role') || ''
      const verbatim = /ADR-017 Decision 1/i.test(tc) && /deliberately not a valid value/i.test(rc)
      return {
        observed:
          'table present; both helper RPCs present; 007 table comment ' +
          (tc ? 'present' : 'ABSENT') + '; role comment ' + (rc ? 'present' : 'ABSENT'),
        verdict: verbatim ? APPLIED : PARTIAL,
        note:
          'ANOMALY worth Tom\'s attention: project_members and both helper functions are ' +
          'live (nothing but 007 creates them, so 007 certainly ran), yet NEITHER comment ' +
          '007 writes is present, while 003\'s comments on tenant_members ARE. Something ' +
          'other than the literal file text was executed — the same failure mode as 010.',
      }
    },
  },
  {
    id: '008',
    fingerprint: 'column public.leads.project_id exists (FK -> projects.id)',
    run: ({ defs }) => {
      const present = has(defs, 'leads', 'project_id')
      const fk = /Foreign Key to `projects.id`/.test(cdesc(defs, 'leads', 'project_id') || '')
      return {
        observed: present ? 'leads.project_id present' + (fk ? ' with FK to projects.id' : ' (no FK seen)') : 'absent',
        verdict: present && fk ? APPLIED : present ? PARTIAL : NOT_APPLIED,
        note:
          'Clean fingerprint: neither schema.sql nor any other migration adds this column. ' +
          'Note 008\'s own column COMMENT is not visible in the live comment text, only the ' +
          'PostgREST FK note — see Tier 2 (col_description) for the definitive read.',
      }
    },
  },
  { id: '009', fingerprint: 'qual of policy "Members can read their projects" on public.projects', catalogOnly: true },
  { id: '010', fingerprint: 'body of public.handle_new_user() mentions project_members', catalogOnly: true },
  { id: '011', fingerprint: 'GRANT SELECT to authenticated on tenant_members + project_members + projects', catalogOnly: true },
  { id: '012', fingerprint: 'column-level GRANT UPDATE(full_name) on public.profiles to authenticated', catalogOnly: true },
  { id: '013', fingerprint: 'that same projects policy qual calls get_my_project_ids()', catalogOnly: true },
  { id: '014', fingerprint: 'two named policies on public.inquiries + GRANT SELECT,UPDATE to authenticated', catalogOnly: true },
  { id: '015', fingerprint: 'table-level GRANT SELECT on public.profiles to authenticated', catalogOnly: true },
  {
    id: '016',
    fingerprint: 'table public.form_submissions exists with its 016 comments (+ Tier 2: grant & 2 policies)',
    run: ({ defs }) => {
      const t = defs.form_submissions
      if (!t) return { observed: 'form_submissions absent', verdict: NOT_APPLIED }
      const ok = /ADR-018 canonical submission store/i.test(t.description || '')
      const snap = /Immutable interpretation subset/i.test(cdesc(defs, 'form_submissions', 'definition_snapshot') || '')
      return {
        observed: 'table present; 016 table comment ' + (ok ? 'present' : 'ABSENT') + '; definition_snapshot comment ' + (snap ? 'present' : 'ABSENT'),
        verdict: ok && snap ? APPLIED : PARTIAL,
        note: 'Nothing but 016 creates this table or these comments. Grants/policies in Tier 2.',
      }
    },
  },
  {
    id: '017',
    fingerprint: 'table public.form_events exists with its 017 comment (+ Tier 2: grant & policy)',
    run: ({ defs }) => {
      const t = defs.form_events
      if (!t) return { observed: 'form_events absent', verdict: NOT_APPLIED }
      const ok = /ADR-018 append-only outbox/i.test(t.description || '')
      return {
        observed: 'table present; 017 table comment ' + (ok ? 'present' : 'ABSENT'),
        verdict: ok ? APPLIED : PARTIAL,
        note: 'Nothing but 017 creates this table. Grant/policy in Tier 2.',
      }
    },
  },
  { id: '018', fingerprint: 'GRANT ALL to service_role on form_submissions + form_events', catalogOnly: true },
  {
    id: '019',
    fingerprint: 'columns form_events.environment + form_events.project_slug with 019 comments (+ Tier 2: status check accepts skipped)',
    run: ({ defs }) => {
      const env = has(defs, 'form_events', 'environment')
      const slug = has(defs, 'form_events', 'project_slug')
      const c = cdesc(defs, 'form_events', 'environment') || ''
      const verbatim = /App environment that created/i.test(c)
      if (!env || !slug)
        return { observed: 'environment ' + (env ? 'present' : 'ABSENT') + ', project_slug ' + (slug ? 'present' : 'ABSENT'), verdict: NOT_APPLIED }
      return {
        observed: 'both columns present; 019 column comment ' + (verbatim ? 'present' : 'ABSENT'),
        verdict: verbatim ? APPLIED : PARTIAL,
        note: 'Both columns are added only by 019. The check-constraint half is Tier 2.',
      }
    },
  },
  {
    id: '020',
    fingerprint: 'table comment on public.leads — 020 REPLACES it with PROJECT-scoped text (+ Tier 2: 3 policy names)',
    run: ({ defs }) => {
      const c = defs.leads ? defs.leads.description || '' : ''
      const applied = /PROJECT-scoped as of migration 020/i.test(c)
      return {
        observed: 'leads table comment = "' + c.slice(0, 60) + '"',
        verdict: applied ? APPLIED : NOT_APPLIED,
        note:
          'Strong NEGATIVE fingerprint: the live comment is still the original ' +
          '"Contact form submissions. Tenant-scoped." from schema.sql. 020 rewrites it in ' +
          'the same file as its policy swap, so an unchanged comment means the file did ' +
          'not run. Tier 2 confirms via the three policy names.',
      }
    },
  },
  { id: '021', fingerprint: 'GRANT SELECT on public.tenants to authenticated', catalogOnly: true },
  {
    id: '022',
    fingerprint: 'column public.tenants.domain is GONE, and the tenants comment names migration 022',
    run: ({ defs }) => {
      const gone = !has(defs, 'tenants', 'domain')
      const c = (defs.tenants && defs.tenants.description) || ''
      const stamped = /As of migration 022/i.test(c)
      return {
        observed: 'tenants.domain ' + (gone ? 'absent (dropped)' : 'STILL PRESENT') + '; 022 comment ' + (stamped ? 'present' : 'ABSENT'),
        verdict: gone && stamped ? APPLIED : gone ? PARTIAL : NOT_APPLIED,
        note: 'Two independent traces agree. schema.sql declares domain NOT NULL UNIQUE, so its absence can only come from 022.',
      }
    },
  },
  {
    id: '023',
    fingerprint: 'comment on public.projects.slug names constraint projects_tenant_id_slug_key (+ Tier 2: pg_constraint is the real proof)',
    run: ({ defs }) => {
      const c = cdesc(defs, 'projects', 'slug') || ''
      const stamped = /projects_tenant_id_slug_key/i.test(c)
      return {
        observed: 'projects.slug comment ' + (stamped ? 'names projects_tenant_id_slug_key' : 'does not mention 023'),
        verdict: stamped ? APPLIED : NEEDS_CATALOG,
        note:
          'The comment is only what 023 WROTE, not the constraint itself. PostgREST cannot ' +
          'see pg_constraint, so treat this as strong-but-indirect and let Tier 2 check (a) ' +
          'UNIQUE (tenant_id, slug) exists and (b) no UNIQUE (slug) survives.',
      }
    },
  },
  { id: '024', fingerprint: 'trigger on_auth_user_invited on auth.users + function public.handle_user_invited()', catalogOnly: true },
]

function has(defs, table, col) {
  return Boolean(defs[table] && defs[table].properties && defs[table].properties[col])
}
function cdesc(defs, table, col) {
  if (!has(defs, table, col)) return null
  return defs[table].properties[col].description || null
}

// ---------------------------------------------------------------------------
// TIER 2 — one read-only SQL statement for the dashboard SQL editor
// ---------------------------------------------------------------------------
// Each entry contributes one row: migration | fingerprint | observed | verdict.
// `observed` and `verdict` are SQL expressions returning text.
const CATALOG_CHECKS = [
  {
    id: '003',
    fingerprint: 'function public.get_my_owned_tenant_ids() exists',
    observed: `coalesce((select 'prosecdef=' || p.prosecdef::text from pg_proc p where p.proname = 'get_my_owned_tenant_ids' and p.pronamespace = 'public'::regnamespace), 'absent')`,
    verdict: `case when exists (select 1 from pg_proc p where p.proname = 'get_my_owned_tenant_ids' and p.pronamespace = 'public'::regnamespace) then 'UNDETERMINABLE (present, but schema.sql declares it too)' else 'NOT APPLIED' end`,
  },
  {
    id: '004',
    fingerprint: 'helpers get_my_tenant_ids + get_my_writable_tenant_ids exist AND handle_new_user still writes profiles',
    observed: `(select count(*)::text || ' of 2 helper functions' from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('get_my_tenant_ids','get_my_writable_tenant_ids'))`,
    verdict: `case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('get_my_tenant_ids','get_my_writable_tenant_ids')) = 2 then 'UNDETERMINABLE (present, but schema.sql declares them too; see Tier 1 for the profiles column drop, which IS decisive)' else 'NOT APPLIED' end`,
  },
  {
    id: '008',
    fingerprint: 'col_description on public.leads.project_id (008 writes one)',
    observed: `coalesce(left((select col_description(to_regclass('public.leads'), a.attnum) from pg_attribute a where a.attrelid = to_regclass('public.leads') and a.attname = 'project_id'), 60), 'no comment')`,
    verdict: `case when (select col_description(to_regclass('public.leads'), a.attnum) from pg_attribute a where a.attrelid = to_regclass('public.leads') and a.attname = 'project_id') is not null then 'APPLIED' when exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.leads') and a.attname = 'project_id' and not a.attisdropped) then 'APPLIED (NOT VERBATIM) - column present, 008 comment missing' else 'NOT APPLIED' end`,
  },
  {
    id: '009',
    fingerprint: 'qual of policy "Members can read their projects" contains a RAW project_members subquery (009) rather than get_my_project_ids() (013)',
    observed: `coalesce(left((select qual from pg_policies where schemaname='public' and tablename='projects' and policyname='Members can read their projects'), 200), 'policy absent')`,
    verdict: `case when (select qual from pg_policies where schemaname='public' and tablename='projects' and policyname='Members can read their projects') ilike '%get_my_project_ids%' then 'UNDETERMINABLE (013 overwrote 009 - the only object 009 touched. 013 existing at all is evidence 009 once ran, but that is an inference, not an observation)' when (select qual from pg_policies where schemaname='public' and tablename='projects' and policyname='Members can read their projects') ilike '%project_members%' then 'APPLIED (009 form still live - 013 NOT applied)' else 'NOT APPLIED (policy is the pre-009 004 form)' end`,
  },
  {
    id: '010',
    fingerprint: 'body of public.handle_new_user() contains a project_members INSERT (exists in NO other repo file)',
    observed: `coalesce((select 'mentions project_members=' || (p.prosrc ilike '%project_members%')::text || ', tenant_members=' || (p.prosrc ilike '%tenant_members%')::text from pg_proc p where p.proname='handle_new_user' and p.pronamespace='public'::regnamespace), 'function absent')`,
    verdict: `case when exists (select 1 from pg_proc p where p.proname='handle_user_invited' and p.pronamespace='public'::regnamespace) then 'UNDETERMINABLE (024 has been applied and rewrote handle_new_user, erasing 010 only trace)' when (select p.prosrc from pg_proc p where p.proname='handle_new_user' and p.pronamespace='public'::regnamespace) ilike '%project_members%' then 'APPLIED (despite the file header saying NOT APPLIED)' else 'NOT APPLIED' end`,
  },
  {
    id: '011',
    fingerprint: 'GRANT SELECT to authenticated on all three of tenant_members, project_members, projects',
    observed: `(select coalesce(string_agg(table_name, ',' order by table_name), 'none') from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type='SELECT' and table_name in ('tenant_members','project_members','projects'))`,
    verdict: `case when (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type='SELECT' and table_name in ('tenant_members','project_members','projects')) = 3 then 'APPLIED' when (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type='SELECT' and table_name in ('tenant_members','project_members','projects')) = 0 then 'NOT APPLIED' else 'PARTIAL - some but not all three grants present' end`,
  },
  {
    id: '012',
    fingerprint: 'column-level GRANT UPDATE(full_name) on public.profiles to authenticated, with NO table-level UPDATE',
    observed: `(select coalesce(string_agg(column_name || ':' || privilege_type, ',' order by column_name), 'none') from information_schema.column_privileges where table_schema='public' and table_name='profiles' and grantee='authenticated' and privilege_type='UPDATE')`,
    verdict: `case when exists (select 1 from information_schema.column_privileges where table_schema='public' and table_name='profiles' and grantee='authenticated' and privilege_type='UPDATE' and column_name='full_name') and not exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='profiles' and grantee='authenticated' and privilege_type='UPDATE') then 'APPLIED' when exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='profiles' and grantee='authenticated' and privilege_type='UPDATE') then 'UNDETERMINABLE - a TABLE-level UPDATE grant exists, which is broader than 012 and masks it' else 'NOT APPLIED' end`,
  },
  {
    id: '013',
    fingerprint: 'qual of policy "Members can read their projects" calls public.get_my_project_ids()',
    observed: `coalesce(left((select qual from pg_policies where schemaname='public' and tablename='projects' and policyname='Members can read their projects'), 200), 'policy absent')`,
    verdict: `case when (select qual from pg_policies where schemaname='public' and tablename='projects' and policyname='Members can read their projects') ilike '%get_my_project_ids%' then 'APPLIED' when (select qual from pg_policies where schemaname='public' and tablename='projects' and policyname='Members can read their projects') is null then 'NOT APPLIED (policy absent entirely)' else 'NOT APPLIED (policy present but still the recursive 009 form - live recursion bug)' end`,
  },
  {
    id: '014',
    fingerprint: 'two named policies on public.inquiries AND GRANT SELECT+UPDATE on inquiries to authenticated',
    observed: `(select 'policies=' || (select count(*) from pg_policies where schemaname='public' and tablename='inquiries' and policyname in ('Members can read inquiries for their tenants and projects','Contributors can update inquiries for their tenants and projects'))::text || ', grants=' || coalesce((select string_agg(privilege_type, '+' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='inquiries' and grantee='authenticated'), 'none'))`,
    verdict: `case when (select count(*) from pg_policies where schemaname='public' and tablename='inquiries' and policyname in ('Members can read inquiries for their tenants and projects','Contributors can update inquiries for their tenants and projects')) = 2 and (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='inquiries' and grantee='authenticated' and privilege_type in ('SELECT','UPDATE')) = 2 then 'APPLIED' when (select count(*) from pg_policies where schemaname='public' and tablename='inquiries' and policyname in ('Members can read inquiries for their tenants and projects','Contributors can update inquiries for their tenants and projects')) = 0 and not exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='inquiries' and grantee='authenticated') then 'NOT APPLIED' else 'PARTIAL - grants and policies disagree; inspect before acting' end`,
  },
  {
    id: '015',
    fingerprint: 'table-level GRANT SELECT on public.profiles to authenticated',
    observed: `coalesce((select string_agg(privilege_type, '+' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='profiles' and grantee='authenticated'), 'none')`,
    verdict: `case when exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='profiles' and grantee='authenticated' and privilege_type='SELECT') then 'APPLIED' else 'NOT APPLIED' end`,
  },
  {
    id: '016',
    fingerprint: 'GRANT SELECT+UPDATE on form_submissions to authenticated AND both 016 policies',
    observed: `(select 'policies=' || (select count(*) from pg_policies where schemaname='public' and tablename='form_submissions' and policyname in ('Members read their project submissions','Writable roles update their project submissions'))::text || ', authenticated grants=' || coalesce((select string_agg(privilege_type, '+' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='form_submissions' and grantee='authenticated'), 'none'))`,
    verdict: `case when (select count(*) from pg_policies where schemaname='public' and tablename='form_submissions' and policyname in ('Members read their project submissions','Writable roles update their project submissions')) = 2 and (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='form_submissions' and grantee='authenticated' and privilege_type in ('SELECT','UPDATE')) = 2 then 'APPLIED' when not exists (select 1 from pg_class c where c.relname='form_submissions' and c.relnamespace='public'::regnamespace) then 'NOT APPLIED' else 'PARTIAL - table exists but grants/policies incomplete' end`,
  },
  {
    id: '017',
    fingerprint: 'GRANT SELECT on form_events to authenticated AND policy "Members read their project form events"',
    observed: `(select 'policy=' || exists (select 1 from pg_policies where schemaname='public' and tablename='form_events' and policyname='Members read their project form events')::text || ', authenticated grants=' || coalesce((select string_agg(privilege_type, '+' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='form_events' and grantee='authenticated'), 'none'))`,
    verdict: `case when exists (select 1 from pg_policies where schemaname='public' and tablename='form_events' and policyname='Members read their project form events') and exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='form_events' and grantee='authenticated' and privilege_type='SELECT') then 'APPLIED' when not exists (select 1 from pg_class c where c.relname='form_events' and c.relnamespace='public'::regnamespace) then 'NOT APPLIED' else 'PARTIAL - table exists but grant/policy incomplete' end`,
  },
  {
    id: '018',
    fingerprint: 'service_role holds SELECT+INSERT+UPDATE+DELETE on BOTH form tables (8 rows)',
    observed: `(select count(*)::text || ' of 8 service_role privileges' from information_schema.role_table_grants where table_schema='public' and grantee='service_role' and table_name in ('form_submissions','form_events') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE'))`,
    verdict: `case when (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='service_role' and table_name in ('form_submissions','form_events') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) = 8 then 'APPLIED (weak: Supabase default privileges could in principle produce the same grants - but the live 42501 that 018 was written to fix proves they did not here)' when (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='service_role' and table_name in ('form_submissions','form_events') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) = 0 then 'NOT APPLIED' else 'PARTIAL' end`,
  },
  {
    id: '019',
    fingerprint: `constraint form_events_status_check accepts 'skipped'`,
    observed: `coalesce((select left(pg_get_constraintdef(c.oid), 160) from pg_constraint c where c.conrelid = to_regclass('public.form_events') and c.conname = 'form_events_status_check'), 'constraint absent (table or constraint missing)')`,
    verdict: `case when (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = to_regclass('public.form_events') and c.conname='form_events_status_check') ilike '%skipped%' then 'APPLIED' else 'NOT APPLIED' end`,
  },
  {
    id: '020',
    fingerprint: 'the three project-grain policy names on public.leads, and the ABSENCE of the three tenant-grain ones',
    observed: `(select coalesce(string_agg(policyname, ' | ' order by policyname), 'no policies') from pg_policies where schemaname='public' and tablename='leads')`,
    verdict: `case when (select count(*) from pg_policies where schemaname='public' and tablename='leads' and policyname in ('Members read leads for their projects','Writable roles insert leads for their projects','Writable roles update leads for their projects')) = 3 then 'APPLIED' when (select count(*) from pg_policies where schemaname='public' and tablename='leads' and policyname in ('Members can read leads for their tenants','Contributors can insert leads for their tenants','Contributors can update leads for their tenants')) > 0 then 'NOT APPLIED (leads RLS still at TENANT grain)' else 'PARTIAL - neither policy set is intact' end`,
  },
  {
    id: '021',
    fingerprint: 'GRANT SELECT on public.tenants to authenticated, and nothing wider',
    observed: `coalesce((select string_agg(privilege_type, '+' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='tenants' and grantee='authenticated'), 'none')`,
    verdict: `case when (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='tenants' and grantee='authenticated') = 1 and exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='tenants' and grantee='authenticated' and privilege_type='SELECT') then 'APPLIED' when exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='tenants' and grantee='authenticated' and privilege_type='SELECT') then 'APPLIED but WIDER than 021 - extra privileges present, investigate' else 'NOT APPLIED' end`,
  },
  {
    id: '022',
    fingerprint: 'column public.tenants.domain absent, and tenants_domain_key / tenants_domain_idx gone with it',
    observed: `(select 'domain column=' || exists (select 1 from pg_attribute a where a.attrelid=to_regclass('public.tenants') and a.attname='domain' and not a.attisdropped)::text || ', domain indexes=' || (select count(*) from pg_indexes where schemaname='public' and tablename='tenants' and indexname like '%domain%')::text)`,
    verdict: `case when not exists (select 1 from pg_attribute a where a.attrelid=to_regclass('public.tenants') and a.attname='domain' and not a.attisdropped) then 'APPLIED' else 'NOT APPLIED' end`,
  },
  {
    id: '023',
    fingerprint: 'UNIQUE (tenant_id, slug) on public.projects exists AND no UNIQUE (slug) survives',
    observed: `(select coalesce(string_agg(c.conname || '=' || pg_get_constraintdef(c.oid), ' | ' order by c.conname), 'none') from pg_constraint c where c.conrelid=to_regclass('public.projects') and c.contype='u')`,
    verdict: `case when exists (select 1 from pg_constraint c where c.conrelid=to_regclass('public.projects') and c.contype='u' and pg_get_constraintdef(c.oid) = 'UNIQUE (tenant_id, slug)') and not exists (select 1 from pg_constraint c where c.conrelid=to_regclass('public.projects') and c.contype='u' and pg_get_constraintdef(c.oid) = 'UNIQUE (slug)') then 'APPLIED' when exists (select 1 from pg_constraint c where c.conrelid=to_regclass('public.projects') and c.contype='u' and pg_get_constraintdef(c.oid) = 'UNIQUE (slug)') then 'NOT APPLIED (global UNIQUE (slug) still in force)' else 'PARTIAL - neither expected constraint shape found' end`,
  },
  {
    id: '024',
    fingerprint: 'function public.handle_user_invited() + trigger on_auth_user_invited on auth.users, and handle_new_user() no longer touches membership tables',
    observed: `(select 'handle_user_invited=' || exists (select 1 from pg_proc p where p.proname='handle_user_invited' and p.pronamespace='public'::regnamespace)::text || ', triggers=' || coalesce((select string_agg(t.tgname, ',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('auth.users') and not t.tgisinternal), 'none') || ', handle_new_user touches membership=' || coalesce((select (p.prosrc ilike '%tenant_members%' or p.prosrc ilike '%project_members%')::text from pg_proc p where p.proname='handle_new_user' and p.pronamespace='public'::regnamespace), 'n/a'))`,
    verdict: `case when exists (select 1 from pg_proc p where p.proname='handle_user_invited' and p.pronamespace='public'::regnamespace) and exists (select 1 from pg_trigger t where t.tgrelid=to_regclass('auth.users') and not t.tgisinternal and t.tgname='on_auth_user_invited') and not coalesce((select (p.prosrc ilike '%tenant_members%' or p.prosrc ilike '%project_members%') from pg_proc p where p.proname='handle_new_user' and p.pronamespace='public'::regnamespace), true) then 'APPLIED' when exists (select 1 from pg_proc p where p.proname='handle_user_invited' and p.pronamespace='public'::regnamespace) then 'PARTIAL - handle_user_invited exists but trigger or handle_new_user rewrite is missing. DO NOT re-enable self-signup' else 'NOT APPLIED - the privilege-escalation trigger shape is still live' end`,
  },
]

function buildSql() {
  const rows = CATALOG_CHECKS.map(
    (c) =>
      `  select '${c.id}'::text as migration,\n` +
      `         ${q(c.fingerprint)}::text as fingerprint,\n` +
      `         (${c.observed})::text as observed,\n` +
      `         (${c.verdict})::text as verdict`
  ).join('\n  union all\n')

  return `-- ===========================================================================
-- applied-check.sql — GENERATED by supabase/verify/applied-check.mjs (--sql).
-- Do not hand-edit; edit CATALOG_CHECKS in applied-check.mjs and regenerate.
--
-- WHAT THIS IS: the catalog half of the migration-state check. PostgREST does
-- not expose pg_catalog, so policies, GRANTs, function bodies, triggers and
-- constraints cannot be read from the app. This one statement reads them and
-- returns a verdict per migration.
--
-- HOW TO RUN (Tom):
--   1. Supabase Dashboard -> SQL editor -> New query.
--   2. Paste this whole file. Run it.
--   3. It returns ONE cell of JSON. Copy it into a file, e.g. catalog.json.
--   4. node supabase/verify/applied-check.mjs --merge catalog.json
--
-- IT IS READ-ONLY. One SELECT. No DDL, no DML, no temp objects, no writes.
-- Safe to run against production as often as you like.
-- ===========================================================================

select jsonb_pretty(jsonb_agg(to_jsonb(f) order by f.migration)) as applied_check
from (
${rows}
) f;
`
}

function q(s) {
  return `'` + String(s).replace(/'/g, `''`) + `'`
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------
async function tier1(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (repo .env.local or environment).'
    )
  }
  const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/', {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/openapi+json' },
  })
  if (!res.ok) throw new Error('PostgREST returned HTTP ' + res.status)
  const spec = await res.json()
  const defs = spec.definitions || {}
  const rpcs = Object.keys(spec.paths || {})
    .filter((p) => p.startsWith('/rpc/'))
    .map((p) => p.slice(5))
  return { defs, rpcs, host: new URL(url).host }
}

function pad(s, n) {
  s = String(s)
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

async function main() {
  const args = process.argv.slice(2)
  const wantSql = args.includes('--sql')
  const wantJson = args.includes('--json')
  const mergeIdx = args.indexOf('--merge')
  const mergeFile = mergeIdx >= 0 ? args[mergeIdx + 1] : null

  if (wantSql) {
    const sql = buildSql()
    writeFileSync(SQL_OUT, sql)
    console.log('Wrote ' + SQL_OUT)
    console.log('Paste it into Supabase Dashboard -> SQL editor, run it, save the single')
    console.log('JSON cell to a file, then: node applied-check.mjs --merge <file>')
    return
  }

  const env = loadEnv()
  const ctx = await tier1(env)

  let catalog = {}
  if (mergeFile) {
    const raw = readFileSync(mergeFile, 'utf8').trim()
    let parsed = JSON.parse(raw)
    // Accept the raw jsonb_pretty cell, or the dashboard's row wrapper.
    if (!Array.isArray(parsed)) {
      if (typeof parsed.applied_check === 'string') parsed = JSON.parse(parsed.applied_check)
      else if (Array.isArray(parsed.applied_check)) parsed = parsed.applied_check
      else if (Array.isArray(parsed[0] && parsed[0].applied_check)) parsed = parsed[0].applied_check
    }
    if (Array.isArray(parsed) && parsed.length === 1 && parsed[0].applied_check) {
      parsed = typeof parsed[0].applied_check === 'string' ? JSON.parse(parsed[0].applied_check) : parsed[0].applied_check
    }
    for (const row of parsed) catalog[row.migration] = row
  }

  const results = []
  for (const check of REMOTE_CHECKS) {
    const cat = catalog[check.id]
    if (check.catalogOnly) {
      results.push({
        id: check.id,
        fingerprint: cat ? cat.fingerprint : check.fingerprint,
        source: 'catalog',
        observed: cat ? cat.observed : '(not read)',
        verdict: cat ? cat.verdict : NEEDS_CATALOG,
      })
      continue
    }
    const r = check.run(ctx)
    // A catalog reading, where one exists, is strictly better evidence than a
    // comment: prefer it, but keep the Tier 1 observation visible.
    if (cat) {
      results.push({
        id: check.id,
        fingerprint: check.fingerprint + '  ||  ' + cat.fingerprint,
        source: 'openapi+catalog',
        observed: r.observed + '  ||  ' + cat.observed,
        verdict: cat.verdict,
        tier1Verdict: r.verdict,
        note: r.note,
      })
    } else {
      results.push({ id: check.id, fingerprint: check.fingerprint, source: 'openapi', ...r })
    }
  }

  if (wantJson) {
    console.log(JSON.stringify({ host: ctx.host, catalogMerged: Boolean(mergeFile), results }, null, 2))
    return
  }

  console.log('')
  console.log('Migration state, derived from the LIVE database at ' + ctx.host)
  console.log('  Tier 1: PostgREST OpenAPI (columns, defaults, FKs, RPCs, live COMMENT text)')
  console.log(
    '  Tier 2: ' + (mergeFile ? 'catalog results merged from ' + mergeFile : 'NOT RUN — run --sql, paste in the dashboard, then --merge')
  )
  console.log('')
  console.log(pad('MIG', 5) + pad('VERDICT', 46) + 'OBSERVED')
  console.log('-'.repeat(120))
  for (const r of results) {
    console.log(pad(r.id, 5) + pad(r.verdict, 46) + String(r.observed).slice(0, 69))
  }
  console.log('')
  console.log('Fingerprints and caveats (why each verdict is what it is):')
  for (const r of results) {
    console.log('  ' + r.id + '  fingerprint: ' + r.fingerprint)
    if (r.tier1Verdict && r.tier1Verdict !== r.verdict)
      console.log('      Tier 1 alone said: ' + r.tier1Verdict + ' (catalog reading wins)')
    if (r.note) console.log('      ' + r.note.replace(/\s+/g, ' '))
  }
  console.log('')
  const undet = results.filter((r) => r.verdict.startsWith(UNDET))
  if (undet.length) {
    console.log(
      'UNDETERMINABLE (' + undet.map((r) => r.id).join(', ') + ') — these leave no trace that ' +
      'separates them from schema.sql or from a later migration that overwrote them. That is ' +
      'the honest answer; do not upgrade it to a guess.'
    )
  }
  if (!mergeFile) {
    console.log('')
    console.log('Verdicts marked "' + NEEDS_CATALOG + '" are NOT unknowable — they just need Tier 2.')
  }
}

main().catch((err) => {
  console.error('applied-check failed: ' + err.message)
  process.exitCode = 1
})
