import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** /favicon.ico → each site's own favicon (Freeriders kept showing Abluo's). */

let answer: () => Promise<unknown> = async () => null
vi.mock('@/lib/sanity/client', () => ({ tenantClient: () => ({ fetchForTenant: () => answer() }) }))

const { GET } = await import('@/app/api/site-favicon/route')
const call = (host: string) => GET(new NextRequest(`https://${host}/favicon.ico`, { headers: { host } }))

describe('GET /favicon.ico', () => {
  it('a site with its own favicon: redirect to it, as a PNG', async () => {
    answer = async () => ({ faviconPng: { asset: { _ref: 'image-9ba5e297e14fdb8b6ea2b073448802dfb0c9707c-32x32-png' } } })
    const res = await call('freeriders.app')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/^https:\/\/cdn\.sanity\.io\/images\/.+9ba5e297e14fdb8b6ea2b073448802dfb0c9707c-32x32\.png\?.*fm=png/)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('a site with only a Sign: the tab icon is made from it', async () => {
    answer = async () => ({ faviconSvg: null, faviconPng: null, brandMark: { asset: { _ref: 'image-1234567890abcdef1234567890abcdef12345678-154x103-svg' } } })
    expect((await call('freeriders.app')).headers.get('location')).toMatch(/1234567890abcdef1234567890abcdef12345678-154x103\.svg\?.*fm=png/)
  })

  it('a site without one, or a platform host: the platform icon', async () => {
    answer = async () => ({ faviconSvg: null, faviconPng: null })
    expect((await call('freeriders.app')).headers.get('location')).toBe('https://freeriders.app/favicon.ico?default=1')
    expect((await call('admin.abluo.app')).headers.get('location')).toBe('https://admin.abluo.app/favicon.ico?default=1')
  })

  it('Sanity unreachable: the platform icon, never an error', async () => {
    answer = async () => { throw new Error('down') }
    expect((await call('freeriders.app')).headers.get('location')).toBe('https://freeriders.app/favicon.ico?default=1')
  })
})
