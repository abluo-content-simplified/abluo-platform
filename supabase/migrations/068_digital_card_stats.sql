-- ============================================================
-- Migration 068 — Digital Cards: visit statistics (ADR-049 D11)
--
-- ⚠️ NOT APPLIED. Order: (a) the code ships first and treats "function/table
-- missing" as "statistics unavailable, everything else works"
-- (src/lib/api/digital-card-stats.ts); (b) rehearse this file on the Abluo
-- Sandbox; (c) Tom approves; (d) Tom applies it in the SQL Editor, runs the
-- CHECK block at the end, and records it in supabase/APPLIED.md.
-- Purely additive and idempotent (create … if not exists / create or
-- replace): re-running it changes nothing. No existing object changes.
--
-- What it stores: DAILY AGGREGATES only — one row per
-- project × card × link × source × day with two counters. First-party and
-- cookieless: no IP, no user agent, no visitor id, no referrer URL, no
-- timestamp finer than a day. Wording in the product: "visits", never "people".
--   project_slug  Sanity projectSlug (cards live in Sanity, keyed by project slug)
--   card_id       digitalCard.publicId — permanent, survives URL renames
--   link_key      digitalCard.links[]._key; '' = the card itself (visits)
--   source        allow-listed slug from ?src= or a known referrer, else 'direct'
--   day           the visitor's day in Europe/Rome (CET/CEST — the tenants'
--                 time zone); the dashboard shows days, never times
--   visits/clicks counters (a visit row has link_key ''; a click row a link key)
--
-- Functions (SECURITY DEFINER, search_path '', service_role only):
--   digital_card_hit(p_project, p_card, p_link, p_source, p_kind)
--       +1 visit (p_kind 'visit', p_link ignored) or +1 click on p_link
--       (p_kind 'click'). Malformed input raises 22023; an unknown source is
--       stored as 'direct'. The endpoint has already checked the card/link
--       against published Sanity data, bots, host and rate limit.
--   digital_card_stats(p_project, p_card /* null = all cards */, p_from, p_to)
--       → ONE jsonb object, aggregated in SQL over [p_from, p_to] (inclusive):
--       {
--         "totals":  { "visits": n, "clicks": n },
--         "cards":   [ { "cardId", "visits", "clicks" } ],           -- visits desc
--         "links":   [ { "cardId", "linkKey", "clicks" } ],          -- clicks desc
--         "sources": [ { "source", "visits", "clicks" } ],           -- visits desc
--         "days":    [ { "day": "YYYY-MM-DD", "visits", "clicks" } ] -- day asc, days with data only
--       }
--       Ranges longer than 400 days or reversed raise 22023.
--   digital_card_sweep() → integer (rows deleted)
--       Retention 13 months: deletes day < current_date - 13 months. Run daily
--       by GET /api/cron/digital-cards-sweep.
--
-- Server-only (063/067 pattern): RLS on, NO policies, no grants to anon /
-- authenticated; the hit endpoint, the dashboard (behind
-- digital-cards.stats.read) and the cron call the functions with the service
-- role. Every call is scoped by project_slug.
--
-- Rollback (statistics only — safe; the code treats the missing objects as
-- "statistics unavailable"):
--   begin;
--   drop function if exists public.digital_card_hit(text, text, text, text, text);
--   drop function if exists public.digital_card_stats(text, text, date, date);
--   drop function if exists public.digital_card_sweep();
--   drop table if exists public.digital_card_daily;
--   commit;
-- ============================================================

begin;

create table if not exists public.digital_card_daily (
  project_slug text not null check (project_slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  card_id      text not null check (card_id ~ '^[A-Za-z0-9-]{1,64}$'),           -- digitalCard.publicId
  link_key     text not null default '' check (link_key ~ '^[A-Za-z0-9_-]{0,64}$'), -- '' = the card itself
  source       text not null default 'direct' check (source ~ '^[a-z0-9-]{1,32}$'),
  day          date not null,
  visits       integer not null default 0 check (visits >= 0),
  clicks       integer not null default 0 check (clicks >= 0),
  primary key (project_slug, card_id, link_key, source, day)
);

comment on table public.digital_card_daily is
  'ADR-049 D11 — Digital Cards daily aggregate visit/click counters per project × card (Sanity digitalCard.publicId) × link (_key, '''' = card) × source × day. '
  'No personal data. Server-only (service role); retention 13 months (digital_card_sweep).';

-- Stats over all cards of a project for a date range, and the sweep.
create index if not exists digital_card_daily_project_day on public.digital_card_daily (project_slug, day);
create index if not exists digital_card_daily_day on public.digital_card_daily (day);

-- ── Count one visit or one click ─────────────────────────────────────────────
create or replace function public.digital_card_hit(p_project text, p_card text, p_link text, p_source text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link   text;
  v_source text := coalesce(p_source, '');
  v_day    date := (now() at time zone 'Europe/Rome')::date;
begin
  if p_project is null or p_project !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception 'digital_card_hit: bad project' using errcode = '22023';
  end if;
  if p_card is null or p_card !~ '^[A-Za-z0-9-]{1,64}$' then
    raise exception 'digital_card_hit: bad card' using errcode = '22023';
  end if;
  if v_source !~ '^[a-z0-9-]{1,32}$' then
    v_source := 'direct';
  end if;

  if p_kind = 'visit' then
    insert into public.digital_card_daily as d (project_slug, card_id, link_key, source, day, visits)
    values (p_project, p_card, '', v_source, v_day, 1)
    on conflict (project_slug, card_id, link_key, source, day)
    do update set visits = d.visits + 1;
  elsif p_kind = 'click' then
    v_link := coalesce(p_link, '');
    if v_link !~ '^[A-Za-z0-9_-]{1,64}$' then
      raise exception 'digital_card_hit: bad link' using errcode = '22023';
    end if;
    insert into public.digital_card_daily as d (project_slug, card_id, link_key, source, day, clicks)
    values (p_project, p_card, v_link, v_source, v_day, 1)
    on conflict (project_slug, card_id, link_key, source, day)
    do update set clicks = d.clicks + 1;
  else
    raise exception 'digital_card_hit: bad kind' using errcode = '22023';
  end if;
end;
$$;

-- ── Read the statistics (aggregated in SQL) ──────────────────────────────────
create or replace function public.digital_card_stats(p_project text, p_card text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if p_project is null or p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'digital_card_stats: bad range' using errcode = '22023';
  end if;

  with r as (
    select card_id, link_key, source, day, visits, clicks
      from public.digital_card_daily
     where project_slug = p_project
       and (p_card is null or card_id = p_card)
       and day between p_from and p_to
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object('visits', coalesce(sum(visits), 0), 'clicks', coalesce(sum(clicks), 0)) from r),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object('cardId', card_id, 'visits', v, 'clicks', c) order by v desc, c desc, card_id)
        from (select card_id, sum(visits) as v, sum(clicks) as c from r group by card_id) x
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('cardId', card_id, 'linkKey', link_key, 'clicks', c) order by c desc, card_id, link_key)
        from (select card_id, link_key, sum(clicks) as c from r where link_key <> '' group by card_id, link_key) x
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('source', source, 'visits', v, 'clicks', c) order by v desc, c desc, source)
        from (select source, sum(visits) as v, sum(clicks) as c from r group by source) x
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'visits', v, 'clicks', c) order by day)
        from (select day, sum(visits) as v, sum(clicks) as c from r group by day) x
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

-- ── Retention: 13 months ─────────────────────────────────────────────────────
create or replace function public.digital_card_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.digital_card_daily where day < (current_date - interval '13 months')::date;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ── Access: server-only ──────────────────────────────────────────────────────
alter table public.digital_card_daily enable row level security;
-- Supabase's default privileges give service_role ALL on a new public table;
-- take everything back from everyone, then grant only what the code needs.
revoke all on public.digital_card_daily from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.digital_card_daily to service_role;

revoke all on function public.digital_card_hit(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.digital_card_stats(text, text, date, date) from public, anon, authenticated;
revoke all on function public.digital_card_sweep() from public, anon, authenticated;
grant execute on function public.digital_card_hit(text, text, text, text, text) to service_role;
grant execute on function public.digital_card_stats(text, text, date, date) to service_role;
grant execute on function public.digital_card_sweep() to service_role;

commit;

-- ============================================================
-- CHECK — run after applying (read-only except 6, which rolls back). Every
-- line must say what its comment says; anything else: stop and tell Claude/Tom.
--
-- 1. The table exists and RLS is on, with NO policies:
--   select relrowsecurity from pg_class where oid = 'public.digital_card_daily'::regclass;      -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'digital_card_daily';  -- 0
--
-- 2. anon and authenticated hold NO privilege on the table (both false):
--   select has_table_privilege('anon', 'public.digital_card_daily', 'select, insert, update, delete') as anon_any,
--          has_table_privilege('authenticated', 'public.digital_card_daily', 'select, insert, update, delete') as authenticated_any;
--
-- 3. Only service_role may execute the functions (false, false, true for each):
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--          has_function_privilege('service_role', p.oid, 'execute') as service_role
--     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'digital\_card\_%' order by 1;
--
-- 4. All three are SECURITY DEFINER with an empty search_path (prosecdef true, proconfig {search_path=""}):
--   select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname like 'digital\_card\_%';
--
-- 5. Empty to start:
--   select count(*) from public.digital_card_daily;   -- 0
--
-- 6. A round trip (rolled back):
--   begin;
--   select public.digital_card_hit('check-068', 'card-1', null, 'qr', 'visit');
--   select public.digital_card_hit('check-068', 'card-1', 'k1', 'nope!', 'click');
--   select public.digital_card_stats('check-068', null, current_date - 1, current_date + 1);
--   -- totals {visits 1, clicks 1}; sources qr (1 visit) and direct (1 click); links [card-1/k1: 1]
--   rollback;
-- ============================================================
