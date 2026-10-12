# Connections OAuth — who is responsible for what (ADR-031 V1 step 4b)

**Status:** built 2026-10-11. Amendment B of ADR-031 approved by Tom on 2026-10-11.
**Code:** `src/lib/connections/`, `src/app/api/oauth/{token,revoke}/route.ts`
**Tests:** `src/lib/connections/__tests__/` (51 tests, 5 suites)

The OAuth protocol is run by `@node-oauth/oauth2-server` (pinned `^5.3.0`). Everything that decides **who** may get a token, **what** a token reaches and **when** it stops working is ours. Wherever a check exists in both, both run: ours first, then the library's, on the same data.

## 1. The library's responsibilities (5.3.0)

What we rely on `@node-oauth/oauth2-server` for, and only through `server.token()`:

| Area | What the library does |
|---|---|
| Request shape | POST only, `application/x-www-form-urlencoded` only |
| Grant dispatch | Runs `authorization_code` or `refresh_token`; refuses grants the client is not allowed (we allow only these two) |
| Client credentials | Reads HTTP Basic or body credentials and calls our `getClient` |
| Authorization code grant | Code belongs to the client, not expired, consumed **before** PKCE is checked, PKCE S256 verification (ABNF check, timing-safe compare, `plain` disabled), exact `redirect_uri` equality |
| Refresh grant | Token belongs to the client, not expired, old token revoked before the new pair is saved, no scope widening |
| Responses | RFC 6749 §5.1 success body, §5.2 error codes, `Cache-Control: no-store` |

**Not used from the library** (deliberately): the authorize handler (our consent screen issues codes), the authenticate handler (our `access.ts` checks every API request), the password and client-credentials grants, and its random token generator (ours adds recognisable prefixes). The model returns nothing for these paths, so wiring one by mistake fails closed (tested).

**Version:** CVE-2026-41213 (malformed verifiers accepted; codes not consumed on failure) is fixed in 5.3.0. A test fails if an older version is installed.

## 2. Our responsibilities

| Area | Where | What we guarantee |
|---|---|---|
| Secrets | `crypto.ts` | 256-bit CSPRNG values with prefixes `abluo_at_` / `abluo_rt_` / `abluo_ac_` / `abluo_cs_`; only SHA-256 hex stored; constant-time comparison; shape check before any database lookup |
| Partner registration | `admin.ts` | Only Abluo admins (`partners.manage`, new platform permission); redirect URIs exact https or `http://localhost`; client secret shown once, never stored, never emailed; suspend pauses every Connection of the app at once; re-approval resumes exactly those |
| Client authentication | `clients.ts` | Every partner is a confidential client: secret **always** required, including PKCE exchanges (the library alone would accept a client id without a secret there). Approved apps only. One authentication method per request |
| Consent | `consent.ts` | Approved app, exact registered redirect URI (no redirect to anything else, ever), PKCE S256 mandatory, the person holds `connections.manage` on that project (`can()`), support mode never consents, the person can share less than asked but never a resource not asked for, localhost redirects only for sandbox projects, consent recorded (who, when, what) |
| Code exchange | `token-endpoint.ts` | Code consumed **atomically on the first attempt** before any check; then: same app, not expired, verifier shape + S256 match, exact redirect URI, Connection active. A replayed code revokes every token of its Connection and marks it "needs reconnect" (RFC 6749 §4.1.2). Repeated parameters refused |
| Token issue | `model.ts` | Connection re-read at issue time (a revoke between consent and exchange wins); a new authorization supersedes all earlier tokens of the Connection; access 1 h, refresh 90 days |
| Rotation | `model.ts` | Each refresh retires the old token atomically and links its successor. **Grace window (30 s):** a retired token whose successor has not been used yet gets a fresh pair; the unseen successor and its access token are ended. **Reuse** after the window, or after the successor was used: every token revoked, Connection → `needs_reconnect`, audited. A concurrent refresh mid-flight is refused but is not treated as theft |
| Every API request | `access.ts` | Opaque token looked up on every call: access kind, not revoked, not expired, Connection `active`, app `approved`. Pause, revoke and suspension take effect on the very next request |
| Resource permissions | `resources.ts` | `connectionCan(grant, resource, action, projectId)`: own project only, shareable resource only, granted resource only, read only (V1). Website-only fields are not in the registry, so they cannot be granted; personal fields (event hosts) are opt-in; `grantedFields` re-filters against the registry on every use |
| Tenant controls | `manage.ts` | List, pause, resume, revoke — `connections.manage` on the Connection's own project (looked up server-side); another project's id answers "not found"; support mode can look, never change |
| Partner revoke | `revoke-endpoint.ts` (RFC 7009) | Client authenticated; only its own tokens; unknown tokens answer 200 with nothing revealed; revoking a refresh token ends everything and shows "needs reconnect" |
| Database | migration 040 | RLS on, service role only, hash-shape CHECKs, S256-only codes ≤ 10 min, one live Connection per app × project, a revoked Connection never comes back |
| Rate limits | `rate-limit.ts`, `http.ts` | 30 requests/min per IP and per client id per server instance; 8 KB body cap |
| Audit | `store.audit` → `admin_audit_log` | register / approve / suspend app, connect, consent change, pause, resume, revoke, token reuse, code replay, partner token revoke |

## 3. Proven by the tests

Each requested property has its own suite, driving the **real library** through `handleTokenRequest` with an in-memory store that honours the same contract (atomic guards included):

- **Strict project isolation** — `project-isolation.test.ts` (8): a token reaches only its project; sibling site and other tenant refused; two tenants on the same app stay separate; no consent for a project you do not manage (other tenant, editor, support mode); a code stolen by another app is burned; another app can neither refresh nor revoke your tokens; tenant controls never reach another project; localhost only for sandbox.
- **Resource permissions** — `resource-permissions.test.ts` (7): only granted resources, read only; website-only and unknown fields cannot be granted; personal data opt-in; tampered grants filtered; never a resource the app did not ask for; narrowed consent applies to live tokens on the next request; a grant is a copy.
- **Token rotation** — `token-rotation.test.ts` (9): rotation chain; grace-window retry; reuse after the window → everything revoked + needs reconnect + audit; reuse after the successor was used; concurrent refresh; secret required; expiry; reconnect supersedes old tokens; hashes only.
- **Immediate revocation** — `immediate-revocation.test.ts` (10): tenant revoke (next request, refresh and pending code all fail; never comes back); pause/resume; support mode cannot change anything; app suspension and re-approval; partner revokes access or refresh token; revoke endpoint reveals nothing; access expiry; code replay.
- **Library boundary** — `oauth-defence-in-depth.test.ts` (17): patched version; unused library paths fail closed; secretless PKCE refused; CVE-2026-41213 regression; wrong verifier / redirect / expired code burn the code; only two grants; Basic auth; response fields; no internal error leaks. **"Our layer holds without the library":** the library's PKCE and redirect checks are switched off and ours still refuse.

**Mutation check (2026-10-11):** removing any one of our checks (Connection status on access, client secret, reuse revocation, project match, our verifier check, our redirect check, support-mode refusal) makes at least one test fail.

The in-memory store does not prove the SQL; the database invariants are proven by `supabase/verify/hardening-040.verify.mjs`. The step-6 cross-tenant API suite (D8.7) will run the same scenarios against a real database before the API is released.

## 4. Not in step 4b (next)

- **Step 4c — screens:** consent page `/connect/authorize` (calls `validateAuthorizeRequest` / `approveConnect` / `denyConnect`), client dashboard "Connected apps" (`manage.ts`), admin partner apps page (`admin.ts`, secret shown once), en/it/de messages. No partner can complete Connect until 4c ships; the token endpoint is live but has nothing to exchange.
- **Lifecycle pauses (D8.5):** uninstalling Events, pausing the tenant or archiving the project should pause Connections automatically. Until then, step 5's API also checks module and project status per request.
- **Vercel Firewall rule** on `/api/oauth/*` as the durable rate limit (the in-memory one is per instance).
- **Environment:** `CONNECTIONS_SANDBOX_PROJECT_IDS` (comma-separated project ids of demo sites) when the sandbox is set up.
