# Admin two-factor authentication (TOTP, Supabase AAL2)

**Status:** implemented on `dev` (2026-10-02). Applies to `abluo_admin` only; tenant users are unaffected.

## What is enforced

An `abluo_admin` session must be at Supabase **Authenticator Assurance Level 2** — password *and*
a TOTP code in the same session — to use any admin surface:

| Surface | Gate | aal1 admin gets |
|---|---|---|
| `/studio` (every host), `admin.abluo.app/*`, admin dashboard pages (`/dashboard`, `/media`, `/clients`, …) | `src/proxy.ts` → `requireAdminAal2` | redirect to `/mfa?next=<path>` |
| Admin dashboard layout (`src/app/[locale]/(admin)/layout.tsx`) | `resolveAdminAccess()` (defence in depth for the service-role pages) | redirect to `/mfa` |
| Every admin API route (`/api/sanity/*`, `/api/media/*`, `/api/translate*`, `/api/tenants/[id]/invite`) | `requireAbluoAdmin()` | `403` |

One decision function — `adminGateDecision()` in `src/lib/auth/admin-assurance.ts` — serves all three,
and is fail-closed: anything other than the exact claim `aal2` is "not two-factor". Pinned by
`src/lib/auth/__tests__/admin-assurance.test.ts` and route-by-route by
`src/app/api/__tests__/route-auth-matrix.test.ts`.

The `aal` claim is read only after `getUser()` has validated the same access token with the Supabase
Auth server in the same request, so it is server-verified, not merely decoded. The custom access
token hook (migration 006) only adds `platform_role` and preserves `aal`.

## Enrolling (Tom, once)

1. Deploy, then sign in at `/login` as usual.
2. You land on **`/mfa`** in enrollment mode: scan the QR code with an authenticator app
   (1Password, Google Authenticator, Authy…) or type the key shown under it.
3. Enter the 6-digit code. The session is upgraded to AAL2 and you continue to where you were going.
4. From then on every sign-in is password → `/mfa` code → admin.

**Enroll immediately after the first deploy that carries this change.** Until a factor is verified,
anyone holding the admin password could enroll *their* authenticator on `/mfa`. Once one factor is
verified, Supabase requires AAL2 to enroll another, so the window closes.

## Recovery (lost or replaced phone)

There are no backup codes. Recovery is through the Supabase dashboard, which only the project owner
can reach:

1. Supabase dashboard → project → **Authentication → Users** → open the admin user.
2. In the user's **Multi-factor authentication / Factors** section, **delete** the TOTP factor.
3. Sign in again: `/mfa` is back in enrollment mode. Enroll the new device.

Equivalent API (service role, from a trusted shell — never from app code):
`DELETE {SUPABASE_URL}/auth/v1/admin/users/{user_id}/factors/{factor_id}`.

Tip: enrolling the same QR code in two apps (e.g. phone + password manager) at step 2 above is the
cheapest backup.

## Supabase project setting

TOTP is **on by default** for every Supabase project, on every plan. To confirm: Supabase dashboard →
**Authentication → Sign In / Providers → Multi-Factor Authentication** → *TOTP (App Authenticator)*
= **Enabled**. If it were disabled, step 2 of enrollment shows "MFA enroll is disabled for TOTP" —
enable it there; no code change is needed.

## Not covered here (follow-ups)

- **Database-level admin reads.** Migration 025's `is_abluo_admin()` grants `abluo_admin` read on
  every tenant's rows based on the `platform_role` claim alone. A password-only (aal1) admin token
  used directly against PostgREST with the public anon key still reads them. Add
  `and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'` to `is_abluo_admin()` (supabase/ work).
- **Sanity accounts.** Studio content is read and written with the signed-in *Sanity* user's own
  session. Turn on two-factor on the identity provider used to sign in to sanity.io (Google /
  GitHub / email) for every project member.
