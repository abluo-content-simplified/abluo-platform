import type { PackDeclaration } from '../../types'
import { FOOD, FOOD_PROFILE, FORMAT, L, TAG, delivery, hours, section, takeaway, dineIn } from '../shared'

const breakfast = { state: 'unavailable' as const, overrides: [hours('breakfast', '07:00', '11:00')] }

/** C7.10 Café and bar — `cafe-and-bar` v3. Breakfast 07:00–11:00; cocktails 17:00–01:00 (overnight, days name the start day). */
export const cafeAndBar: PackDeclaration = {
  id: 'cafe-and-bar',
  version: 3,
  name: L('Café and bar', 'Caffè e bar', 'Café und Bar'),
  description: L(
    'Coffee and tea, breakfast in the morning, pastries, snacks, cocktails in the evening, beer, wine and soft drinks.',
    'Caffè e tè, colazione al mattino, pasticceria, snack, cocktail la sera, birre, vini e bibite.',
    'Kaffee und Tee, Frühstück am Morgen, Gebäck, Snacks, Cocktails am Abend, Bier, Wein und Softdrinks.',
  ),
  suggestedPublicName: L('Menu', 'Menu', 'Karte'),
  suggestedSegment: 'menu',
  suggestedDefaultProfile: FOOD_PROFILE,
  channels: [dineIn(true), takeaway(true), delivery(false)],
  categories: [
    { key: 'coffee_tea', label: L('Coffee and tea', 'Caffè e tè', 'Kaffee und Tee'), parent: null, useFor: FOOD },
    { key: 'coffee', label: L('Coffee', 'Caffè', 'Kaffee'), parent: 'coffee_tea', defaultOptionGroups: ['milk_choice', 'extras'] },
    { key: 'tea', label: L('Tea and infusions', 'Tè e tisane', 'Tee und Kräutertee'), parent: 'coffee_tea' },
    { key: 'breakfast', label: L('Breakfast', 'Colazione', 'Frühstück'), parent: null, useFor: FOOD, channelRules: { 'dine-in': breakfast, takeaway: breakfast } },
    { key: 'pastries', label: L('Pastries', 'Pasticceria', 'Gebäck'), parent: null, useFor: FOOD },
    { key: 'sandwiches_snacks', label: L('Sandwiches and snacks', 'Panini e snack', 'Sandwiches und Snacks'), parent: null, useFor: FOOD },
    {
      key: 'cocktails',
      label: L('Cocktails', 'Cocktail', 'Cocktails'),
      parent: null, useFor: FOOD,
      channelRules: { 'dine-in': { state: 'unavailable', overrides: [hours('evening', '17:00', '01:00')] }, takeaway: { state: 'unavailable' } },
    },
    { key: 'beer_wine', label: L('Beer and wine', 'Birre e vini', 'Bier und Wein'), parent: null, useFor: FOOD, channelRules: { takeaway: { state: 'unavailable' } } },
    { key: 'soft_drinks_juices', label: L('Soft drinks and juices', 'Bibite e succhi', 'Softdrinks und Säfte'), parent: null, useFor: FOOD },
  ],
  tags: [TAG.new, TAG.seasonal, TAG.local, TAG.baristasChoice],
  collections: [
    {
      key: 'menu',
      name: L('Menu', 'Menu', 'Karte'),
      collectionType: 'menu',
      sections: [
        section('coffee_tea', L('Coffee and tea', 'Caffè e tè', 'Kaffee und Tee')),
        section('pastries', L('Pastries', 'Pasticceria', 'Gebäck')),
        section('sandwiches_snacks', L('Sandwiches and snacks', 'Panini e snack', 'Sandwiches und Snacks')),
        section('cocktails', L('Cocktails', 'Cocktail', 'Cocktails')),
        section('beer_wine', L('Beer and wine', 'Birre e vini', 'Bier und Wein')),
        section('soft_drinks_juices', L('Soft drinks and juices', 'Bibite e succhi', 'Softdrinks und Säfte')),
      ],
    },
    { key: 'breakfast_menu', name: L('Breakfast', 'Colazione', 'Frühstück'), collectionType: 'menu', sections: [section('breakfast', L('Breakfast', 'Colazione', 'Frühstück'))] },
  ],
  formatSuggestions: [FORMAT.sizeS, FORMAT.sizeM, FORMAT.sizeL, FORMAT.glass25, FORMAT.glass40],
  optionGroups: [
    {
      key: 'milk_choice',
      name: L('Milk choice', 'Scelta del latte', 'Milch nach Wahl'),
      useFor: FOOD,
      min: 0,
      max: 1,
      choices: [
        { key: 'whole_milk', label: L('Whole milk', 'Latte intero', 'Vollmilch'), priceDelta: 0, kind: 'add' },
        { key: 'skimmed_milk', label: L('Skimmed milk', 'Latte scremato', 'Magermilch'), priceDelta: 0, kind: 'add' },
        { key: 'oat_drink', label: L('Oat drink', 'Bevanda all’avena', 'Haferdrink'), priceDelta: 0, kind: 'add' },
        { key: 'soy_drink', label: L('Soy drink', 'Bevanda alla soia', 'Sojadrink'), priceDelta: 0, kind: 'add' },
      ],
    },
    {
      key: 'extras',
      name: L('Extras', 'Extra', 'Extras'),
      useFor: FOOD,
      min: 0,
      max: null,
      choices: [
        { key: 'extra_shot', label: L('Extra shot', 'Shot in più', 'Extra Shot'), priceDelta: 0, kind: 'add' },
        { key: 'syrup', label: L('Syrup', 'Sciroppo', 'Sirup'), priceDelta: 0, kind: 'add' },
      ],
    },
  ],
  policySuggestions: [],
}
