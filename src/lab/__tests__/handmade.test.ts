/**
 * Guard: no NEW hand-made UI in dashboard code (see src/lab/handmade.ts).
 *
 *   npm run lab:baseline   — refresh the "still to do" list after cleaning a file
 *
 * The list may only shrink. Adding a hand-made button / field / switch / tab /
 * dialog / box / pill / loading block — in a new file or to a file already on
 * the list — fails here: use the shared component the message names, or, if
 * none fits, add one to src/components/app/ui with a Lab entry.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HANDMADE_RULES, scanHandmade, type HandmadeCounts, type HandmadeRule } from '../handmade'

const ROOT = process.cwd()
const BASELINE = path.join(ROOT, 'src/lab/handmade-baseline.json')
const current = scanHandmade(ROOT)

if (process.env.LAB_UPDATE_BASELINE === '1') {
  writeFileSync(BASELINE, JSON.stringify({ files: current }, null, 2) + '\n')
}

const baseline = (JSON.parse(readFileSync(BASELINE, 'utf8')) as { files: HandmadeCounts }).files

describe('no new hand-made UI in dashboard code', () => {
  it('nothing grew: every file is at or below its count on the still-to-do list', () => {
    const grew: string[] = []
    for (const [file, counts] of Object.entries(current)) {
      for (const [rule, n] of Object.entries(counts) as [HandmadeRule, number][]) {
        const allowed = baseline[file]?.[rule] ?? 0
        if (n > allowed) grew.push(`${file}: ${n - allowed} new hand-made ${rule} — use ${HANDMADE_RULES[rule].use}`)
      }
    }
    expect(grew).toEqual([])
  })

  it('the still-to-do list is current (run `npm run lab:baseline` after cleaning a file)', () => {
    const stale: string[] = []
    for (const [file, counts] of Object.entries(baseline)) {
      for (const [rule, n] of Object.entries(counts) as [HandmadeRule, number][]) {
        const now = current[file]?.[rule] ?? 0
        if (now < n) stale.push(`${file}: ${rule} ${n} → ${now}`)
      }
    }
    expect(stale).toEqual([])
  })
})
