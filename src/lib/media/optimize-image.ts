/**
 * Image optimisation through Tinify (TinyPNG) — standing rule: every client
 * image is made lighter for the web before it is used.
 *
 * Uses Tinify's plain HTTP API (no SDK dependency): POST the bytes to
 * `/shrink`, then download the compressed output — resized to fit inside
 * `maxDimension` when the original is larger (phone photos are often 4000px+).
 *
 * Never blocks an upload: without `TINIFY_API_KEY` (local dev) or when Tinify
 * fails (network, monthly quota) the ORIGINAL bytes come back with
 * `optimized: false` and a `reason`, which callers log/report.
 *
 * Note: each successful call spends Tinify compressions (two when resized).
 */

export const TINIFY_ENV_KEY = 'TINIFY_API_KEY'
/** Formats Tinify compresses. Anything else (SVG, GIF, …) is uploaded as is. */
export const TINIFY_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const
const SHRINK_URL = 'https://api.tinify.com/shrink'

export type OptimizeImageResult = {
  data: Buffer
  contentType: string
  optimized: boolean
  reason?: 'no_key' | 'failed' | 'unsupported'
  bytesBefore: number
  bytesAfter: number
}

export type OptimizeImageOptions = {
  /** Defaults to `process.env.TINIFY_API_KEY`. */
  apiKey?: string
  /** Longest edge after optimisation; larger images are scaled down. */
  maxDimension?: number
  fetch?: typeof fetch
}

export async function optimizeImage(
  data: Buffer,
  contentType: string,
  options: OptimizeImageOptions = {}
): Promise<OptimizeImageResult> {
  const apiKey = options.apiKey ?? process.env[TINIFY_ENV_KEY]
  const unchanged = (reason: 'no_key' | 'failed' | 'unsupported'): OptimizeImageResult => ({
    data,
    contentType,
    optimized: false,
    reason,
    bytesBefore: data.length,
    bytesAfter: data.length,
  })
  if (!(TINIFY_TYPES as readonly string[]).includes(contentType)) return unchanged('unsupported')
  if (!apiKey) return unchanged('no_key')

  const doFetch = options.fetch ?? fetch
  const auth = `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`
  const maxDimension = options.maxDimension ?? 2560

  try {
    const shrink = await doFetch(SHRINK_URL, {
      method: 'POST',
      headers: { Authorization: auth },
      body: new Uint8Array(data),
    })
    if (!shrink.ok) return unchanged('failed')
    const body = (await shrink.json()) as {
      output?: { url?: string; width?: number; height?: number; type?: string }
    }
    const outputUrl = shrink.headers.get('location') ?? body.output?.url
    if (!outputUrl || !outputUrl.startsWith('https://api.tinify.com/')) return unchanged('failed')

    const tooBig = (body.output?.width ?? 0) > maxDimension || (body.output?.height ?? 0) > maxDimension
    const output = tooBig
      ? await doFetch(outputUrl, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ resize: { method: 'fit', width: maxDimension, height: maxDimension } }),
        })
      : await doFetch(outputUrl, { headers: { Authorization: auth } })
    if (!output.ok) return unchanged('failed')

    const optimized = Buffer.from(await output.arrayBuffer())
    if (!optimized.length) return unchanged('failed')
    return {
      data: optimized,
      contentType: output.headers.get('content-type') ?? body.output?.type ?? contentType,
      optimized: true,
      bytesBefore: data.length,
      bytesAfter: optimized.length,
    }
  } catch {
    return unchanged('failed')
  }
}
