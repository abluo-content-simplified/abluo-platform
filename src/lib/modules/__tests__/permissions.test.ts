import { describe, it, expect } from 'vitest'
import { buildModulePermissions, MODULE_PERMISSION_MAP } from '../permissions'
import {
  canEditContent,
  canViewLeads,
  canManageSettings,
  canViewBilling,
  canPerformModuleAction,
} from '../../permissions'
import type { ModuleInstallation, ModulePermissionMap } from '../types'

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Creates a minimal ModuleInstallation record for use in tests. */
function makeInstallation(moduleId: string, enabled = true): ModuleInstallation {
  return {
    moduleId,
    version: '1.0.0',
    enabled,
    installedAt: '2026-06-27T00:00:00.000Z',
    config: {},
    provenance: 'admin',
  }
}

// ── buildModulePermissions ────────────────────────────────────────────────────

describe('buildModulePermissions()', () => {
  it('returns an object (the permission map)', () => {
    const map = buildModulePermissions()
    expect(typeof map).toBe('object')
    expect(map).not.toBeNull()
  })

  it('contains all expected blog permission IDs', () => {
    const map = buildModulePermissions()
    expect(map).toHaveProperty('blog.post.read')
    expect(map).toHaveProperty('blog.post.write')
    expect(map).toHaveProperty('blog.post.delete')
    expect(map).toHaveProperty('blog.taxonomy.write')
  })

  it('blog.post.read grants owner, editor, AND viewer by default (all roles can read)', () => {
    const map = buildModulePermissions()
    expect(map['blog.post.read'].defaultRoles).toContain('owner')
    expect(map['blog.post.read'].defaultRoles).toContain('editor')
    expect(map['blog.post.read'].defaultRoles).toContain('viewer')
  })

  it('contains all expected events permission IDs', () => {
    const map = buildModulePermissions()
    expect(map).toHaveProperty('events.event.write')
    expect(map).toHaveProperty('events.event.delete')
    expect(map).toHaveProperty('events.taxonomy.write')
  })

  it('contains all expected live permission IDs', () => {
    const map = buildModulePermissions()
    expect(map).toHaveProperty('live.page.configure')
  })

  it('each entry contains id, label, description, and defaultRoles', () => {
    const map = buildModulePermissions()
    const perm = map['blog.post.write']
    expect(perm).toBeDefined()
    expect(typeof perm.id).toBe('string')
    expect(typeof perm.label).toBe('string')
    expect(typeof perm.description).toBe('string')
    expect(Array.isArray(perm.defaultRoles)).toBe(true)
  })

  it('blog.post.write grants owner and editor by default', () => {
    const map = buildModulePermissions()
    expect(map['blog.post.write'].defaultRoles).toContain('owner')
    expect(map['blog.post.write'].defaultRoles).toContain('editor')
  })

  it('blog.post.write does not grant viewer by default', () => {
    const map = buildModulePermissions()
    expect(map['blog.post.write'].defaultRoles).not.toContain('viewer')
  })

  it('live.page.configure grants owner and editor by default', () => {
    const map = buildModulePermissions()
    expect(map['live.page.configure'].defaultRoles).toContain('owner')
    expect(map['live.page.configure'].defaultRoles).toContain('editor')
  })
})

// ── MODULE_PERMISSION_MAP ─────────────────────────────────────────────────────

describe('MODULE_PERMISSION_MAP', () => {
  it('contains exactly 8 permissions — guards against accidental registry removals', () => {
    // ADR-016 Phase B added events.taxonomy.write (event categories) — was 6.
    // ADR-017 slice 6 added blog.post.read (client dashboard read path) — now 8.
    expect(Object.keys(MODULE_PERMISSION_MAP)).toHaveLength(8)
  })

  it('has the same shape as buildModulePermissions()', () => {
    const built = buildModulePermissions()
    expect(Object.keys(MODULE_PERMISSION_MAP).sort()).toEqual(Object.keys(built).sort())
  })

  it('is a stable reference — same object on repeat access', () => {
    const a = MODULE_PERMISSION_MAP
    const b = MODULE_PERMISSION_MAP
    expect(a).toBe(b)
  })

  it('all 8 expected keys are present', () => {
    const expectedKeys = [
      'blog.post.read',
      'blog.post.write',
      'blog.post.delete',
      'blog.taxonomy.write',
      'events.event.write',
      'events.event.delete',
      'events.taxonomy.write',
      'live.page.configure',
    ]
    for (const key of expectedKeys) {
      expect(MODULE_PERMISSION_MAP).toHaveProperty(key)
    }
  })
})

// ── canPerformModuleAction ────────────────────────────────────────────────────

describe('canPerformModuleAction()', () => {
  const map = MODULE_PERMISSION_MAP
  const allInstalled = [
    makeInstallation('blog'),
    makeInstallation('events'),
    makeInstallation('live'),
  ]

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns true when module is installed, enabled, and role qualifies', () => {
    expect(canPerformModuleAction('owner', 'blog.post.write', allInstalled, map)).toBe(true)
  })

  it('returns true for editor on blog.post.write', () => {
    expect(canPerformModuleAction('editor', 'blog.post.write', allInstalled, map)).toBe(true)
  })

  it('returns true for owner on events.event.write', () => {
    expect(canPerformModuleAction('owner', 'events.event.write', allInstalled, map)).toBe(true)
  })

  it('returns true for editor on events.event.delete', () => {
    expect(canPerformModuleAction('editor', 'events.event.delete', allInstalled, map)).toBe(true)
  })

  it('returns true for owner on live.page.configure', () => {
    expect(canPerformModuleAction('owner', 'live.page.configure', allInstalled, map)).toBe(true)
  })

  // ── Role does not qualify ──────────────────────────────────────────────────

  it('returns false when viewer attempts blog.post.write (not in defaultRoles)', () => {
    expect(canPerformModuleAction('viewer', 'blog.post.write', allInstalled, map)).toBe(false)
  })

  it('returns false when viewer attempts events.event.delete', () => {
    expect(canPerformModuleAction('viewer', 'events.event.delete', allInstalled, map)).toBe(false)
  })

  it('returns false when viewer attempts live.page.configure', () => {
    expect(canPerformModuleAction('viewer', 'live.page.configure', allInstalled, map)).toBe(false)
  })

  // ── Module not installed ───────────────────────────────────────────────────

  it('returns false when the module is not in moduleInstallations', () => {
    const noModules: ModuleInstallation[] = []
    expect(canPerformModuleAction('owner', 'blog.post.write', noModules, map)).toBe(false)
  })

  it('returns false when only unrelated modules are installed', () => {
    const onlyEvents = [makeInstallation('events')]
    expect(canPerformModuleAction('owner', 'blog.post.write', onlyEvents, map)).toBe(false)
  })

  // ── Module installed but disabled ──────────────────────────────────────────

  it('returns false when the module is installed but disabled', () => {
    const blogDisabled = [makeInstallation('blog', false)]
    expect(canPerformModuleAction('owner', 'blog.post.write', blogDisabled, map)).toBe(false)
  })

  it('returns false for editor when the module is disabled', () => {
    const eventsDisabled = [makeInstallation('events', false)]
    expect(canPerformModuleAction('editor', 'events.event.write', eventsDisabled, map)).toBe(false)
  })

  // ── Permission not in map ──────────────────────────────────────────────────

  it('returns false when permissionId is not in the map', () => {
    expect(canPerformModuleAction('owner', 'blog.nonexistent.action', allInstalled, map)).toBe(false)
  })

  it('returns false when permissionId is for a completely unknown module', () => {
    expect(canPerformModuleAction('owner', 'crm.contact.write', allInstalled, map)).toBe(false)
  })

  // ── Malformed permissionId ─────────────────────────────────────────────────

  it('returns false for an empty permissionId', () => {
    expect(canPerformModuleAction('owner', '', allInstalled, map)).toBe(false)
  })

  it('returns false for a permissionId with no dot separator', () => {
    expect(canPerformModuleAction('owner', 'blogpostwrite', allInstalled, map)).toBe(false)
  })

  it('returns false for a permissionId that is only a dot', () => {
    expect(canPerformModuleAction('owner', '.', allInstalled, map)).toBe(false)
  })

  // ── Custom permission map (future extensibility) ───────────────────────────

  it('respects a custom permission map — viewer granted blog.post.write via custom map', () => {
    const customMap: ModulePermissionMap = {
      'blog.post.write': {
        id: 'blog.post.write',
        label: 'Create and edit posts',
        description: 'Create, edit, and publish blog posts.',
        defaultRoles: ['owner', 'editor', 'viewer'], // viewer added in custom map
      },
    }
    expect(canPerformModuleAction('viewer', 'blog.post.write', allInstalled, customMap)).toBe(true)
  })

  it('returns false with a custom map that omits the permission', () => {
    const emptyMap: ModulePermissionMap = {}
    expect(canPerformModuleAction('owner', 'blog.post.write', allInstalled, emptyMap)).toBe(false)
  })
})

// ── Regression — existing platform permission helpers ────────────────────────
// Verifies that introducing canPerformModuleAction() did not change the
// behaviour of any pre-existing platform-wide permission function.

describe('regression — existing platform permission helpers', () => {
  it('canEditContent: owner → true', () => expect(canEditContent('owner')).toBe(true))
  it('canEditContent: editor → true', () => expect(canEditContent('editor')).toBe(true))
  it('canEditContent: viewer → false', () => expect(canEditContent('viewer')).toBe(false))

  it('canViewLeads: owner → true', () => expect(canViewLeads('owner')).toBe(true))
  it('canViewLeads: editor → true', () => expect(canViewLeads('editor')).toBe(true))
  it('canViewLeads: viewer → true', () => expect(canViewLeads('viewer')).toBe(true))

  it('canManageSettings: owner → true', () => expect(canManageSettings('owner')).toBe(true))
  it('canManageSettings: editor → false', () => expect(canManageSettings('editor')).toBe(false))
  it('canManageSettings: viewer → false', () => expect(canManageSettings('viewer')).toBe(false))

  it('canViewBilling: owner → true', () => expect(canViewBilling('owner')).toBe(true))
  it('canViewBilling: editor → false', () => expect(canViewBilling('editor')).toBe(false))
  it('canViewBilling: viewer → false', () => expect(canViewBilling('viewer')).toBe(false))
})
