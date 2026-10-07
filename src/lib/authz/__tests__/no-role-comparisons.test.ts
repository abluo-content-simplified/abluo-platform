/**
 * ADR-028 §2 — application code never decides access by comparing role
 * names. It asks for a permission (`can()`, `grant.permissions`,
 * `assertModuleAction`). This test fails the build when a role comparison
 * appears outside the few files allowed to know role names.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const ROLE = '(owner|admin|editor|viewer|member)'
const PATTERNS: RegExp[] = [
  // grant.role === 'owner', role !== "viewer", x.role == 'editor'
  new RegExp(`\\brole\\s*[!=]==?\\s*['"]${ROLE}['"]`),
  // 'owner' === grant.role
  new RegExp(`['"]${ROLE}['"]\\s*[!=]==?\\s*[\\w.?]*\\brole\\b`),
  // the retired role functions of src/lib/permissions.ts
  /\b(canEditContent|canManageMedia|canViewLeads|canUpdateLeads|canViewAnalytics|canViewSettings|canManageSettings|canInviteUsers|canManageUsers|canViewBilling)\s*\(/,
]

/** Files allowed to know role names (posix paths relative to src/). */
const ALLOWED = [
  'lib/authz/', // the authorization core itself
  'lib/api/tenant-context.ts', // builds grants from membership rows
  'lib/permissions.ts', // legacy role functions, kept only for their own tests until removed
  'lib/types/roles.ts',
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : files(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('no role-name comparisons outside the authorization core', () => {
  it('every access decision goes through a permission', () => {
    const offenders: string[] = []
    for (const file of files(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/')
      if (ALLOWED.some((a) => rel === a || rel.startsWith(a))) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (PATTERNS.some((p) => p.test(line))) offenders.push(`src/${rel}:${i + 1}  ${line.trim()}`)
        })
    }
    expect(offenders, 'Use can() / grant.permissions instead of comparing role names (ADR-028 §2)').toEqual([])
  })
})
