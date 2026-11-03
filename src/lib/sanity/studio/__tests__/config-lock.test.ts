/**
 * C9 §9.3 R2 config lock — T-12 `modules-pane-readonly` and T-15 `lock-phases` (config part):
 * the Catalogue's module config is edited only in Catalogue → Setup; Studio shows it read-only in
 * the Modules pane and in the raw project form, from the R2 phase on. Status toggling stays.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { buildModuleConfigSchemaTypes, moduleInstallationTypeName } from '@/lib/modules/config-schema'
import { CATALOGUE_LOCK_PHASE, catalogueDocumentActions, isCatalogueScopedDocumentId } from '../catalogue-posture'
import { DASHBOARD_CONFIG_NOTICE, configSurfaceIsDashboard, configValueText, modulesWithDashboardConfig } from '../config-lock'
import { LockedModuleConfig } from '../LockedModuleConfig'
import { buildInstallationPatch } from '../module-save'

const catalogue = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!

describe('which modules are dashboard-configured', () => {
  it('derived from the manifest flag, not a hard-coded id: the Catalogue only', () => {
    expect(catalogue.configSurface).toBe('dashboard')
    expect(modulesWithDashboardConfig()).toEqual(['catalogue'])
    expect(modulesWithDashboardConfig([{ id: 'x', configSurface: 'dashboard' }, { id: 'y' }])).toEqual(['x'])
  })

  it('T-15: R1 → the config stays writable; R2 (current) → read-only', () => {
    expect(CATALOGUE_LOCK_PHASE).toBe('R2')
    expect(configSurfaceIsDashboard('catalogue', { phase: 'R1' })).toBe(false)
    expect(configSurfaceIsDashboard('catalogue')).toBe(true)
    expect(configSurfaceIsDashboard('blog')).toBe(false)
    expect(configSurfaceIsDashboard(undefined)).toBe(false)
  })
})

describe('T-12 — the project form: moduleInstallations[].config is readOnly for the Catalogue only', () => {
  const types = buildModuleConfigSchemaTypes() as unknown as Array<{ name: string; fields: Array<{ name: string; readOnly?: unknown }> }>
  const configField = (moduleId: string) => {
    const manifest = MODULE_REGISTRY.find((m) => m.id === moduleId)!
    return types.find((t) => t.name === moduleInstallationTypeName(manifest))!.fields.find((f) => f.name === 'config')!
  }

  it('catalogue: readOnly(parent) is true; blog: false', () => {
    const ro = configField('catalogue').readOnly as (ctx: { parent?: { moduleId?: string } }) => boolean
    expect(ro({ parent: { moduleId: 'catalogue' } })).toBe(true)
    expect(ro({})).toBe(true)
    const blog = configField('blog').readOnly as (ctx: { parent?: { moduleId?: string } }) => boolean
    expect(blog({ parent: { moduleId: 'blog' } })).toBe(false)
  })
})

describe('T-12 — the Modules pane', () => {
  it('renders the stored values as text with the sentence, and NO inputs', () => {
    const fields = catalogue.platformContract.configSchema.filter((f) => !f.hidden)
    const html = renderToStaticMarkup(createElement(LockedModuleConfig, { fields, config: { publicSegment: 'menu', currency: 'EUR', showPricesByDefault: true, publicName: { _type: 'localizedString', en: 'Menu' } } }))
    expect(html).toContain(DASHBOARD_CONFIG_NOTICE)
    expect(html).toContain('menu')
    expect(html).toContain('en: Menu')
    expect(html).not.toMatch(/<(input|select|textarea|button)\b/)
  })

  it('ModuleList gates the Configuration section and the save on the lock (config travels unchanged)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/sanity/studio/ModuleList.tsx'), 'utf8')
    expect(src).toMatch(/const configLocked = !!installation && configSurfaceIsDashboard\(manifest\.id\)/)
    expect(src).toMatch(/configLocked \? \(\s*<LockedModuleConfig/)
    expect(src).toMatch(/config: configLocked \? \(installation\?\.config/)
  })

  it('a status-only save of a locked module touches no config key', () => {
    const before = { _key: 'k', moduleId: 'catalogue', enabled: true, config: { publicSegment: 'menu', currency: 'EUR' } }
    const patch = buildInstallationPatch(before, { ...before, enabled: false })
    expect(patch).toEqual({ set: { 'moduleInstallations[_key=="k"].enabled': false }, unset: [] })
  })

  it('value text: lists, booleans, empty', () => {
    expect(configValueText([{ value: 'dine-in' }, { value: 'delivery' }])).toBe('dine-in, delivery')
    expect(configValueText(false)).toBe('No')
    expect(configValueText(undefined)).toBe('—')
  })
})

describe('R2: Catalogue taxonomyTerm records lose their Studio document actions (C9 layer 2)', () => {
  it('recognised by the deterministic id; other modules keep their actions; R1 unchanged', () => {
    expect(isCatalogueScopedDocumentId('taxonomyTerm', 'term.tmz.catalogue.category.technology')).toBe(true)
    expect(isCatalogueScopedDocumentId('taxonomyTerm', 'drafts.term.tmz.catalogue.tag.illustrated_boos')).toBe(true)
    expect(isCatalogueScopedDocumentId('taxonomyTerm', 'term.tmz.blog.category.news')).toBe(false)
    expect(isCatalogueScopedDocumentId('taxonomyTerm', 'term.tmz.catalogue.category.technology', 'R1')).toBe(false)
    expect(isCatalogueScopedDocumentId('post', 'term.tmz.catalogue.category.technology')).toBe(false)
    const prev = [{ action: 'publish' }, { action: 'delete' }, { action: 'duplicate' }]
    expect(catalogueDocumentActions(prev, { state: { grants: [], loaded: true }, now: new Date() })).toEqual([])
  })

  it('sanity.config.ts routes them through the Catalogue branch', () => {
    const src = readFileSync(join(process.cwd(), 'sanity.config.ts'), 'utf8')
    expect(src).toMatch(/isCatalogueStudioDoc\(context\.schemaType\) \|\| isCatalogueScopedDocumentId\(context\.schemaType, context\.documentId\)/)
  })
})
