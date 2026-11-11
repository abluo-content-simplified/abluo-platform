-- 071 — Navigation labels per project (Tom, 2026-11-11).
--
-- A project's own name for a few dashboard sections — People → "Teachers",
-- Testimonials → "Reviews" — shown in the sidebar and as that section's page
-- title. One label per section and interface language; no row = the default
-- (translated) name. Only ever for this project, never global.
--
-- Written and read by the server with the service role, after the dashboard
-- checked the person (`site.details.write` to change, any project member to
-- see the result). RLS on, no policies: nothing reaches it from the browser.
-- Additive; the code already runs without it (defaults everywhere).

create table if not exists public.project_nav_labels (
  project_id  uuid        not null references public.projects (id) on delete cascade,
  nav_id      text        not null check (nav_id in ('blog', 'events', 'courses', 'documents', 'testimonials', 'people')),
  locale      text        not null check (locale ~ '^[a-z]{2}$'),
  label       text        not null check (char_length(btrim(label)) between 1 and 30),
  updated_by  uuid        references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (project_id, nav_id, locale)
);

comment on table public.project_nav_labels is
  'A project''s own names for some dashboard sections (sidebar + page title), per interface language. Tenant administrators edit them in Settings → Labels.';

alter table public.project_nav_labels enable row level security;
