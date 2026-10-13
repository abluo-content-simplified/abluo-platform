// Server-only: uses the write token; never import from a client component.
import { sanityWriteClient } from '@/lib/sanity/server-clients'

/**
 * Sanity's History API (ADR-032 D9 amendment A3/A4) — who made a transaction,
 * what changed in a time window, and a document as it was at a revision or a
 * moment. Verified against the live API 2026-10-13: every transaction carries
 * `author`; `fromTransaction = toTransaction = <id>` returns exactly that
 * transaction; `documents/<id>?revision=` / `?time=` return the document then.
 *
 * Read-only. Goes through the shared write client (its token has read access
 * to every document, which the History API requires) — never a raw HTTP call.
 */

export type HistoryTransaction = { id: string; timestamp: string; author: string; documentIDs: string[] }

/** The one Sanity client every server read goes through (private-dataset readiness), at the History API's version. */
type HistoryClient = Pick<typeof sanityWriteClient, 'request' | 'config' | 'users'>
const historyClient = (): HistoryClient => sanityWriteClient.withConfig({ apiVersion: '2025-02-19' })

function dataset(c: HistoryClient): string {
  const ds = c.config().dataset
  if (!ds) throw new Error('history: Sanity is not configured')
  return ds
}

function ndjson(text: unknown): HistoryTransaction[] {
  const out: HistoryTransaction[] = []
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    const t = JSON.parse(line) as Partial<HistoryTransaction>
    if (typeof t.id === 'string' && typeof t.author === 'string' && typeof t.timestamp === 'string') {
      out.push({ id: t.id, timestamp: t.timestamp, author: t.author, documentIDs: Array.isArray(t.documentIDs) ? t.documentIDs : [] })
    }
  }
  return out
}

/** One transaction of one document (its author and time), or null when Sanity has no such transaction. */
export async function transactionOf(documentId: string, transactionId: string, c: HistoryClient = historyClient()): Promise<HistoryTransaction | null> {
  const raw = await c.request<string>({
    uri: `/data/history/${dataset(c)}/transactions/${encodeURIComponent(documentId)}`,
    query: { excludeContent: 'true', fromTransaction: transactionId, toTransaction: transactionId },
    json: false,
  })
  return ndjson(raw).find((t) => t.id === transactionId) ?? null
}

/** Every transaction (all documents) in [from, to], oldest first, at most `limit`. */
export async function transactionsBetween(from: Date, to: Date, limit: number, c: HistoryClient = historyClient()): Promise<HistoryTransaction[]> {
  const raw = await c.request<string>({
    uri: `/data/history/${dataset(c)}/transactions`,
    query: { excludeContent: 'true', fromTime: from.toISOString(), toTime: to.toISOString(), limit: String(limit) },
    json: false,
  })
  return ndjson(raw)
}

/** A document at a revision or at a moment; null when it did not exist then. */
export async function documentAt(
  documentId: string,
  at: { revision: string } | { time: string },
  c: HistoryClient = historyClient()
): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.request<{ documents?: Array<Record<string, unknown>> }>({
      uri: `/data/history/${dataset(c)}/documents/${encodeURIComponent(documentId)}`,
      query: 'revision' in at ? { revision: at.revision } : { time: at.time },
    })
    return body?.documents?.[0] ?? null
  } catch (e) {
    if ((e as { statusCode?: number })?.statusCode === 404) return null
    throw e
  }
}

let cachedIdentity: Promise<string> | null = null

/**
 * The Sanity identity of the dashboard's write token — every dashboard write
 * is authored by it (verified: `pO76jQMNa` on 2026-10-13). Override with
 * SANITY_DASHBOARD_ACTOR_ID; otherwise asked once per process.
 */
export function dashboardSanityIdentity(c: HistoryClient = historyClient()): Promise<string> {
  const fromEnv = process.env.SANITY_DASHBOARD_ACTOR_ID?.trim()
  if (fromEnv) return Promise.resolve(fromEnv)
  if (!cachedIdentity) {
    cachedIdentity = c.users
      .getById('me')
      .then((me) => {
        if (typeof me?.id !== 'string' || !me.id) throw new Error('history: cannot resolve the dashboard token identity')
        return me.id
      })
      .catch((e) => {
        cachedIdentity = null
        throw e
      })
  }
  return cachedIdentity
}
