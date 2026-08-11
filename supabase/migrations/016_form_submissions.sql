-- ============================================================
-- Migration 016 — form_submissions
--
-- ADR-018 (Forms Module) slice 1. Canonical store for all form
-- submissions. Distinct from `inquiries` (legacy generic table) and
-- `leads` (tenant contact submissions). New forms write here.
--
-- Scoping (ADR-018 §3 / §16): every submission records BOTH tenant_id
-- and project_id. Both are NULLABLE this slice — platform-level forms
-- (e.g. Early Access) have neither, mirroring `inquiries`. The NOT NULL
-- + RLS-tightening on project_id is a later, gated step (ADR-017 Dec 6).
--
-- Versioning (ADR-018 Decision 4): form_version + definition_snapshot are
-- pinned when the row is CREATED and are immutable thereafter. Historical
-- submissions never dereference mutable CMS/definition state.
--
-- Access (ADR-018 §16): anonymous visitors CREATE via the API route's
-- service-role client (runAsTrustedSystemOperation) — there is no anon
-- policy. Dashboard members READ/UPDATE via RLS under their session.
-- ============================================================


create table public.form_submissions (
  id                    uuid        primary key default gen_random_uuid(),

  -- Scope. Both nullable this slice (platform-level forms have neither).
  tenant_id             uuid        references public.tenants  (id) on delete set null,
  project_id            uuid        references public.projects (id) on delete set null,

  -- Definition identity + immutable snapshot, PINNED AT CREATION (Decision 4).
  form_id               text        not null,     -- slice 1: 'early-access'; later: Sanity _id
  form_version          integer     not null,     -- monotonic; frozen at creation
  definition_snapshot   jsonb       not null default '{}',  -- interpretation subset only (no secrets)

  -- Submission content + attribution.
  locale                text        not null default 'en',
  source                jsonb       not null default '{}',  -- page/url/placement/cta/campaign (§12)
  context               jsonb       not null default '{}',  -- known values from the placement (§6)
  submission_data       jsonb       not null default '{}',  -- values keyed by field internalKey

  -- Lifecycle.
  status                text        not null default 'new'
                                     check (status in ('new','processed','archived','spam')),
  completion_state      text        not null default 'complete'
                                     check (completion_state in ('partial','complete')),

  -- Consent (top-level for legal auditability, mirrors inquiries §23).
  gdpr_consent          boolean     not null default false,
  gdpr_consent_at       timestamptz,

  -- Rotating step token (multi-step only). Stores a HASH, never plaintext.
  step_token_hash       text,                    -- sha256(hex) of current valid token; null when complete
  step_token_expires_at timestamptz,

  -- Spam / rate-limit + audit.
  submitter_ip          text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.form_submissions is
  'ADR-018 canonical submission store. form_id + form_version + definition_snapshot are '
  'pinned at row creation and immutable thereafter (Decision 4). project_id nullable this '
  'slice (platform-level forms); NOT NULL + RLS-tighten is a later gated step (ADR-017 Dec 6). '
  'Anonymous visitors INSERT via service-role API route; dashboard members read/update via RLS.';

comment on column public.form_submissions.definition_snapshot is
  'Immutable interpretation subset of the definition at submission-creation time '
  '(fields/steps/options/labels/validations/consent text). Never contains operational/secret '
  'config such as notification recipients or channel/integration credentials (ADR-018 Decision 4/9).';

comment on column public.form_submissions.step_token_hash is
  'sha256 (hex) of the current single-use step-completion token for a partial multi-step '
  'submission. Rotated on every successful step; nulled on finalize. Plaintext is returned to '
  'the client once and never stored.';


-- ── Indexes ───────────────────────────────────────────────────────────────────
create index form_submissions_project_id_idx on public.form_submissions (project_id);
create index form_submissions_tenant_id_idx  on public.form_submissions (tenant_id);
create index form_submissions_form_id_idx    on public.form_submissions (form_id);
create index form_submissions_status_idx     on public.form_submissions (status);
create index form_submissions_created_at_idx on public.form_submissions (created_at desc);
-- Rate-limit lookups: count recent rows for an IP.
create index form_submissions_ip_recent_idx  on public.form_submissions (submitter_ip, created_at desc)
  where submitter_ip is not null;


-- ── updated_at trigger (reuses public.set_updated_at() from migration 005) ────
create trigger form_submissions_set_updated_at
  before update on public.form_submissions
  for each row execute function public.set_updated_at();


-- ── Row Level Security (project-scoped; mirrors migration 014 inquiries shape) ─
alter table public.form_submissions enable row level security;

-- Dashboard members read/update under their own session (RLS). Anonymous INSERT is
-- service-role only (no anon grant, no INSERT policy).
grant select, update on public.form_submissions to authenticated;

-- SELECT — any project member (owner/editor/viewer) reads their project's rows.
-- Platform-level rows (project_id null) are invisible to members → admin/service-role only.
create policy "Members read their project submissions"
  on public.form_submissions for select
  using (project_id in (select public.get_my_project_ids()));

-- UPDATE — writable roles (owner/editor) may change status etc.
-- get_my_writable_project_ids() confirmed present (migration 007).
create policy "Writable roles update their project submissions"
  on public.form_submissions for update
  using      (project_id in (select public.get_my_writable_project_ids()))
  with check (project_id in (select public.get_my_writable_project_ids()));

-- No INSERT/DELETE policy: public creates go through the API route's service-role
-- client (runAsTrustedSystemOperation); deletes are service-role only for now.


-- ── Verification (run after applying) ─────────────────────────────────────────
-- 1. select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema='public' and table_name='form_submissions' order by ordinal_position;
-- 2. select policyname, cmd from pg_policies where tablename='form_submissions';  -- expect 2
-- 3. select rowsecurity from pg_tables where tablename='form_submissions';        -- expect true
