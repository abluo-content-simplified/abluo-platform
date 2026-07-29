# Evaluation — Sprint 3 / F1 P0 hotfix (media/[id] auth gate) · 2026-07-23

**Format:** `../maturity-evaluation.md` v1.3 · **Chain:** Supabase & Security specialist (newly stood up, Experimental — §3.3 conditions now met) → release-engineering phase-end readiness. Orchestrator did a backstop code read of the auth helper + route (P0, high-stakes verification per todo policy). Both handoffs accepted first-pass.

## The fix
`src/lib/api/auth.ts` (new): `requireAuthenticatedUser()` reuses proxy.ts's exact `supabase.auth.getUser()` pattern (server-validated, not cookie-decode); `isExpectedDocType()` pure helper. `src/app/api/media/[id]/route.ts` PATCH + DELETE both now: 401 if no user, then parameterized `*[_id == $id][0]._type` fetch → 404 if missing, 400 if not `mediaAsset`, only then mutate. Additive (+54 lines), success path unchanged. 3 new pure-helper tests green; `requireAuthenticatedUser` left for I9 API-auth-test infra (correctly not building HTTP-mock infra in a hotfix). Orchestrator backstop read confirmed code == handoff.

## Scope decision (orchestrator, flagged to Tom)
Hotfix widened from F1 (DELETE only) to F1+F2 (DELETE+PATCH, same file, same P0 class, same fix) — indefensible to ship one and leave the other one function away. Still single-file + one helper module.

## Critical discovery beyond scope
The specialist's caller-trace found the `(admin)` route group (`/en/media`, `/en/dashboard` outside `admin.abluo.app`) has NO login gate — `proxy.ts:206` explicit TODO "Re-enable for /admin when login page is built". Production is safe (admin.abluo.app forces session before /media), so the hotfix doesn't break real uploads; but this is a larger auth gap feeding the sprint's auth-model decision. Not fixed here — correctly surfaced, not swept in.

## Scores
Security specialist: completion 5 · scope 5 (widened correctly, refused the broader model) · evidence 5 (caller trace + auth-pattern trace before writing a line — exactly the mandate) · gates 5 · escalation 5 (flagged the admin-gate gap without resolving it) · efficiency 4 (97K, P0 warranted). release-engineering: 5s; caught that the untracked I1-audit doc must not enter the hotfix commit. Both **continue Experimental**; the Supabase & Security specialist's first task validates standing it up.

## Orchestration criteria (v1.3)
delegation ownership 5 · self-execution 5 (backstop read is verification, not implementation) · parallel safety 5 (backstop read ∥ readiness — independent, orchestrator read is read-only) · dependency 5 · fallback 5 · phase-end 5 (readiness ran before commit guidance; ONE command given) · notification/noise 5.

## Open for Tom
- Commit → local `rm -rf .next && npm run build` (MANDATORY, API route) → `./scripts/release.sh v1.0.17 "Security: authenticate media mutation routes"` → dev/preview/main STOPs (hotfix is still a full release, release-workflow §5).
- Then the FULL I1 sprint: shared auth across all mutating routes (F3), service-role gating (F5), verify-token leak (F6), inquiry-PII PATCH (F7), GROQ injection (F11), /studio (F12 — Tom decides), + the newly-found admin-route-group login gate — paired with I9 (API-auth tests + CI). Auth model still Tom's call.

**Evaluator:** Orchestrator (this session), pending Tom review.
