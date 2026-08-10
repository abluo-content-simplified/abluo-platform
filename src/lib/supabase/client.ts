import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side Supabase client.
 * Use in Client Components only.
 * Uses the anon key — subject to RLS policies.
 *
 * NOTE — `flowType` cannot be set to `'implicit'` here. `@supabase/ssr`'s
 * `createBrowserClient` hardcodes `flowType: "pkce"` in its own GoTrue
 * options object (the literal is spread in AFTER any `options.auth` you
 * pass, so an override is silently discarded — see
 * `node_modules/@supabase/ssr/dist/module/createBrowserClient.js`). This
 * matters for any flow that lands the user on a page with session tokens
 * in the URL FRAGMENT (`#access_token=...&refresh_token=...`) rather than
 * a PKCE `?code=` — e.g. Supabase's default "Invite user" email template.
 * `detectSessionInUrl`'s auto-parse will detect that fragment shape,
 * compare it against this client's forced `flowType: 'pkce'`, find a
 * mismatch, and throw internally (swallowed by GoTrue's own
 * `_initialize()`) — no session gets set, silently. Any page that expects
 * to receive fragment-based tokens (see `src/app/invite/accept/page.tsx`)
 * must parse `window.location.hash` and call `auth.setSession()`
 * explicitly rather than relying on this client's built-in URL detection.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
