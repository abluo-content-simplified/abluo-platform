import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULE_REGISTRY } from '../registry'
import { initialValueTemplates } from '@/lib/sanity/schema'

// ── Every module page has its Studio template (ADR-033 Amendment G) ─────────
//
// sanity.config.ts (buildModulePageItem) opens a module's singleton page with
//   S.initialValueTemplateItem(`${mod.id}PageProjectOwned`, { projectSlug })
// for EVERY registered module that declares `platformContract.pageType`. A
// missing template breaks "create the page" in Studio — which is how the
// catalogue landing page shipped without one. This guard makes the omission
// fail here, for any module, the day it is written.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Template = { id: string; schemaType: string; parameters?: { name: string }[]; value: (p: any) => Record<string, unknown> }

const templates = initialValueTemplates as unknown as Template[]
const withPage = MODULE_REGISTRY.filter((m) => !!m.platformContract.pageType)

describe('module page templates', () => {
  it('there are module pages to check (the registry is read)', () => {
    expect(withPage.map((m) => m.id)).toContain('catalogue')
  })

  it.each(withPage.map((m) => [m.id, m.platformContract.pageType!] as const))(
    '%s → `${id}PageProjectOwned` exists for %s, takes projectSlug and files the page under it',
    (id, pageType) => {
      const t = templates.find((x) => x.id === `${id}PageProjectOwned`)
      expect(t, `missing initial value template ${id}PageProjectOwned`).toBeDefined()
      expect(t!.schemaType).toBe(pageType)
      expect(t!.parameters?.map((p) => p.name)).toContain('projectSlug')
      expect(t!.value({ projectSlug: 'proj-a' }).projectSlug).toBe('proj-a')
    },
  )

  it('template ids are unique', () => {
    const ids = templates.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cataloguePage starts as a draft: no lifecycle value is preset (ADR-032 — status is derived)', () => {
    const v = templates.find((x) => x.id === 'cataloguePageProjectOwned')!.value({ projectSlug: 'rist' })
    expect(v).toEqual({ projectSlug: 'rist', sections: [] })
    for (const f of ['publishedAt', 'expiresAt', 'archivedAt', 'publishingStatus']) expect(v).not.toHaveProperty(f)
  })

  it('module page templates stay out of the global "+" menu, like the other singleton pages', () => {
    const config = readFileSync(resolve(__dirname, '../../../../sanity.config.ts'), 'utf8')
    const hidden = config.slice(config.indexOf('newDocumentOptions'))
    for (const m of withPage) expect(hidden).toContain(`'${m.id}PageProjectOwned'`)
  })
})
