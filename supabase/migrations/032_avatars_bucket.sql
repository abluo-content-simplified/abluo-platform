-- ============================================================
-- Migration 032 — public Storage bucket for profile photos (2026-10-08)
--
-- People upload their own avatar from the client Account page
-- (src/app/[locale]/(client)/account/actions.ts). Files live at
-- avatars/{userId}/{timestamp}.{jpg|png|webp}; uploads and deletes go through
-- the server action with the service role only — no storage policies grant
-- the anon or authenticated roles write access. The bucket is public so the
-- <img> can load it; safeAvatarUrl only accepts URLs from this project's
-- Storage. Size and type are also limited at bucket level.
--
-- Idempotent. Applied to the shared Supabase instance on 2026-10-08 via the
-- Storage API (same settings); this file keeps the record and recreates it on
-- a fresh database.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
