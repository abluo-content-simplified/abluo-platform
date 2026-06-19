-- ============================================================
-- Migration 005 — inquiries table
--
-- Generic platform-wide table for all form submissions.
-- Replaces no existing table — distinct from `leads` (which is
-- for tenant contact-form submissions).
--
-- First use case: inquiry_type = 'early_access'
--
-- Future use cases (same table, different inquiry_type):
--   'appointment_request'  — dental / medical / wellness tenants
--   'membership_request'   — sports clubs, associations
--   'contact'              — generic contact forms
--   'custom'               — any future form type
--
-- Tenant scoping:
--   Platform-level inquiries (Abluo early access): tenant_id = NULL
--   Tenant-level inquiries (Livener early access, dentist bookings):
--     tenant_id = <tenant uuid>, project_id = <project uuid>
--
-- RLS: enabled, but no anon policies — all writes go through
--   the Next.js API route using the service role client.
--   Future dashboard read policies are added when the UI is built.
-- ============================================================


-- ── set_updated_at() trigger function ─────────────────────────────────────────
--
-- Reusable trigger that keeps updated_at current on any table that uses it.
-- CREATE OR REPLACE so this is safe to run even if the function already exists.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic before-update trigger that sets updated_at = now(). '
  'Attach to any table that needs an auto-maintained updated_at column.';


-- ── inquiries ─────────────────────────────────────────────────────────────────

create table public.inquiries (
  id              uuid        primary key default gen_random_uuid(),

  -- Tenant scoping (nullable — platform-level inquiries have no tenant)
  tenant_id       uuid        references public.tenants  (id) on delete set null,
  project_id      uuid        references public.projects (id) on delete set null,

  -- Inquiry classification
  inquiry_type    text        not null default 'early_access',
  status          text        not null default 'new'
                                check (status in ('new', 'contacted', 'archived', 'spam')),

  -- Core contact fields (captured in step 1)
  name            text        not null,
  email           text        not null,
  phone           text,

  -- GDPR consent (top-level columns for legal auditability)
  gdpr_consent    boolean     not null default false,
  gdpr_consent_at timestamptz,

  -- Flexible qualification data (all step-2 fields + metadata)
  -- Structure for early_access:
  --   organization, role, website, country, orgType,
  --   useCases[], referralSource, message,
  --   ip (for rate limiting), partial (boolean)
  data            jsonb       not null default '{}',

  -- Entry point tracking — populated from day one
  -- Values: 'header_cta', 'footer_cta', or '<tenant>_<location>'
  source          text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.inquiries is
  'Platform-wide generic table for all form submissions. '
  'tenant_id is nullable — platform-level inquiries (Abluo early access) '
  'have no tenant. Tenant-level forms (dentist appointments, club memberships) '
  'set tenant_id and project_id. inquiry_type distinguishes form purpose.';

comment on column public.inquiries.data is
  'Flexible JSONB bag for form-specific qualification fields. '
  'For early_access: organization, role, website, country, orgType, '
  'useCases[], referralSource, message, ip, partial.';

comment on column public.inquiries.gdpr_consent is
  'Whether the submitter gave explicit GDPR consent. '
  'Stored as a top-level column (not in data) for legal auditability.';

comment on column public.inquiries.gdpr_consent_at is
  'Timestamp when GDPR consent was given. '
  'NULL if gdpr_consent = false (partial submission without consent step).';

comment on column public.inquiries.source is
  'Entry point that generated this inquiry. '
  'Examples: header_cta, footer_cta, livener_header_cta, livener_footer_cta.';


-- ── Indexes ───────────────────────────────────────────────────────────────────

create index inquiries_tenant_id_idx     on public.inquiries (tenant_id);
create index inquiries_project_id_idx    on public.inquiries (project_id);
create index inquiries_email_idx         on public.inquiries (email);
create index inquiries_inquiry_type_idx  on public.inquiries (inquiry_type);
create index inquiries_status_idx        on public.inquiries (status);
create index inquiries_created_at_idx    on public.inquiries (created_at desc);

-- Functional index on IP address for rate-limiting queries
-- Allows: WHERE (data->>'ip') = $ip AND created_at > ...
create index inquiries_data_ip_idx
  on public.inquiries ((data->>'ip'))
  where data->>'ip' is not null;


-- ── Auto-update updated_at ────────────────────────────────────────────────────

create trigger inquiries_set_updated_at
  before update on public.inquiries
  for each row execute function public.set_updated_at();


-- ── Row Level Security ────────────────────────────────────────────────────────
--
-- Enabled now, policies added later when the dashboard UI is built.
-- All current reads/writes go through the API route using the service role
-- (createAdminClient), which bypasses RLS entirely.
--
-- Future policy model:
--   SELECT: tenant members can read inquiries for their tenant_id
--           platform admin (service role) reads all
--   INSERT: via API route only (service role)
--   UPDATE: via API route only (service role)
--   DELETE: service role only

alter table public.inquiries enable row level security;

-- No policies yet — service role handles everything.
-- Add this when building the dashboard Inquiries/Leads UI:
--
-- create policy "Members can read inquiries for their tenants"
--   on public.inquiries for select
--   using (
--     tenant_id in (select public.get_my_tenant_ids())
--   );


-- ── Verification queries ──────────────────────────────────────────────────────
--
-- Run after applying to confirm structure is correct.

-- 1. Confirm table exists with expected columns:
--    select column_name, data_type, is_nullable, column_default
--    from   information_schema.columns
--    where  table_schema = 'public'
--    and    table_name   = 'inquiries'
--    order  by ordinal_position;
--
-- 2. Confirm trigger is attached:
--    select trigger_name, event_manipulation, action_timing
--    from   information_schema.triggers
--    where  event_object_table = 'inquiries';
--
-- 3. Confirm indexes:
--    select indexname, indexdef
--    from   pg_indexes
--    where  tablename = 'inquiries';
--
-- 4. Confirm RLS is enabled, no policies yet:
--    select tablename, rowsecurity from pg_tables where tablename = 'inquiries';
--    select * from pg_policies where tablename = 'inquiries'; -- expect 0 rows
