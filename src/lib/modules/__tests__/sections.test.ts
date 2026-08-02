import { describe, it, expect } from 'vitest'
import { isSectionTypeAvailable, SECTION_MAP } from '../sections'
import { MODULE_REGISTRY } from '../registry'

// ── isSectionTypeAvailable ──────────────────────────────────────────────────
// ADR-016 Phase D — runtime module-installation gating.
//
// These tests exercise the real MODULE_REGISTRY (blog/events/live) rather than
// a fixture registry, since the predicate itself is built from the module
// registry at import time (SECTION_TYPE_TO_MODULE_ID in ../sections.ts) and
// is not parameterised per call. This mirrors how buildModulePermissions() /
// MODULE_PERMISSION_MAP are tested against the live registry in
// permissions.test.ts.

describe('isSectionTypeAvailable()', () => {
  // ── (a) Module section + module installed → true ──────────────────────────

  it('returns true for a module-owned section when its module is installed', () => {
    expect(isSectionTypeAvailable('blogListingSection', ['blog'])).toBe(true)
  })

  it('returns true for eventsListingSection when events is installed', () => {
    expect(isSectionTypeAvailable('eventsListingSection', ['events'])).toBe(true)
  })

  it('returns true for liveLatestSection when live is installed alongside other modules', () => {
    expect(isSectionTypeAvailable('liveLatestSection', ['blog', 'events', 'live'])).toBe(true)
  })

  // ── (b) Module section + module NOT installed → false ─────────────────────

  it('returns false for a module-owned section when its module is not installed', () => {
    expect(isSectionTypeAvailable('blogListingSection', ['events', 'live'])).toBe(false)
  })

  it('returns false for a module-owned section when the enabled list is empty', () => {
    // A real, resolved empty array means "this tenant has zero modules
    // installed" — a legitimate state (e.g. a fresh, unprovisioned project)
    // that must gate module-owned sections off.
    expect(isSectionTypeAvailable('blogListingSection', [])).toBe(false)
  })

  it('returns false for eventsListingSection when only unrelated modules are installed', () => {
    expect(isSectionTypeAvailable('eventsListingSection', ['blog'])).toBe(false)
  })

  it('returns false for liveLatestSection when live is absent from the resolved list', () => {
    expect(isSectionTypeAvailable('liveLatestSection', ['blog', 'events'])).toBe(false)
  })

  // ── (c) Platform section — never gated, regardless of installs ────────────

  it('returns true for heroLensSection with an empty enabled-module list', () => {
    expect(isSectionTypeAvailable('heroLensSection', [])).toBe(true)
  })

  it('returns true for heroLiveCaptureSection regardless of which modules are installed', () => {
    expect(isSectionTypeAvailable('heroLiveCaptureSection', ['blog'])).toBe(true)
  })

  it('returns true for heroLensSection even when live (its thematically-adjacent module) is not installed', () => {
    expect(isSectionTypeAvailable('heroLensSection', ['blog', 'events'])).toBe(true)
  })

  it('returns true for other known platform section types (contentSection, heroSection)', () => {
    expect(isSectionTypeAvailable('heroSection', [])).toBe(true)
    expect(isSectionTypeAvailable('contentSection', [])).toBe(true)
  })

  // ── (d) Unknown / unmapped section type ────────────────────────────────────
  // Safe default: treat as available. SectionRenderer's platform switch
  // statement is the closed-world authority on unknown _type values (it
  // already returns null for anything it doesn't recognise) — this predicate
  // only answers "is this type module-owned, and if so, is that module
  // installed", so it must not duplicate or second-guess that closed-world
  // check. Defaulting to "available" keeps the predicate decoupled from the
  // switch's case list and guarantees a bug here can never hide a platform
  // section.
  it('returns true for a completely unknown/unmapped section _type', () => {
    expect(isSectionTypeAvailable('someFutureSectionTypeNoOneHasWrittenYet', [])).toBe(true)
  })

  // ── Safe-default contract — undefined/null enabledModuleIds ────────────────
  // This is the core risk called out for Phase D: an unresolved module set
  // (fetch failure, resolution not yet wired for a caller) must fail OPEN,
  // never blank a tenant's existing module-owned content.

  it('returns true for a module-owned section when enabledModuleIds is undefined (unresolved)', () => {
    expect(isSectionTypeAvailable('blogListingSection', undefined)).toBe(true)
  })

  it('returns true for a module-owned section when enabledModuleIds is null (unresolved)', () => {
    expect(isSectionTypeAvailable('eventsListingSection', null)).toBe(true)
  })

  it('returns true for a platform section when enabledModuleIds is undefined', () => {
    expect(isSectionTypeAvailable('heroLensSection', undefined)).toBe(true)
  })
})

// ── Registry consistency ────────────────────────────────────────────────────
// Guards the invariant the predicate depends on: every sectionType declared
// by a module manifest must resolve to that module's id, and no module
// declares a sectionType that collides with another module's.

describe('isSectionTypeAvailable() — registry consistency', () => {
  it('every declared module sectionType round-trips through its own module id', () => {
    for (const manifest of MODULE_REGISTRY) {
      for (const sectionType of manifest.platformContract.sectionTypes) {
        const otherModuleIds = MODULE_REGISTRY.map((m) => m.id).filter((id) => id !== manifest.id)
        expect(isSectionTypeAvailable(sectionType, [manifest.id])).toBe(true)
        expect(isSectionTypeAvailable(sectionType, otherModuleIds)).toBe(false)
      }
    }
  })

  it('every declared module sectionType has a corresponding SECTION_MAP entry', () => {
    // Mirrors the dev-only console.warn cross-check in sections.ts, as an
    // enforced test rather than a runtime-only warning.
    for (const manifest of MODULE_REGISTRY) {
      for (const sectionType of manifest.platformContract.sectionTypes) {
        expect(SECTION_MAP).toHaveProperty(sectionType)
      }
    }
  })
})
