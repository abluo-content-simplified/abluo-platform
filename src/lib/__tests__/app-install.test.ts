import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DASHBOARD_MANIFEST_URL, dashboardAppMetadata } from '../app-install'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

describe('installable dashboards', () => {
  const root = process.cwd()

  it('serves a manifest and its icons from public/', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'public', DASHBOARD_MANIFEST_URL), 'utf8'))
    expect(manifest.display).toBe('standalone')
    for (const icon of manifest.icons) expect(existsSync(join(root, 'public', icon.src))).toBe(true)
    expect(dashboardAppMetadata.manifest).toBe(DASHBOARD_MANIFEST_URL)
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
