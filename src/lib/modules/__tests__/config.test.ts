import { describe, it, expect } from 'vitest'
import {
  getModuleConfig,
  isModuleEnabled,
  getEnabledModuleIds,
  resolveWhatsAppConfig,
  resolveHeaderCtaConfig,
  type ProjectModuleConfig,
} from '../config'
import type { RenderableFormDefinition, WebsiteSiteConfig } from '@/lib/sanity/types'

// ── ADR-020 — runtime module configuration resolution ────────────────────────
//
// The behaviour these tests pin down is the transition contract: module config
// is authoritative, siteConfig is a deprecated fallback that must keep live
// sites working until production is promoted, and turning something OFF in the
// module must not fall through to a stale legacy `true`.

const form = (formId: string) => ({ formId, _id: `id-${formId}` } as RenderableFormDefinition)

const modules = (records: ProjectModuleConfig): ProjectModuleConfig => records

describe('getModuleConfig', () => {
  it('returns the config of a listed module', () => {
    const m = modules([{ moduleId: 'whatsapp', config: { whatsappNumber: '+39 1' } }])
    expect(getModuleConfig(m, 'whatsapp')).toEqual({ whatsappNumber: '+39 1' })
  })

  it('returns null for a module that is not listed', () => {
    expect(getModuleConfig(modules([]), 'whatsapp')).toBeNull()
  })

  it('returns null when the module set is unresolved', () => {
    expect(getModuleConfig(null, 'whatsapp')).toBeNull()
    expect(getModuleConfig(undefined, 'whatsapp')).toBeNull()
  })

  it('returns null for a listed module with no config', () => {
    expect(getModuleConfig(modules([{ moduleId: 'blog' }]), 'blog')).toBeNull()
  })
})

describe('isModuleEnabled', () => {
  it('is true only for a listed module', () => {
    // The query projects enabled installations only, so presence == enabled.
    const m = modules([{ moduleId: 'blog' }])
    expect(isModuleEnabled(m, 'blog')).toBe(true)
    expect(isModuleEnabled(m, 'events')).toBe(false)
  })

  it('is false when the module set is unresolved', () => {
    expect(isModuleEnabled(null, 'blog')).toBe(false)
  })
})

describe('getEnabledModuleIds', () => {
  it('maps installations to their module ids', () => {
    const m = modules([{ moduleId: 'blog' }, { moduleId: 'forms' }])
    expect(getEnabledModuleIds(m)).toEqual(['blog', 'forms'])
  })

  it('preserves null for an unresolved module set — gating must fail open', () => {
    // This is the load-bearing case: collapsing null to [] would turn a failed
    // fetch into "hide every module-owned section on the site".
    expect(getEnabledModuleIds(null)).toBeNull()
    expect(getEnabledModuleIds(undefined)).toBeNull()
  })

  it('returns [] for a resolved website with no modules — gating applies', () => {
    expect(getEnabledModuleIds(modules([]))).toEqual([])
  })
})

describe('resolveWhatsAppConfig', () => {
  it('reads number, form, and floating from module config', () => {
    const m = modules([
      {
        moduleId: 'whatsapp',
        config: { whatsappNumber: '+39 335 1', whatsappForm: form('wa'), whatsappFloating: true },
      },
    ])
    const resolved = resolveWhatsAppConfig(m, null)
    expect(resolved.number).toBe('+39 335 1')
    expect(resolved.form?.formId).toBe('wa')
    expect(resolved.floating).toBe(true)
  })

  it('falls back to the deprecated siteConfig fields when the module has no config', () => {
    // The transition case: a site whose content has not been migrated yet must
    // keep its WhatsApp button working.
    const siteConfig = {
      whatsappNumber: '+39 legacy',
      whatsappForm: form('legacy-wa'),
      whatsappFloating: true,
    } as WebsiteSiteConfig

    const resolved = resolveWhatsAppConfig(modules([]), siteConfig)
    expect(resolved.number).toBe('+39 legacy')
    expect(resolved.form?.formId).toBe('legacy-wa')
    expect(resolved.floating).toBe(true)
  })

  it('lets module config win over siteConfig', () => {
    const m = modules([
      { moduleId: 'whatsapp', config: { whatsappNumber: '+39 module', whatsappForm: form('module-wa') } },
    ])
    const siteConfig = {
      whatsappNumber: '+39 legacy',
      whatsappForm: form('legacy-wa'),
    } as WebsiteSiteConfig

    const resolved = resolveWhatsAppConfig(m, siteConfig)
    expect(resolved.number).toBe('+39 module')
    expect(resolved.form?.formId).toBe('module-wa')
  })

  it('lets an explicit module `false` override a legacy `true` floating toggle', () => {
    // A boolean has no empty value, so "unset" and "false" must be told apart.
    // Getting this wrong would make the floating button impossible to switch
    // off for any site that had it on before the migration.
    const m = modules([{ moduleId: 'whatsapp', config: { whatsappFloating: false } }])
    const siteConfig = { whatsappFloating: true } as WebsiteSiteConfig
    expect(resolveWhatsAppConfig(m, siteConfig).floating).toBe(false)
  })

  it('falls back to the legacy floating toggle when the module has not set one', () => {
    const m = modules([{ moduleId: 'whatsapp', config: { whatsappNumber: '+39 1' } }])
    const siteConfig = { whatsappFloating: true } as WebsiteSiteConfig
    expect(resolveWhatsAppConfig(m, siteConfig).floating).toBe(true)
  })

  it('mixes sources per field so a part-migrated site still works', () => {
    const m = modules([{ moduleId: 'whatsapp', config: { whatsappNumber: '+39 module' } }])
    const siteConfig = { whatsappForm: form('legacy-wa') } as WebsiteSiteConfig
    const resolved = resolveWhatsAppConfig(m, siteConfig)
    expect(resolved.number).toBe('+39 module')
    expect(resolved.form?.formId).toBe('legacy-wa')
  })

  it('treats a form with no formId as absent', () => {
    // An unresolvable reference cannot be rendered or submitted; passing it
    // downstream would produce a button that opens a broken overlay.
    const m = modules([{ moduleId: 'whatsapp', config: { whatsappForm: { _id: 'x' } } }])
    expect(resolveWhatsAppConfig(m, null).form).toBeNull()
  })

  it('ignores an empty-string number', () => {
    const m = modules([{ moduleId: 'whatsapp', config: { whatsappNumber: '   ' } }])
    expect(resolveWhatsAppConfig(m, null).number).toBeUndefined()
  })

  it('is fully absent when neither source has anything', () => {
    const resolved = resolveWhatsAppConfig(null, null)
    expect(resolved.number).toBeUndefined()
    expect(resolved.form).toBeNull()
    expect(resolved.floating).toBe(false)
  })
})

describe('resolveHeaderCtaConfig', () => {
  it('reads the CTA form and attribution name from Forms module config', () => {
    const m = modules([
      { moduleId: 'forms', config: { ctaForm: form('cta'), ctaInternalName: 'header-cta' } },
    ])
    const resolved = resolveHeaderCtaConfig(m, null)
    expect(resolved.form?.formId).toBe('cta')
    expect(resolved.internalName).toBe('header-cta')
  })

  it('falls back to the deprecated siteConfig fields', () => {
    const siteConfig = {
      ctaForm: form('legacy-cta'),
      ctaInternalName: 'legacy-name',
    } as WebsiteSiteConfig
    const resolved = resolveHeaderCtaConfig(modules([]), siteConfig)
    expect(resolved.form?.formId).toBe('legacy-cta')
    expect(resolved.internalName).toBe('legacy-name')
  })

  it('lets module config win over siteConfig', () => {
    const m = modules([{ moduleId: 'forms', config: { ctaForm: form('module-cta') } }])
    const siteConfig = { ctaForm: form('legacy-cta') } as WebsiteSiteConfig
    expect(resolveHeaderCtaConfig(m, siteConfig).form?.formId).toBe('module-cta')
  })

  it('does not read CTA config from a module other than forms', () => {
    // ctaForm on the WhatsApp module is not the header CTA — module config is
    // namespaced by module, and cross-reading it would be a silent bug.
    const m = modules([{ moduleId: 'whatsapp', config: { ctaForm: form('wrong') } }])
    expect(resolveHeaderCtaConfig(m, null).form).toBeNull()
  })

  it('is absent when neither source has a form', () => {
    const resolved = resolveHeaderCtaConfig(null, null)
    expect(resolved.form).toBeNull()
    expect(resolved.internalName).toBeUndefined()
  })
})
