// Sanity client + report location for the People migration scripts.
import { createClient } from '@sanity/client'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

export const API_VERSION = '2026-05-21'

export function arg(name, argv = process.argv) {
  const hit = argv.find((a) => a === name || a.startsWith(`${name}=`))
  if (!hit) return null
  if (hit === name) { const i = argv.indexOf(hit); return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true }
  return hit.slice(name.length + 1)
}

/** write=false uses the READ token only: the proposer physically cannot write. */
export function makeClient({ write }) {
  const token = write ? (process.env.SANITY_API_WRITE_TOKEN ?? '') : (process.env.SANITY_API_READ_TOKEN ?? '')
  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) throw new Error('NEXT_PUBLIC_SANITY_PROJECT_ID missing (run with: node --env-file=.env.local …)')
  if (!token) throw new Error(`${write ? 'SANITY_API_WRITE_TOKEN' : 'SANITY_API_READ_TOKEN'} missing in .env.local`)
  return createClient({
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
    apiVersion: API_VERSION,
    token,
    useCdn: false,
    perspective: 'raw', // published AND drafts
  })
}

/**
 * Where reports go: ~/Abluo/clients/<tenant>[/<project>] when that folder exists
 * (workspace root: $ABLUO_WORKSPACE, ~/Abluo, ~/mnt/Abluo), else the repo's
 * docs/engineering/people-module/reports/.
 */
export function reportDir(tenantSlug, projectSlug, repoRoot) {
  const roots = [process.env.ABLUO_WORKSPACE, join(homedir(), 'Abluo'), join(homedir(), 'mnt', 'Abluo')].filter(Boolean)
  for (const root of roots) {
    for (const rel of [join('clients', tenantSlug, projectSlug), join('clients', tenantSlug)]) {
      const d = join(root, rel)
      if (tenantSlug && existsSync(d)) return { dir: d, where: 'client folder' }
    }
  }
  const d = resolve(repoRoot, 'docs/engineering/people-module/reports')
  mkdirSync(d, { recursive: true })
  return { dir: d, where: 'repo (no ~/Abluo/clients/' + tenantSlug + ' folder exists)' }
}
