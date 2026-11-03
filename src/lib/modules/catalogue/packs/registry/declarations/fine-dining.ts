import type { PackDeclaration } from '../../types'
import { FOOD_PROFILE, FORMAT, L, LABEL, TAG, delivery, dineIn, hours, section, takeaway } from '../shared'

/** C7.10 Fine dining — `fine-dining` v3. Tasting menus at dinner only: baseline unavailable + 19:00–23:00 Tue–Sun (D-6). */
export const fineDining: PackDeclaration = {
  id: 'fine-dining',
  version: 3,
  name: L('Fine dining', 'Alta cucina', 'Gehobene Küche'),
  description: L(
    'Amuse-bouche, tasting menus at dinner, à la carte, cheese, desserts, wine and pairings.',
    'Amuse-bouche, menu degustazione a cena, alla carta, formaggi, dolci, vini e abbinamenti.',
    'Amuse-Bouche, Degustationsmenüs am Abend, À la carte, Käse, Desserts, Weine und Weinbegleitung.',
  ),
  suggestedPublicName: L('Menu', 'Menu', 'Menü'),
  suggestedSegment: 'menu',
  suggestedDefaultProfile: FOOD_PROFILE,
  channels: [dineIn(true), takeaway(false), delivery(false)],
  categories: [
    { key: 'amuse', label: L('Amuse-bouche', 'Amuse-bouche', 'Amuse-Bouche'), parent: null },
    {
      key: 'tasting_menus',
      label: L('Tasting menus', 'Menu degustazione', 'Degustationsmenüs'),
      parent: null,
      channelRules: { 'dine-in': { state: 'unavailable', overrides: [hours('dinner', '19:00', '23:00', ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'])] } },
    },
    { key: 'a_la_carte', label: L('À la carte', 'Alla carta', 'À la carte'), parent: null },
    { key: 'starters', label: LABEL.starters, parent: 'a_la_carte' },
    { key: 'fish', label: LABEL.fish, parent: 'a_la_carte' },
    { key: 'meat', label: LABEL.meat, parent: 'a_la_carte' },
    { key: 'vegetarian', label: L('Vegetarian', 'Vegetariani', 'Vegetarisch'), parent: 'a_la_carte' },
    { key: 'cheese', label: L('Cheese', 'Formaggi', 'Käse'), parent: null },
    { key: 'desserts', label: L('Desserts and petits fours', 'Dolci e piccola pasticceria', 'Desserts und Petits Fours'), parent: null },
    { key: 'wine', label: LABEL.wine, parent: null },
    { key: 'wine_red', label: LABEL.red, parent: 'wine' },
    { key: 'wine_white', label: LABEL.white, parent: 'wine' },
    { key: 'wine_sparkling', label: L('Sparkling and Champagne', 'Bollicine e Champagne', 'Schaumweine und Champagner'), parent: 'wine' },
    { key: 'wine_sweet', label: LABEL.sweet, parent: 'wine' },
    { key: 'pairings', label: L('Pairings', 'Abbinamenti', 'Weinbegleitung'), parent: null },
    { key: 'beverages', label: LABEL.beverages, parent: null },
  ],
  tags: [TAG.signature, TAG.seasonal],
  collections: [
    {
      key: 'menu',
      name: LABEL.menu,
      collectionType: 'menu',
      sections: [section('amuse', L('Amuse-bouche', 'Amuse-bouche', 'Amuse-Bouche')), section('a_la_carte', L('À la carte', 'Alla carta', 'À la carte')), section('cheese', L('Cheese', 'Formaggi', 'Käse')), section('desserts', LABEL.desserts)],
    },
    { key: 'tasting', name: L('Tasting menu', 'Menu degustazione', 'Degustationsmenü'), collectionType: 'menu', sections: [section('courses', L('Courses', 'Portate', 'Gänge')), section('pairings', L('Pairings', 'Abbinamenti', 'Weinbegleitung'))] },
    {
      key: 'wine_list',
      name: LABEL.wineList,
      collectionType: 'list',
      sections: [section('wine_red', LABEL.red), section('wine_white', LABEL.white), section('wine_sparkling', L('Sparkling and Champagne', 'Bollicine e Champagne', 'Schaumweine und Champagner')), section('wine_sweet', LABEL.sweet)],
    },
  ],
  formatSuggestions: [FORMAT.glass10, FORMAT.glass15, FORMAT.bottle75, FORMAT.magnum],
  // Set menus carry their own structure.
  optionGroups: [],
  policySuggestions: [{ key: 'item_description', requirement: 'description', level: 'recommended', scope: {} }],
}
