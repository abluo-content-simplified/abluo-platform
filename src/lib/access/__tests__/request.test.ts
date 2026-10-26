/** ADR-040 B2.3 — the pure request helpers behind the visitor routes. */
import { describe, it, expect } from 'vitest'
import { isSameOriginPost, isSecureAccessRequest, parseAccessNotice, requestOrigin, resolveAccessRouteProject, safeReturnPath, withAccessNotice } from '../request'

const h = (o: Record<string, string>) => new Headers(o)

describe('requestOrigin / isSecureAccessRequest', () => {
  it('https everywhere except local development; a forged http proto is ignored', () => {
    expect(requestOrigin(h({ host: 'preview.abluo.app', 'x-forwarded-proto': 'https' }))).toBe('https://preview.abluo.app')
    expect(requestOrigin(h({ host: 'preview.abluo.app', 'x-forwarded-proto': 'http' }))).toBe('https://preview.abluo.app')
    expect(requestOrigin(h({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
    expect(requestOrigin(h({ host: 'cyce.localhost:3000' }))).toBe('http://cyce.localhost:3000')
    expect(requestOrigin(h({ host: 'bad host/x' }))).toBeNull()
    expect(isSecureAccessRequest(h({ host: 'localhost:3000' }))).toBe(false)
    expect(isSecureAccessRequest(h({ host: 'example.com' }))).toBe(true)
    expect(isSecureAccessRequest(h({}))).toBe(true) // unknown → the strict cookie
  })
  it('same-origin POST: exact origin, case-insensitive, Sec-Fetch-Site same-origin when present', () => {
    expect(isSameOriginPost(h({ host: 'Example.com', origin: 'https://example.com' }))).toBe(true)
    expect(isSameOriginPost(h({ host: 'example.com', origin: 'https://example.com:443' }))).toBe(false)
    expect(isSameOriginPost(h({ host: 'example.com', origin: 'https://sub.example.com' }))).toBe(false)
    expect(isSameOriginPost(h({ host: 'example.com', origin: 'https://example.com', 'sec-fetch-site': 'none' }))).toBe(false)
  })
})

describe('resolveAccessRouteProject', () => {
  it('own host, shared preview host, dev alias, bare localhost; nothing else', () => {
    expect(resolveAccessRouteProject('ch-psicoterapeuta.com', 'hoffmann')?.hostScoped).toBe(true)
    expect(resolveAccessRouteProject('preview.abluo.app', 'hoffmann')?.hostScoped).toBe(false)
    expect(resolveAccessRouteProject('dev.abluo.app', 'cyce')?.hostScoped).toBe(false)
    expect(resolveAccessRouteProject('dev.abluo.app', 'abluo')?.hostScoped).toBe(true)
    expect(resolveAccessRouteProject('localhost:3000', 'hoffmann')?.hostScoped).toBe(false)
    expect(resolveAccessRouteProject('ch-psicoterapeuta.com', 'cyce')).toBeNull()
    expect(resolveAccessRouteProject('hoffmann.preview.abluo.app', 'cyce')).toBeNull()
    expect(resolveAccessRouteProject('some-domain.example', 'hoffmann')).toBeNull()
    expect(resolveAccessRouteProject('preview.abluo.app', 'not-a-project')).toBeNull()
    expect(resolveAccessRouteProject('preview.abluo.app', '')).toBeNull()
  })
})

describe('safeReturnPath / notices', () => {
  it('accepts the site itself and below, normalises, drops stale notices', () => {
    expect(safeReturnPath('/en/s', '/en/s')).toBe('/en/s')
    expect(safeReturnPath('/en/s/a/b?x=1&access=wait&wait=3#f', '/en/s')).toBe('/en/s/a/b?x=1#f')
    expect(safeReturnPath('/en/sx', '/en/s')).toBeNull()
    expect(safeReturnPath('/en/s/%2e%2e/other', '/en/s')).toBeNull()
    expect(safeReturnPath('/en/s/a\nb', '/en/s')).toBeNull()
    expect(safeReturnPath(42, '/en/s')).toBeNull()
    expect(safeReturnPath('/' + 'a'.repeat(3000), '/')).toBeNull()
  })
  it('round-trips the outcome; unknown values are ignored; minutes are clamped', () => {
    expect(withAccessNotice('/en/s/p?x=1', 'wait', 999)).toBe('/en/s/p?x=1&access=wait&wait=120')
    expect(parseAccessNotice({ access: 'wait', wait: '7' })).toEqual({ notice: 'wait', waitMinutes: 7 })
    expect(parseAccessNotice({ access: 'wrong', wait: '7' })).toEqual({ notice: 'wrong', waitMinutes: null })
    expect(parseAccessNotice({ access: '<script>' })).toEqual({ notice: null, waitMinutes: null })
    expect(parseAccessNotice({ access: ['signed_out', 'x'] }).notice).toBe('signed_out')
    expect(parseAccessNotice(undefined).notice).toBeNull()
  })
})
