/**
 * Nav-label completeness guard (ADR-017 Phase 2 / task #81).
 *
 * Client-dashboard nav labels come from next-intl keys
 * `clientDashboard.nav.<moduleId>` (Tom's locked decision #2), NOT from the
 * Studio-English manifest `label`. This test fails if ANY module in
 * MODULE_REGISTRY is missing its `clientDashboard.nav.<id>` label in ANY
 * supported interface locale — so a module can never ship without client-facing
 * labels in every language.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { MODULE_REGISTRY } from '../registry'

// Interface locales that must carry a full label set. Mirrors messages/*.json.
const LOCALES = ['en', 'it', 'de'] as const

function loadNavLabels(locale: string): Record<string, unknown> {
  const path = resolve(__dirname, '../../../../messages', `${locale}.json`)
  const json = JSON.parse(readFileSync(path, 'utf8'))
  return json?.clientDashboard?.nav ?? {}
}

describe('clientDashboard.nav label completeness', () => {
  for (const locale of LOCALES) {
    const nav = loadNavLabels(locale)
    for (const manifest of MODULE_REGISTRY) {
      it(`${locale}: has a non-empty clientDashboard.nav.${manifest.id}`, () => {
        const label = nav[manifest.id]
        expect(typeof label, `missing clientDashboard.nav.${manifest.id} in ${locale}.json`).toBe(
          'string'
        )
        expect((label as string).trim().length).toBeGreaterThan(0)
      })
    }
  }
})
