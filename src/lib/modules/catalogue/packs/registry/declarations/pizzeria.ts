import type { PackDeclaration } from '../../types'
import { FOOD_PROFILE, FORMAT, L, LABEL, TAG, dineIn, hours, section, takeaway } from '../shared'

/** C7.10 Pizzeria — `pizzeria` v3. Delivery in the evening only (declinable in the preview, D-6). */
export const pizzeria: PackDeclaration = {
  id: 'pizzeria',
  version: 3,
  name: L('Pizzeria', 'Pizzeria', 'Pizzeria'),
  description: L(
    'Pizzas, starters, salads, desserts and drinks; dine-in, takeaway and evening delivery.',
    'Pizze, antipasti, insalate, dolci e bevande; al tavolo, da asporto e consegna la sera.',
    'Pizzen, Vorspeisen, Salate, Desserts und Getränke; vor Ort, zum Mitnehmen und Lieferung am Abend.',
  ),
  suggestedPublicName: L('Menu', 'Menu', 'Speisekarte'),
  suggestedSegment: 'menu',
  suggestedDefaultProfile: FOOD_PROFILE,
  channels: [
    dineIn(true),
    takeaway(true),
    {
      key: 'delivery',
      label: L('Delivery', 'Consegna a domicilio', 'Lieferung'),
      preselected: true,
      defaultAvailability: 'unavailable',
      defaultSchedule: [hours('evening', '18:00', '23:00')],
      defaultAvailabilityWithoutSchedule: 'available',
    },
  ],
  categories: [
    { key: 'pizza', label: L('Pizza', 'Pizza', 'Pizza'), parent: null, defaultOptionGroups: ['extra_toppings', 'remove_ingredients'] },
    { key: 'pizza_classiche', label: L('Classic', 'Classiche', 'Klassiker'), parent: 'pizza' },
    { key: 'pizza_bianche', label: L('White pizzas', 'Bianche', 'Weiße Pizzen'), parent: 'pizza' },
    { key: 'pizza_speciali', label: L('Specials', 'Speciali', 'Spezialitäten'), parent: 'pizza' },
    { key: 'calzoni', label: L('Calzoni', 'Calzoni', 'Calzoni'), parent: 'pizza' },
    { key: 'starters', label: LABEL.starters, parent: null },
    { key: 'fried_starters', label: L('Fried', 'Fritti', 'Frittiertes'), parent: 'starters' },
    { key: 'boards', label: L('Boards', 'Taglieri', 'Platten'), parent: 'starters' },
    { key: 'salads', label: LABEL.salads, parent: null },
    { key: 'desserts', label: LABEL.desserts, parent: null },
    { key: 'beverages', label: LABEL.beverages, parent: null },
    { key: 'soft_drinks', label: LABEL.softDrinks, parent: 'beverages' },
    { key: 'beer', label: LABEL.beer, parent: 'beverages' },
    { key: 'wine', label: LABEL.wine, parent: 'beverages' },
    // A suggestion only: the tenant's licence and local rules decide.
    { key: 'spirits', label: L('Spirits and digestifs', 'Distillati e digestivi', 'Spirituosen und Digestifs'), parent: 'beverages', channelRules: { delivery: { state: 'unavailable' } } },
  ],
  tags: [TAG.chefsChoice, TAG.new, TAG.seasonal, TAG.spicy, TAG.local],
  collections: [
    {
      key: 'menu',
      name: LABEL.menu,
      collectionType: 'menu',
      sections: [section('pizza', L('Pizza', 'Pizza', 'Pizza')), section('starters', LABEL.starters), section('salads', LABEL.salads), section('desserts', LABEL.desserts), section('beverages', LABEL.beverages)],
    },
  ],
  formatSuggestions: [FORMAT.glass25, FORMAT.bottle33, FORMAT.bottle75],
  optionGroups: [
    {
      key: 'extra_toppings',
      name: L('Extra toppings', 'Aggiunte', 'Extra-Beläge'),
      min: 0,
      max: 5,
      choices: [
        { key: 'buffalo_mozzarella', label: L('Buffalo mozzarella', 'Mozzarella di bufala', 'Büffelmozzarella'), priceDelta: 0, kind: 'add' },
        { key: 'ham', label: L('Cooked ham', 'Prosciutto cotto', 'Kochschinken'), priceDelta: 0, kind: 'add' },
        { key: 'mushrooms', label: L('Mushrooms', 'Funghi', 'Pilze'), priceDelta: 0, kind: 'add' },
        { key: 'olives', label: L('Olives', 'Olive', 'Oliven'), priceDelta: 0, kind: 'add' },
        { key: 'spicy_salami', label: L('Spicy salami', 'Salame piccante', 'Scharfe Salami'), priceDelta: 0, kind: 'add' },
      ],
    },
    {
      key: 'remove_ingredients',
      name: L('Remove ingredients', 'Senza', 'Ohne'),
      min: 0,
      max: null,
      choices: [
        { key: 'no_garlic', label: L('No garlic', 'Senza aglio', 'Ohne Knoblauch'), priceDelta: 0, kind: 'remove' },
        { key: 'no_onion', label: L('No onion', 'Senza cipolla', 'Ohne Zwiebeln'), priceDelta: 0, kind: 'remove' },
        { key: 'no_basil', label: L('No basil', 'Senza basilico', 'Ohne Basilikum'), priceDelta: 0, kind: 'remove' },
      ],
    },
  ],
  policySuggestions: [{ key: 'pizza_photo', requirement: 'photo', level: 'recommended', scope: { category: 'pizza' } }],
}
