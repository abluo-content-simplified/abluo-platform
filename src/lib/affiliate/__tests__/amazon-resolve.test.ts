import { describe, expect, it, vi } from 'vitest'
import { resolveAmazonShortLink, type ResolveFetch } from '../amazon-resolve'

const redirect = (to: string, status = 301): Response => new Response(null, { status, headers: { location: to } })

describe('resolveAmazonShortLink', () => {
  it('follows the redirect to the marketplace product URL and stops there (never fetches the product page)', async () => {
    const f = vi.fn<ResolveFetch>(async () => redirect('https://www.amazon.it/Name/dp/B08N5WRWNW?ref=x'))
    const r = await resolveAmazonShortLink('https://amzn.eu/d/abc', { fetch: f })
    expect(r).toEqual({ ok: true, url: 'https://www.amazon.it/Name/dp/B08N5WRWNW?ref=x' })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://amzn.eu/d/abc')
    expect(init.redirect).toBe('manual')
    expect(init.credentials).toBe('omit')
    expect(init.headers).not.toHaveProperty('cookie')
  })

  it('follows a chain of short links and relative locations', async () => {
    const seen: string[] = []
    const f: ResolveFetch = async (u) => {
      seen.push(u)
      return seen.length === 1 ? redirect('https://amzn.to/second') : redirect('https://www.amazon.de/dp/B08N5WRWNW')
    }
    expect(await resolveAmazonShortLink('https://a.co/d/x', { fetch: f })).toEqual({ ok: true, url: 'https://www.amazon.de/dp/B08N5WRWNW' })
    expect(seen).toEqual(['https://a.co/d/x', 'https://amzn.to/second'])
  })

  it('refuses a redirect to a non-Amazon host without contacting it', async () => {
    const f = vi.fn<ResolveFetch>(async () => redirect('https://evil.example.com/dp/B08N5WRWNW'))
    expect(await resolveAmazonShortLink('https://amzn.eu/d/abc', { fetch: f })).toEqual({ ok: false, error: 'not_amazon' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('refuses a look-alike host', async () => {
    const f: ResolveFetch = async () => redirect('https://amazon.de.evil.com/dp/B08N5WRWNW')
    expect(await resolveAmazonShortLink('https://amzn.eu/d/abc', { fetch: f })).toEqual({ ok: false, error: 'not_amazon' })
  })

  it('a link that is not an Amazon short link is never fetched', async () => {
    const f = vi.fn<ResolveFetch>()
    expect(await resolveAmazonShortLink('https://example.com/x', { fetch: f })).toEqual({ ok: false, error: 'not_short_link' })
    expect(await resolveAmazonShortLink('https://www.amazon.de/dp/B08N5WRWNW', { fetch: f })).toEqual({ ok: false, error: 'not_short_link' })
    expect(f).not.toHaveBeenCalled()
  })

  it('fails when the marketplace URL carries no product', async () => {
    const f: ResolveFetch = async () => redirect('https://www.amazon.de/')
    expect(await resolveAmazonShortLink('https://amzn.eu/d/abc', { fetch: f })).toEqual({ ok: false, error: 'failed' })
  })

  it('fails on a non-redirect answer, a missing location, a network error and a loop', async () => {
    expect(await resolveAmazonShortLink('https://amzn.eu/d/a', { fetch: async () => new Response('ok', { status: 200 }) })).toEqual({ ok: false, error: 'failed' })
    expect(await resolveAmazonShortLink('https://amzn.eu/d/a', { fetch: async () => new Response(null, { status: 301 }) })).toEqual({ ok: false, error: 'failed' })
    expect(await resolveAmazonShortLink('https://amzn.eu/d/a', { fetch: async () => { throw new Error('dns') } })).toEqual({ ok: false, error: 'failed' })
    expect(await resolveAmazonShortLink('https://amzn.eu/d/a', { fetch: async () => redirect('https://amzn.eu/d/a') })).toEqual({ ok: false, error: 'failed' })
  })

  it('times out', async () => {
    const f: ResolveFetch = (_u, init) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new Error('aborted')))
      })
    expect(await resolveAmazonShortLink('https://amzn.eu/d/slow', { fetch: f, timeoutMs: 20 })).toEqual({ ok: false, error: 'timeout' })
  })
})
