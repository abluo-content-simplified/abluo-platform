import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ADMIN_MANIFEST_URL, DASHBOARD_MANIFEST_URL, adminAppMetadata, adminIcons, clientIcons, dashboardAppMetadata } from '../app-install'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

describe('installable dashboards', () => {
  const root = process.cwd()

  it('serves both manifests and their icons from public/', () => {
    for (const url of [DASHBOARD_MANIFEST_URL, ADMIN_MANIFEST_URL]) {
      const manifest = JSON.parse(readFileSync(join(root, 'public', url), 'utf8'))
      expect(manifest.display).toBe('standalone')
      for (const icon of manifest.icons) expect(existsSync(join(root, 'public', icon.src))).toBe(true)
    }
    expect(dashboardAppMetadata.manifest).toBe(DASHBOARD_MANIFEST_URL)
    expect(adminAppMetadata.manifest).toBe(ADMIN_MANIFEST_URL)
  })

  it('every tab and home-screen icon file exists (light = client, dark = admin)', () => {
    for (const set of [clientIcons, adminIcons]) {
      const s = set as { icon: { url: string }[]; apple: { url: string }[] }
      for (const i of [...s.icon, ...s.apple]) expect(existsSync(join(root, 'public', i.url))).toBe(true)
    }
    expect(JSON.stringify(adminIcons)).toContain('/dashboard/admin/')
    expect(JSON.stringify(clientIcons)).not.toContain('/admin/')
  })

  it('the manifest URL is a .json path, which the proxy serves without auth or routing', () => {
    expect(DASHBOARD_MANIFEST_URL).toMatch(/\.json$/)
  })

  it('no website source references the dashboard manifest or app metadata', () => {
    const offenders = sources(join(root, 'src/app/[locale]/(website)')).filter((f) => {
      const t = readFileSync(f, 'utf8')
      return t.includes('app-install') || t.includes('dashboard/manifest') || t.includes('dashboardAppMetadata')
    })
    expect(offenders).toEqual([])
  })
})
