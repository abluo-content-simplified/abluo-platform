#!/usr/bin/env node
// Abluo — migrate-pack-history.mjs   (Catalogue V2, C10-6 data step D3, contract C7 D3)
//
// Converts the installation's legacy `appliedPreset {id, version, appliedAt}` into a
// `cataloguePackHistory` entry `<id>@<version>` (legacyPresetRecord — the same
// function the R1 reader uses; tmz: bookshop@1 with added.settings =
// [publicSegment, defaultItemProfile]); in the same transaction module config
// setupCompletedAt = appliedAt, setupSource = 'pack' where unset (D-14).
// `appliedPreset` kept (inert). Marker catalogueMigrations.packHistory. Audit migration.pack_history.
//
// Dry run by default; --apply writes; production needs --approval <green staging report id>.
//   npx tsx scripts/catalogue/migrate-pack-history.mjs --help
import { runStepCli } from './lib/cli.ts'
import { packHistoryStep } from './lib/step-pack-history.ts'

await runStepCli(packHistoryStep, 'migrate-pack-history.mjs')
