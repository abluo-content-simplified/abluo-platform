import { createClient, type SanityClient } from '@sanity/client'
import { SANITY_PROJECT_ID, SANITY_DATASET, SANITY_API_VERSION } from '@/lib/sanity/config'

/**
 * Server-only, token-carrying Sanity clients for ADMIN surfaces and
 * service operations (the media library API, the admin document lookup).
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * Before it, five route files each built their own `createClient({...})`,
 * one of them (`/api/sanity/document`) with NO token at all, and the admin
 * Media page built one IN THE BROWSER. Both of those are anonymous reads,
 * and an anonymous read returns 401 the moment the dataset is flipped to
 * private (docs/engineering/sanity-private-dataset.md). One module means one
 * place that decides which credential a server read carries, and one place a
 * test can pin (`__tests__/private-dataset-readiness.test.ts`).
 *
 * ── Which token ─────────────────────────────────────────────────────────────
 *  - `sanityWriteClient` — `SANITY_API_WRITE_TOKEN`. Every mutation goes
 *    through this. Unset → mutations fail with Sanity's own 401/403 (they
 *    already did before this module existed).
 *  - `sanityServerReadClient` — the write token when present (an Editor token
 *    reads too), else `SANITY_API_READ_TOKEN`, else anonymous. Anonymous is
 *    the pre-flip behaviour, byte-for-byte; it stops working only if the
 *    dataset is private AND neither token is configured — the same
 *    precondition the website client already has.
 *
 * Neither name is `NEXT_PUBLIC_`, and nothing that can reach a browser bundle
 * may import this file — enforced by the import-graph walk in
 * `__tests__/private-dataset-readiness.test.ts`.
 *
 * No `perspective` is set: at `SANITY_API_VERSION` (2026-05-21, i.e. after
 * 2025-02-19) the API's default perspective is `published`, so a token does
 * not start returning drafts. Matches `sanityClient` in `./client.ts`.
 */

function token(...candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) if (c) return c
  return undefined
}

function build(t: string | undefined): SanityClient {
  return createClient({
    projectId: SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
    apiVersion: SANITY_API_VERSION,
    useCdn: false,
    ...(t ? { token: t } : {}),
  })
}

export const sanityWriteClient: SanityClient = build(token(process.env.SANITY_API_WRITE_TOKEN))

export const sanityServerReadClient: SanityClient = build(
  token(process.env.SANITY_API_WRITE_TOKEN, process.env.SANITY_API_READ_TOKEN)
)
