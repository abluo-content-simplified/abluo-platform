#!/usr/bin/env node
/**
 * Component Lab usage scan → src/lab/usage.generated.json
 *
 *   npm run lab:usage
 *
 * For every registry entry, lists the files that import one of its exports
 * from its source module (alias `@/…` or a relative path). Read by the Lab's
 * "Used in" list. Not a gate: a stale file only shows stale usage, so nothing
 * fails when someone forgets to re-run it.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')
const registry = readFileSync(path.join(SRC, 'lab/registry.ts'), 'utf8')

const entries = [...registry.matchAll(/id: '([^']+)',[\s\S]*?exports: \[([^\]]*)\],\s*source: '([^']+)'/g)].map((m) => ({
  id: m[1],
  exports: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]),
  source: m[3],
}))

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : files(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const all = files(SRC).filter((f) => !f.startsWith(path.join(SRC, 'lab') + path.sep))
const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g

function resolves(spec, fromFile, target) {
  const noExt = target.replace(/\.(tsx?|ts)$/, '')
  if (spec.startsWith('@/')) return path.join(SRC, spec.slice(2)) === path.join(ROOT, noExt)
  if (spec.startsWith('.')) return path.resolve(path.dirname(fromFile), spec) === path.join(ROOT, noExt)
  return false
}

const usage = {}
for (const e of entries) {
  const users = new Set()
  for (const f of all) {
    if (path.join(ROOT, e.source) === f) continue
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(IMPORT)) {
      const names = m[1].split(',').map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      if (resolves(m[2], f, e.source) && names.some((n) => e.exports.includes(n))) users.add(path.relative(ROOT, f))
    }
  }
  usage[e.id] = [...users].sort()
}

const out = { generatedAt: new Date().toISOString(), usage }
writeFileSync(path.join(SRC, 'lab/usage.generated.json'), JSON.stringify(out, null, 2) + '\n')
console.log(Object.entries(usage).map(([id, u]) => `${id}: ${u.length}`).join('\n'))
