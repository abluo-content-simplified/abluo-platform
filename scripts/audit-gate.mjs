#!/usr/bin/env node
// Security gate for production dependencies.
//
// Fails when `npm audit --omit=dev` reports a HIGH or CRITICAL advisory that is
// not on the accepted list in scripts/audit-allowlist.json. Accepted entries are
// advisories we know about, with a reason and the work that removes them.
// The list may only shrink: when an accepted advisory no longer appears, the
// gate says so, and the entry should be deleted.
//
// Run locally: node scripts/audit-gate.mjs
// Background: docs in the project, "Security and dependency status".

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const allowlist = JSON.parse(readFileSync(join(here, 'audit-allowlist.json'), 'utf8'))
const accepted = new Map(allowlist.accepted.map((a) => [a.id, a]))

let raw
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
} catch (err) {
  // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
  raw = err.stdout
}
if (!raw) {
  console.error('audit-gate: npm audit produced no output (registry unreachable?)')
  process.exit(2)
}
const report = JSON.parse(raw)
if (report.error) {
  console.error('audit-gate: npm audit failed:', report.error.summary ?? report.error)
  process.exit(2)
}

const BLOCKING = new Set(['high', 'critical'])
const found = new Map() // advisory id -> { pkg, severity, title, url }
for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue
    const id = via.url?.split('/').pop() ?? String(via.source)
    found.set(id, { pkg, severity: via.severity, title: via.title, url: via.url })
  }
}

const fresh = [...found].filter(([id]) => !accepted.has(id))
const gone = [...accepted.keys()].filter((id) => !found.has(id))
const m = report.metadata?.vulnerabilities ?? {}
console.log(`npm audit --omit=dev: ${m.critical ?? 0} critical, ${m.high ?? 0} high, ${m.moderate ?? 0} moderate, ${m.low ?? 0} low`)
console.log(`accepted high/critical advisories still present: ${found.size - fresh.length}`)

if (gone.length) {
  console.log('\nNo longer reported — delete these from scripts/audit-allowlist.json:')
  for (const id of gone) console.log(`  ${id} (${accepted.get(id).package})`)
}
if (fresh.length) {
  console.error('\nNEW high/critical advisories in production dependencies:')
  for (const [id, a] of fresh) console.error(`  [${a.severity}] ${a.pkg}: ${a.title}\n    ${a.url}`)
  console.error('\nFix them (npm update <pkg> within range first), or — only if they cannot be reached at runtime —')
  console.error('add them to scripts/audit-allowlist.json with a reason and the work that removes them.')
  process.exit(1)
}
console.log('\naudit-gate: OK')
