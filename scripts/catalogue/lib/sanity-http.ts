// ── Catalogue rollout scripts — Sanity HTTP client bound to ONE dataset ───────
// The only network code for Sanity in the rollout scripts. The dataset is part
// of every URL and of the client object (asserted by the runner before every
// transaction). Token values are never printed.

import { exportPageQuery, type Doc } from './docs'
import { ConflictError, type Mutation } from './mutations'
import type { MigrationClient } from './runner'

export const SANITY_API_VERSION = '2026-05-21'
const PAGE = 500

export type HttpClientOptions = { projectId: string; dataset: string; readToken: string; writeToken?: string | null; fetchImpl?: typeof fetch }

export function createHttpClient(o: HttpClientOptions): MigrationClient & { query<T>(groq: string, params?: Record<string, unknown>): Promise<T> } {
  if (!/^[a-z0-9]+$/.test(o.projectId)) throw new Error('invalid Sanity project id')
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(o.dataset)) throw new Error('invalid dataset name')
  const f = o.fetchImpl ?? fetch
  const base = `https://${o.projectId}.api.sanity.io/v${SANITY_API_VERSION}`
  const query = async <T>(groq: string, params: Record<string, unknown> = {}): Promise<T> => {
    const res = await f(`${base}/data/query/${o.dataset}?perspective=raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.readToken}` },
      body: JSON.stringify({ query: groq, params }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Sanity query failed: HTTP ${res.status} ${text.slice(0, 300)}`)
    return JSON.parse(text).result as T
  }
  return {
    dataset: o.dataset,
    query,
    async readAll() {
      const out: Doc[] = []
      let after = ''
      for (;;) {
        const page = await query<Doc[]>(exportPageQuery(PAGE), { after })
        out.push(...page)
        if (page.length < PAGE) return out
        after = page[page.length - 1]._id
      }
    },
    async mutate(mutations: Mutation[], { transactionId }) {
      if (!o.writeToken) throw new Error('no write token: set SANITY_MIGRATION_TOKEN (issued for this run, revoked after)')
      const url = `${base}/data/mutate/${o.dataset}?returnIds=false&visibility=sync`
      const res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.writeToken}` }, body: JSON.stringify({ mutations, transactionId }) })
      const text = await res.text()
      if (res.status === 409) {
        const m = text.match(/"id"\s*:\s*"([^"]+)"/)
        throw new ConflictError(m?.[1] ?? '(unknown)', 'revision')
      }
      if (!res.ok) throw new Error(`Sanity mutate failed: HTTP ${res.status} ${text.slice(0, 400)}`)
    },
  }
}
