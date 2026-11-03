// ── The typed pack registry (contract C7.1, C7.10) ───────────────────────────
// Seven packs at launch: the six restaurant starters (Pizzeria, Traditional
// restaurant, Fine dining, Café and bar, Wine bar, Empty) and Bookshop.
// Consumers outside `packs/` use only `listPacks()` and `getPack(id)` for Setup
// (C7.9) — never PACK_REGISTRY by pack id. Runtime code never learns which pack
// was applied.

import { can } from '../../profiles'
import type { PackDeclaration, PackId } from '../types'
import { bookshop } from './declarations/bookshop'
import { cafeAndBar } from './declarations/cafe-and-bar'
import { empty } from './declarations/empty'
import { fineDining } from './declarations/fine-dining'
import { pizzeria } from './declarations/pizzeria'
import { traditionalRestaurant } from './declarations/traditional-restaurant'
import { wineBar } from './declarations/wine-bar'

/** Display order in Setup: the restaurant starters, Empty, then Bookshop. */
export const PACK_REGISTRY: readonly PackDeclaration[] = Object.freeze([pizzeria, traditionalRestaurant, fineDining, cafeAndBar, wineBar, empty, bookshop])

/**
 * Released versions per pack id (C7.3 `pack_version_invalid`: a newer declaration must be strictly
 * greater than every released one). v1/v2 were the D-1 starter presets (bookshop v1 on tmz).
 */
export const RELEASED_PACK_VERSIONS: Readonly<Record<PackId, readonly number[]>> = Object.freeze({
  pizzeria: [3],
  'traditional-restaurant': [3],
  'fine-dining': [3],
  'cafe-and-bar': [3],
  'wine-bar': [3],
  empty: [3],
  bookshop: [1, 3],
})

/** Every pack, in Setup's order. */
export const listPacks = (): readonly PackDeclaration[] => PACK_REGISTRY

/** One pack by id, or null. */
export const getPack = (id: unknown): PackDeclaration | null => PACK_REGISTRY.find((p) => p.id === id) ?? null

/** The restaurant starters offered by the food-and-drink setup (brief §6): every food pack plus Empty. */
export const foodStarterPacks = (): readonly PackDeclaration[] => PACK_REGISTRY.filter((p) => p.empty || (!!p.suggestedDefaultProfile && can(p.suggestedDefaultProfile, 'foodInformation')))
