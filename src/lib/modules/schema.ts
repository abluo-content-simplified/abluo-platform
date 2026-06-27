import type { SchemaTypeDefinition } from 'sanity'
import { MODULE_REGISTRY } from './registry'

// ── Module schema derivation ──────────────────────────────────────────────────
//
// Derives the full set of module-owned Sanity schema types from MODULE_REGISTRY.
// Called by src/lib/sanity/schema.ts to compose the platform schema.
//
// Each module's platformContract.schemaDefinitions() returns the actual type
// definition objects owned by that module. This function collects them all in
// MODULE_REGISTRY order (Blog → Events → Live) — deterministic, no sorting.
//
// The schemaTypes string array in each manifest is the companion declaration:
// it names the same types for validation and tooling. Both must stay in sync.
// They are not automatically cross-validated — that is a future Rule 10.
//
// ADR-011 Phase D1.

export function buildSchema(): SchemaTypeDefinition[] {
  return MODULE_REGISTRY.flatMap((mod) => mod.platformContract.schemaDefinitions())
}
