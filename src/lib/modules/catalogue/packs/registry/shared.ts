// ── Shared building blocks of the launch packs (C7.10) ───────────────────────
// Plain data reused by several declarations: the same stable key always carries
// the same labels, so two packs that both suggest `seasonal` or `glass_15` agree
// (equivalence is by key, C7.4). No currency, no money, no ids.

import { profilesWith, type ItemProfile } from '../../profiles'
import type { PackChannelSuggestion, PackFormatTemplate, PackLocalized, PackSection, PackTag, PackWeeklyOverride } from '../types'

export const L = (en: string, it: string, de: string): PackLocalized => ({ en, it, de })

/** The profile that carries food information (read from the profile registry, never spelled here — ADR-033 I-2.1). */
export const FOOD_PROFILE: ItemProfile = profilesWith('foodInformation')[0]

/** D-22 (C1.12.8) "Use for" lists the packs write on the roots, tags and option lists they create. */
export const FOOD: ItemProfile[] = [FOOD_PROFILE]
export const BOOK: ItemProfile[] = ['book']

// ── channels (keys as in the legacy `restaurant` preset, D-21) ───────────────
export const dineIn = (preselected: boolean): PackChannelSuggestion => ({ key: 'dine-in', label: L('Dine-in', 'Al tavolo', 'Vor Ort'), preselected, defaultAvailability: 'available' })
export const takeaway = (preselected: boolean): PackChannelSuggestion => ({ key: 'takeaway', label: L('Takeaway', 'Da asporto', 'Zum Mitnehmen'), preselected, defaultAvailability: 'available' })
export const delivery = (preselected: boolean): PackChannelSuggestion => ({ key: 'delivery', label: L('Delivery', 'Consegna a domicilio', 'Lieferung'), preselected, defaultAvailability: 'available' })
export const roomService = (preselected: boolean): PackChannelSuggestion => ({ key: 'room-service', label: L('Room service', 'Servizio in camera', 'Zimmerservice'), preselected, defaultAvailability: 'available' })

export const EVERY_DAY: PackWeeklyOverride['days'] = []
export const hours = (key: string, from: string, to: string, days: PackWeeklyOverride['days'] = EVERY_DAY): PackWeeklyOverride => ({ key, days, from, to, state: 'available' })

// ── tags ──────────────────────────────────────────────────────────────────────
// D-22: food- or book-specific tags carry "Use for"; generic ones (New, Seasonal, Local, Organic, Staff pick, Limited) stay for every item type.
export const TAG = {
  chefsChoice: { key: 'chefs_choice', label: L("Chef's choice", 'Scelta dello chef', 'Empfehlung des Küchenchefs'), useFor: FOOD },
  new: { key: 'new', label: L('New', 'Novità', 'Neu') },
  seasonal: { key: 'seasonal', label: L('Seasonal', 'Di stagione', 'Saisonal') },
  spicy: { key: 'spicy', label: L('Spicy', 'Piccante', 'Scharf'), useFor: FOOD },
  local: { key: 'local', label: L('Local', 'Locale', 'Regional') },
  houseSpeciality: { key: 'house_speciality', label: L('House speciality', 'Specialità della casa', 'Spezialität des Hauses'), useFor: FOOD },
  signature: { key: 'signature', label: L('Signature dish', 'Piatto firma', 'Signature-Gericht'), useFor: FOOD },
  baristasChoice: { key: 'baristas_choice', label: L("Barista's choice", 'Scelta del barista', 'Empfehlung des Baristas'), useFor: FOOD },
  natural: { key: 'natural', label: L('Natural', 'Naturale', 'Naturwein'), useFor: FOOD },
  organic: { key: 'organic', label: L('Organic', 'Biologico', 'Bio') },
  staffPick: { key: 'staff_pick', label: L('Staff pick', 'Consigliato da noi', 'Unsere Empfehlung') },
  limited: { key: 'limited', label: L('Limited', 'Edizione limitata', 'Limitiert') },
  signedCopy: { key: 'signed_copy', label: L('Signed copy', 'Copia autografata', 'Signiertes Exemplar'), useFor: BOOK },
  illustrated: { key: 'illustrated', label: L('Illustrated', 'Illustrato', 'Illustriert'), useFor: BOOK },
  localAuthor: { key: 'local_author', label: L('Local author', 'Autore locale', 'Regionaler Autor'), useFor: BOOK },
} satisfies Record<string, PackTag>

// ── format templates (C3: glass vs bottle is a format, never a category) ─────
export const FORMAT = {
  glass10: { key: 'glass_10', label: L('Glass 10 cl', 'Calice 10 cl', 'Glas 10 cl'), quantity: { value: 10, unit: 'cl' } },
  glass15: { key: 'glass_15', label: L('Glass 15 cl', 'Calice 15 cl', 'Glas 15 cl'), quantity: { value: 15, unit: 'cl' } },
  glass25: { key: 'glass_25', label: L('Glass 25 cl', 'Bicchiere 25 cl', 'Glas 25 cl'), quantity: { value: 25, unit: 'cl' } },
  glass40: { key: 'glass_40', label: L('Glass 40 cl', 'Bicchiere 40 cl', 'Glas 40 cl'), quantity: { value: 40, unit: 'cl' } },
  bottle33: { key: 'bottle_33', label: L('Bottle 33 cl', 'Bottiglia 33 cl', 'Flasche 33 cl'), quantity: { value: 33, unit: 'cl' } },
  bottle75: { key: 'bottle_75', label: L('Bottle 75 cl', 'Bottiglia 75 cl', 'Flasche 75 cl'), quantity: { value: 75, unit: 'cl' } },
  halfBottle: { key: 'half_bottle_37_5', label: L('Half bottle 37.5 cl', 'Mezza bottiglia 37,5 cl', 'Halbe Flasche 37,5 cl'), quantity: { value: 37.5, unit: 'cl' } },
  magnum: { key: 'magnum_150', label: L('Magnum 150 cl', 'Magnum 150 cl', 'Magnum 150 cl'), quantity: { value: 150, unit: 'cl' } },
  sizeS: { key: 'size_s', label: L('Small', 'Piccolo', 'Klein') },
  sizeM: { key: 'size_m', label: L('Medium', 'Medio', 'Mittel') },
  sizeL: { key: 'size_l', label: L('Large', 'Grande', 'Groß') },
  paperback: { key: 'paperback', label: L('Paperback', 'Brossura', 'Taschenbuch') },
  hardcover: { key: 'hardcover', label: L('Hardcover', 'Copertina rigida', 'Gebundene Ausgabe') },
  ebook: { key: 'ebook', label: L('E-book', 'E-book', 'E-Book') },
} satisfies Record<string, PackFormatTemplate>

// ── recurring labels ─────────────────────────────────────────────────────────
export const LABEL = {
  starters: L('Starters', 'Antipasti', 'Vorspeisen'),
  salads: L('Salads', 'Insalate', 'Salate'),
  desserts: L('Desserts', 'Dolci', 'Desserts'),
  beverages: L('Beverages', 'Bevande', 'Getränke'),
  softDrinks: L('Soft drinks', 'Bibite', 'Softdrinks'),
  beer: L('Beer', 'Birre', 'Bier'),
  wine: L('Wine', 'Vini', 'Weine'),
  coffee: L('Coffee', 'Caffè', 'Kaffee'),
  red: L('Red', 'Rossi', 'Rotweine'),
  white: L('White', 'Bianchi', 'Weißweine'),
  rose: L('Rosé', 'Rosati', 'Roséweine'),
  sparkling: L('Sparkling', 'Bollicine', 'Schaumweine'),
  sweet: L('Sweet', 'Dolci e passiti', 'Süßweine'),
  fish: L('Fish', 'Pesce', 'Fisch'),
  meat: L('Meat', 'Carne', 'Fleisch'),
  menu: L('Menu', 'Menu', 'Speisekarte'),
  wineList: L('Wine list', 'Carta dei vini', 'Weinkarte'),
}

export const section = (key: string, name: PackLocalized, children?: PackSection[]): PackSection => ({ key, name, ...(children && { children }) })
