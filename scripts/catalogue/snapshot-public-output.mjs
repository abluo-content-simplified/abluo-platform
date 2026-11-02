#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — snapshot-public-output.mjs   (C11.5 proof 2 `website-output.unchanged`) — READ-ONLY
//
// Takes a snapshot of what visitors and crawlers see on a live site — landing
// page / collection / item <title>, OG title + description, meta description,
// every JSON-LD block, and the full llms.txt and sitemap.xml — and compares two
// snapshots byte for byte. Take one BEFORE a data step and one AFTER; the diff
// must be empty (R-B consumers are not built, so D4 changes nothing public).
//
// USAGE
//   npx tsx scripts/catalogue/snapshot-public-output.mjs --site https://tmz.it \
//     --paths /llms.txt,/sitemap.xml,/en/books,/it/libri,/en/books/<an-item> --out backups/catalogue/public-before.json
//   npx tsx scripts/catalogue/snapshot-public-output.mjs --compare backups/catalogue/public-before.json backups/catalogue/public-after.json
//
// EXIT  0 written / equal · 1 differs · 2 could not run
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { compareSnapshots, snapshotOf } from './lib/public-output.ts'
import { die, parseArgs } from './lib/cli.ts'

const argv = process.argv.slice(2)
const args = parseArgs(argv)
const ci = argv.indexOf('--compare')
if (ci >= 0) {
  const [a, b] = [argv[ci + 1], argv[ci + 2]]
  if (!a || !b || !existsSync(a) || !existsSync(b)) die('--compare <before.json> <after.json>')
  const diffs = compareSnapshots(JSON.parse(readFileSync(a, 'utf8')).pages, JSON.parse(readFileSync(b, 'utf8')).pages)
  for (const d of diffs) console.log(`DIFF ${d.path} ${d.field}\n  before: ${JSON.stringify(d.before).slice(0, 300)}\n  after:  ${JSON.stringify(d.after).slice(0, 300)}`)
  console.log(diffs.length ? `${diffs.length} difference(s) — NOT unchanged` : 'byte-equal — website output unchanged')
  process.exit(diffs.length ? 1 : 0)
}
const site = args.get('--site')
const paths = (args.get('--paths') ?? '').split(',').map((p) => p.trim()).filter(Boolean)
const out = args.get('--out')
if (!site || !/^https:\/\//.test(site) || !paths.length || !out) die('--site https://… --paths /a,/b --out <file.json>   (or --compare a.json b.json)')
if (existsSync(out)) die(`refusing to overwrite ${out}`)
const pages = []
for (const p of paths) {
  const res = await fetch(new URL(p, site), { redirect: 'manual', headers: { 'User-Agent': 'abluo-catalogue-rollout-snapshot' } })
  pages.push(snapshotOf(p, res.status, res.headers.get('content-type') ?? '', await res.text()))
  console.log(`  ${res.status} ${p}`)
}
writeFileSync(out, JSON.stringify({ site, takenAt: new Date().toISOString(), pages }, null, 2) + '\n')
console.log(`snapshot written to ${out}`)
