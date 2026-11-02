#!/usr/bin/env node
// Abluo — migrate-public-name.mjs   (Catalogue V2, C10-6 data step D4, contract C11.5 R-A2)
//
// planPublicNameMigration per project document (published and draft): copy navLabel
// → publicName (every non-empty locale, trimmed) when no publicName exists, else
// drop; unset navLabel (the only non-additive step — R1 removed every reader).
// Requires the taxonomy, commerce and packHistory markers. Runs LAST.
// Marker catalogueMigrations.publicName. Audit public_name.migrated {action, old, new, discarded}.
// Revert: --revert --rollback <P′ export> restores navLabel and unsets the copied publicName.
//
// Dry run by default; --apply writes; production needs --approval <green staging report id>.
//   npx tsx scripts/catalogue/migrate-public-name.mjs --help
import { runStepCli } from './lib/cli.ts'
import { publicNameStep } from './lib/step-public-name.ts'

await runStepCli(publicNameStep, 'migrate-public-name.mjs')
