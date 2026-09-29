import { TranslateError } from '../types'
import type { FetchLike } from './types'

/**
 * POST JSON and return the parsed body, normalising every failure to a
 * TranslateError. The raw provider message is kept for the server log only
 * (TranslateError.message) — the client only ever sees the code.
 */
export async function postJson<T>(
  fetchImpl: FetchLike,
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new TranslateError('network_error', `${providerLabel}: ${String(err)}`)
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 500)
    } catch {
      /* ignore */
    }
    throw new TranslateError('provider_error', `${providerLabel} HTTP ${res.status} ${detail}`)
  }
  try {
    return (await res.json()) as T
  } catch (err) {
    throw new TranslateError('provider_error', `${providerLabel}: invalid JSON (${String(err)})`)
  }
}

export function assertSameLength(providerLabel: string, expected: number, got: unknown[]): void {
  if (got.length !== expected) {
    throw new TranslateError(
      'provider_error',
      `${providerLabel}: expected ${expected} translations, got ${got.length}`
    )
  }
}
