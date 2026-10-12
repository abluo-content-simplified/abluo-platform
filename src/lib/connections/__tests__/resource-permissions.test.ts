import { describe, expect, it } from 'vitest'
import { approveConnect } from '../consent'
import { connectionCan, defaultFields, grantedFields, normalizeResources, projectFields } from '../resources'
import type { ConnectionGrant } from '../types'
import { P1A, owner, setup } from './fixture'

// ADR-031 D1/D3 — a Connection reaches only the resources and fields it was
// granted, read-only in V1. Everything else fails closed.

const grant = (resources: ConnectionGrant['resources']): ConnectionGrant => ({
  connectionId: 'c1',
  appId: 'a1',
  tenantId: 't1',
  projectId: P1A,
  locationKeys: [],
  resources,
  sandbox: false,
})

describe('resource permissions', () => {
  it('only granted resources, only read', () => {
    const g = grant({ event: { fields: ['id', 'name'] } })
    expect(connectionCan(g, 'event', 'read', P1A)).toBe(true)
    expect(connectionCan(g, 'event', 'write', P1A)).toBe(false) // V1: no partner writes, ever
    expect(connectionCan(g, 'eventVenue', 'read', P1A)).toBe(false) // not granted
    expect(connectionCan(g, 'contactRequests', 'read', P1A)).toBe(false) // not shareable at all
    expect(connectionCan(g, '__proto__', 'read', P1A)).toBe(false)
    expect(connectionCan(null, 'event', 'read', P1A)).toBe(false)
  })

  it('website-only and unknown fields cannot be granted; personal data is opt-in', () => {
    expect(normalizeResources({ event: { fields: ['name', 'liveStreamUrl'] } })).toEqual({ ok: false, error: 'field_not_shareable:event.liveStreamUrl' })
    expect(normalizeResources({ members: { fields: [] } })).toMatchObject({ ok: false })
    expect(normalizeResources({})).toMatchObject({ ok: false })
    expect(defaultFields('event')).not.toContain('performers')
    const withHosts = normalizeResources({ event: { fields: ['name', 'performers'] } })
    expect(withHosts.ok && withHosts.resources.event.fields).toEqual(['id', 'url', 'createdAt', 'updatedAt', 'timeZone', 'name', 'performers'])
  })

  it('only granted fields leave Abluo, even if a stored grant was tampered with', () => {
    const g = grant({ event: { fields: ['id', 'name', 'liveStreamUrl'] } })
    expect(grantedFields(g, 'event')).toEqual(['id', 'name'])
    expect(projectFields(g, 'event', { id: 'x', name: 'Jazz', startDate: '2026-11-13', liveStreamUrl: 'secret', performers: ['A'] })).toEqual({ id: 'x', name: 'Jazz' })
    expect(grantedFields(g, 'eventVenue')).toEqual([])
  })

  it('the person can share less than the app asked for, never a resource it did not ask for', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app, { scope: 'event:read' })
    const wider = await approveConnect(owner('u1', P1A), { params, projectId: P1A, resources: { event: { fields: ['name'] }, eventVenue: { fields: ['name'] } } }, f.deps)
    expect(wider).toMatchObject({ ok: false, error: 'resources_invalid' })
    const narrower = await approveConnect(owner('u1', P1A), { params, projectId: P1A, resources: { event: { fields: ['name'] } } }, f.deps)
    expect(narrower.ok).toBe(true)
  })

  it('the app may only ask for known resources, read-only', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    for (const scope of ['event:write', 'members:read', '', 'event:read admin']) {
      const { params } = f.authorizeParams(app, { scope })
      const r = await approveConnect(owner('u1', P1A), { params, projectId: P1A, resources: { event: { fields: ['name'] } } }, f.deps)
      expect(r.ok, scope).toBe(false)
      if (!r.ok) expect(r.redirectTo).toContain('error=invalid_scope')
    }
  })

  it('narrowing consent applies to live tokens on their very next request', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    let r = await f.access(c.accessToken)
    expect(r.ok && connectionCan(r.grant, 'eventVenue', 'read', P1A)).toBe(true)
    // The Owner re-consents sharing events only.
    const again = await f.issueCode(app, owner('u1', P1A), P1A, { event: { fields: ['name'] } })
    expect(again.ok).toBe(true)
    r = await f.access(c.accessToken)
    expect(r.ok && connectionCan(r.grant, 'eventVenue', 'read', P1A)).toBe(false)
    expect(r.ok && grantedFields(r.grant, 'event')).toEqual(['id', 'url', 'createdAt', 'updatedAt', 'timeZone', 'name'])
    expect(f.store.audits.map((a) => a.action)).toContain('connection.consent.change')
  })

  it('a grant is a copy: mutating it cannot widen the stored Connection', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A, { event: { fields: ['name'] } })
    const r = await f.access(c.accessToken)
    if (!r.ok) throw new Error('auth')
    r.grant.resources.eventVenue = { fields: ['name'] }
    const again = await f.access(c.accessToken)
    expect(again.ok && connectionCan(again.grant, 'eventVenue', 'read', P1A)).toBe(false)
  })
})
