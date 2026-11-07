-- ===========================================================================
-- reservations-pg-cron.sql — DRAFT, NOT A MIGRATION, NOT APPLIED.
--
-- WHAT: a Supabase pg_cron job that calls the Reservations sweep route every
-- 15 minutes (ADR-044 D10). The route expires lapsed holds, queues the "hold
-- lapsed" emails and delivers every due row of reservation_outbox.
--   GET <site>/api/cron/reservations-sweep   Authorization: Bearer <CRON_SECRET>
--
-- WHY pg_cron and not vercel.json: Vercel Cron on the current plan runs once a
-- day; hold expiry, reminders and retries need to run at least hourly (Tom,
-- 2026-11-07). pg_cron + pg_net calls the same route from inside Supabase.
--
-- HOW TO RUN (Tom), once, after migration 066 and the app deploy are live:
--   1. Supabase Dashboard -> Database -> Extensions: enable pg_cron and pg_net
--      (step 2 below does it too, if your role may).
--   2. SQL editor: run STEP 1 (extensions).
--   3. SQL editor: run STEP 2 with REAL values typed in place of the two
--      placeholders. Do not commit them anywhere. The secrets live in Vault
--      (encrypted at rest); the job below only reads them by name.
--        cron_secret              = the value of CRON_SECRET in Vercel
--        reservations_sweep_url   = the PRODUCTION address of the route
--   4. Run STEP 3 (the schedule).
--   5. Check with STEP 4 after 15 minutes.
--
-- ONE DATABASE SERVES ALL ENVIRONMENTS: the URL must be the production
-- deployment. The consumer only delivers rows whose `environment` equals the
-- environment of the deployment that receives the call, so production rows are
-- mailed by production and preview rows are left alone.
--
-- Also set in Vercel (all environments that should send test mail):
--   RESERVATIONS_TEST_RECIPIENT  an address of yours. Outside production,
--                                reservation emails go ONLY there (prefixed
--                                [TEST]); unset = they are skipped.
-- ===========================================================================

-- STEP 1 — extensions -------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- STEP 2 — secrets in Vault (run once; replace the placeholders) -------------
-- vault.create_secret(secret, name, description). To change a value later use
-- vault.update_secret(<id from vault.secrets>, '<new value>') instead.
select vault.create_secret('<PUT-THE-CRON_SECRET-VALUE-HERE>', 'cron_secret', 'Bearer secret for /api/cron/* routes');
select vault.create_secret('https://<production-host>/api/cron/reservations-sweep', 'reservations_sweep_url', 'Production URL of the reservations sweep route');

-- STEP 3 — the job: every 15 minutes -----------------------------------------
-- cron.schedule with an existing job name replaces that job, so re-running is safe.
select cron.schedule(
  'reservations-sweep',
  '*/15 * * * *',
  $job$
  select net.http_get(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reservations_sweep_url'),
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
               ),
    timeout_milliseconds := 55000
  );
  $job$
);

-- STEP 4 — check it works -----------------------------------------------------
-- Did the job fire?            (status 'succeeded' = the HTTP call was queued)
--   select jobid, status, return_message, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'reservations-sweep')
--    order by start_time desc limit 5;
-- What did the route answer?   (200 + {"ok":true,...}; 401 = wrong cron_secret)
--   select id, status_code, content, created from net._http_response order by created desc limit 5;
-- What is waiting / failing?
--   select status, count(*) from public.reservation_outbox group by status;
--   select intent, status, attempts, last_error from public.reservation_outbox
--    where status in ('failed', 'dead') order by updated_at desc limit 20;

-- UNSCHEDULE (stop the job; leaves the secrets in Vault) ----------------------
--   select cron.unschedule('reservations-sweep');
-- Remove the secrets too (only if nothing else uses cron_secret!):
--   delete from vault.secrets where name in ('reservations_sweep_url');
