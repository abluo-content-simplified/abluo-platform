import { describe, it, expect } from 'vitest'
import { MODULE_REGISTRY } from '../registry'
import { newsSchemaTypes } from '../news/schema'
import { SECTION_MAP, isSectionTypeAvailable } from '../sections'
import { getNewsModuleMessages, formatNewsDate } from '@/lib/i18n/news-module-messages'
import * as queries from '@/lib/sanity/queries'
import { initialValueTemplates } from '@/lib/sanity/schema'

// ── ADR-020 — News module ────────────────────────────────────────────────────
//
// The News module has to satisfy two checklists that live in CLAUDE.md rather
// than in any single file: the New Section Checklist (a section wired into some
// routes but not others is the exact bug that hid MetricsSection in June 2026)
// and the five-requirement Publicly Routable Content Pattern. These tests
// encode both, so a future module cannot half-land the same way.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyType = any

const manifest = MODULE_REGISTRY.find((m) => m.id === 'news')!

describe('news module manifest', () => {
  it('is registered', () => {
    expect(manifest).toBeDefined()
  })

  it('declares every schema type it defines, and defines every one it declares', () => {
    // The manifest/schemaDefinitions parity invariant: schemaTypes is what the
    // platform believes the module owns; schemaDefinitions is what it actually
    // contributes. A mismatch means a type is either unregistered or orphaned.
    const defined = newsSchemaTypes.map((t) => (t as AnyType).name).sort()
    expect([...manifest.platformContract.schemaTypes].sort()).toEqual(defined)
  })

  it('owns newsListingSection as its only section type', () => {
    expect(manifest.platformContract.sectionTypes).toEqual(['newsListingSection'])
  })

  it('has a singleton page type', () => {
    expect(manifest.platformContract.pageType).toBe('newsPage')
  })

  it('is self-contained — no hard dependencies and no integrations', () => {
    // News must be installable on a website with no other content module.
    expect(manifest.dependencies.requires).toEqual([])
    expect(manifest.dependencies.integratesWith).toEqual([])
  })

  it('stores its data as content', () => {
    // News needs no Supabase migration — ADR-020's "most of this work is Sanity".
    expect(manifest.dataStore.primary).toBe('content')
  })

  it('declares both derived placement surfaces', () => {
    const kinds = manifest.platformContract.placement.surfaces.map((s) => s.kind).sort()
    expect(kinds).toEqual(['page', 'sections'])
  })
})

describe('news module — New Section Checklist', () => {
  it('registers a renderer for its section type in SECTION_MAP', () => {
    // Without this the section renders nothing on every route at once.
    expect(SECTION_MAP.newsListingSection).toBeDefined()
  })

  it('is gated by module installation, not always-on', () => {
    // A module-owned section must disappear when its module is off — that is
    // what makes the module switch meaningful.
    expect(isSectionTypeAvailable('newsListingSection', ['news'])).toBe(true)
    expect(isSectionTypeAvailable('newsListingSection', [])).toBe(false)
    expect(isSectionTypeAvailable('newsListingSection', ['blog'])).toBe(false)
  })

  it('stays available when the module set is unresolved — gating fails open', () => {
    expect(isSectionTypeAvailable('newsListingSection', null)).toBe(true)
  })

  it('projects its hand-picked array in the shared sections projection', () => {
    // articleIds is the one field newsListingSection does not share with
    // blogListingSection. Missing it silently breaks "Manual selection".
    expect(queries.PAGE_SECTIONS_PROJECTION).toContain('"articleIds": articles[]->._id')
  })

  it('has initial value templates for its project-owned documents', () => {
    const ids = initialValueTemplates.map((t: AnyType) => t.id)
    expect(ids).toContain('newsArticleProjectOwned')
    expect(ids).toContain('newsCategoryProjectOwned')
    expect(ids).toContain('newsPageProjectOwned')
  })

  it('names an initial value template that actually exists for each collection', () => {
    const ids = new Set(initialValueTemplates.map((t: AnyType) => t.id))
    for (const group of manifest.platformContract.collections) {
      for (const item of group.items) {
        if (item.initialValueTemplate) {
          expect(ids.has(item.initialValueTemplate)).toBe(true)
        }
      }
    }
  })

  it('gives every schema type a preview', () => {
    for (const type of newsSchemaTypes) {
      expect((type as AnyType).preview).toBeDefined()
    }
  })
})

describe('news module — Publicly Routable Content Pattern', () => {
  const newsArticle = newsSchemaTypes.find((t) => (t as AnyType).name === 'newsArticle')! as AnyType

  it('Requirement 1: uses localizedSlug, never a plain slug', () => {
    const slug = newsArticle.fields.find((f: AnyType) => f.name === 'slug')
    expect(slug.type).toBe('localizedSlug')
  })

  it('Requirement 1: carries a redirectFrom field', () => {
    const redirect = newsArticle.fields.find((f: AnyType) => f.name === 'redirectFrom')
    expect(redirect.type).toBe('redirectFrom')
  })

  it('Requirement 2: the primary lookup does NOT fall back across locales', () => {
    // An Italian URL resolving an English slug would serve one item at two URLs
    // and make the two locales compete in search.
    expect(queries.newsArticleBySlugQuery).toContain('slug[$locale].current == $slug')
    expect(queries.newsArticleBySlugQuery).not.toContain(
      'coalesce(slug[$locale].current, slug[$defaultLocale].current) == $slug'
    )
  })

  it('Requirement 2: the primary lookup returns the full slug map for hreflang', () => {
    expect(queries.newsArticleBySlugQuery).toContain('"slugMap": slug')
  })

  it('Requirement 2: a redirect lookup exists', () => {
    expect(queries.newsArticleByOldSlugQuery).toContain('$slug in redirectFrom[$locale]')
    expect(queries.newsArticleByOldSlugQuery).toContain('"currentSlug": slug[$locale].current')
  })

  it('Requirement 2: list queries DO resolve the slug with a locale fallback', () => {
    // The no-fallback rule applies to routing only — a listing card still needs
    // something to link to when the active locale has no translation.
    expect(queries.newsArticlesQuery).toContain(
      'coalesce(slug[$locale].current, slug[$defaultLocale].current)'
    )
  })
})

describe('news module — tenant scoping', () => {
  const tenantScoped = [
    'newsArticlesQuery',
    'newsArticleBySlugQuery',
    'newsArticleByOldSlugQuery',
    'newsPageQuery',
    'newsListingManualArticlesQuery',
  ] as const

  it.each(tenantScoped)('%s filters by projectSlug', (name) => {
    // CLAUDE.md: every tenant query filters projectSlug. The manual-selection
    // query is the easy one to miss, since its IDs already come from a scoped
    // document — but a stale reference would otherwise cross tenants.
    expect((queries as Record<string, unknown>)[name] as string).toContain(
      'projectSlug == $projectSlug'
    )
  })

  it('listing queries exclude unpublished and expired items', () => {
    for (const q of [queries.newsListingArticlesNewestQuery, queries.newsListingArticlesOldestQuery]) {
      expect(q).toContain('publishedAt <= now()')
      expect(q).toContain('!defined(expiresAt) || expiresAt > now()')
    }
  })

  it('offers no byEvent filter — News integrates with no other module', () => {
    expect(queries.newsListingArticlesNewestQuery).not.toContain('byEvent')
  })
})

describe('news module messages', () => {
  const LOCALES = ['en', 'it', 'de'] as const

  it.each(LOCALES)('%s has a complete, non-empty message set', (locale) => {
    const msg = getNewsModuleMessages(locale)
    expect(msg.backToNews.trim().length).toBeGreaterThan(0)
    expect(msg.newsListLabel.trim().length).toBeGreaterThan(0)
    expect(msg.publishedOn.trim().length).toBeGreaterThan(0)
    expect(msg.readingTime(5)).toContain('5')
  })

  it('falls back to English for an unknown locale rather than throwing', () => {
    expect(getNewsModuleMessages('xx').backToNews).toBe(getNewsModuleMessages('en').backToNews)
  })

  it('produces genuinely different copy per locale', () => {
    // Guards against a copy-paste locale block that silently ships English.
    expect(getNewsModuleMessages('it').backToNews).not.toBe(getNewsModuleMessages('en').backToNews)
    expect(getNewsModuleMessages('de').backToNews).not.toBe(getNewsModuleMessages('en').backToNews)
  })
})

describe('formatNewsDate', () => {
  it('formats in the requested locale, not a hardcoded one', () => {
    const iso = '2026-03-15T00:00:00.000Z'
    const en = formatNewsDate(iso, 'en')
    const it = formatNewsDate(iso, 'it')
    // The bug being guarded against: BlogListingSection formats with a literal
    // 'en', so Italian sites render English month names.
    expect(en).not.toBe(it)
  })

  it('includes the year', () => {
    expect(formatNewsDate('2026-03-15T00:00:00.000Z', 'en')).toContain('2026')
  })

  it('degrades to the raw value for an invalid locale instead of throwing', () => {
    const iso = '2026-03-15T00:00:00.000Z'
    expect(() => formatNewsDate(iso, 'not a locale')).not.toThrow()
  })
})
