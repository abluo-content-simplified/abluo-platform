import type { PackDeclaration } from '../../types'
import { FOOD, FOOD_PROFILE, FORMAT, L, LABEL, TAG, delivery, hours, section, takeaway, dineIn, roomService } from '../shared'

const LUNCH_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const lunch = { state: 'unavailable' as const, overrides: [hours('lunch', '12:00', '15:00', [...LUNCH_DAYS])] }

/** C7.10 Traditional restaurant — `traditional-restaurant` v3. A lunch menu is a category rule (D-6.2). */
export const traditionalRestaurant: PackDeclaration = {
  id: 'traditional-restaurant',
  version: 3,
  name: L('Traditional restaurant', 'Ristorante tradizionale', 'Traditionelles Restaurant'),
  description: L(
    'Starters, first and main courses, sides, desserts, drinks and a wine list; lunch specials at lunchtime.',
    'Antipasti, primi e secondi, contorni, dolci, bevande e carta dei vini; piatti del giorno a pranzo.',
    'Vorspeisen, erste Gänge und Hauptgerichte, Beilagen, Desserts, Getränke und Weinkarte; Mittagsgerichte zur Mittagszeit.',
  ),
  suggestedPublicName: L('Menu', 'Menu', 'Speisekarte'),
  suggestedSegment: 'menu',
  suggestedDefaultProfile: FOOD_PROFILE,
  channels: [dineIn(true), takeaway(true), delivery(false), roomService(false)],
  categories: [
    { key: 'lunch_specials', label: L('Lunch specials', 'Piatti del giorno', 'Mittagsgerichte'), parent: null, useFor: FOOD, channelRules: { 'dine-in': lunch, takeaway: lunch } },
    { key: 'starters', label: LABEL.starters, parent: null, useFor: FOOD },
    { key: 'first_courses', label: L('First courses', 'Primi piatti', 'Erste Gänge'), parent: null, useFor: FOOD },
    { key: 'pasta', label: L('Pasta', 'Pasta', 'Pasta'), parent: 'first_courses' },
    { key: 'soups_risotto', label: L('Soups and risotto', 'Zuppe e risotti', 'Suppen und Risotto'), parent: 'first_courses' },
    { key: 'main_courses', label: L('Main courses', 'Secondi piatti', 'Hauptgerichte'), parent: null, useFor: FOOD, defaultOptionGroups: ['side_choice'] },
    { key: 'meat', label: LABEL.meat, parent: 'main_courses', defaultOptionGroups: ['cooking_point'] },
    { key: 'fish', label: LABEL.fish, parent: 'main_courses' },
    { key: 'vegetarian_mains', label: L('Vegetarian', 'Vegetariani', 'Vegetarisch'), parent: 'main_courses' },
    { key: 'sides', label: L('Side dishes', 'Contorni', 'Beilagen'), parent: null, useFor: FOOD },
    { key: 'desserts', label: LABEL.desserts, parent: null, useFor: FOOD },
    { key: 'beverages', label: LABEL.beverages, parent: null, useFor: FOOD },
    { key: 'soft_drinks', label: LABEL.softDrinks, parent: 'beverages' },
    { key: 'beer', label: LABEL.beer, parent: 'beverages' },
    { key: 'coffee', label: LABEL.coffee, parent: 'beverages' },
    { key: 'digestifs', label: L('Digestifs', 'Digestivi', 'Digestifs'), parent: 'beverages' },
    { key: 'wine', label: LABEL.wine, parent: null, useFor: FOOD, channelRules: { takeaway: { state: 'unavailable' } } },
    { key: 'wine_red', label: LABEL.red, parent: 'wine' },
    { key: 'wine_white', label: LABEL.white, parent: 'wine' },
    { key: 'wine_rose', label: LABEL.rose, parent: 'wine' },
    { key: 'wine_sparkling', label: LABEL.sparkling, parent: 'wine' },
    { key: 'wine_sweet', label: LABEL.sweet, parent: 'wine' },
  ],
  tags: [TAG.chefsChoice, TAG.seasonal, TAG.local, TAG.houseSpeciality],
  collections: [
    {
      key: 'menu',
      name: LABEL.menu,
      collectionType: 'menu',
      sections: [
        section('starters', LABEL.starters),
        section('first_courses', L('First courses', 'Primi piatti', 'Erste Gänge')),
        section('main_courses', L('Main courses', 'Secondi piatti', 'Hauptgerichte')),
        section('sides', L('Side dishes', 'Contorni', 'Beilagen')),
        section('desserts', LABEL.desserts),
        section('beverages', LABEL.beverages),
      ],
    },
    {
      key: 'wine_list',
      name: LABEL.wineList,
      collectionType: 'list',
      sections: [section('wine_red', LABEL.red), section('wine_white', LABEL.white), section('wine_rose', LABEL.rose), section('wine_sparkling', LABEL.sparkling), section('wine_sweet', LABEL.sweet)],
    },
  ],
  formatSuggestions: [FORMAT.glass15, FORMAT.bottle75, FORMAT.halfBottle],
  optionGroups: [
    {
      key: 'side_choice',
      name: L('Side choice', 'Scelta del contorno', 'Beilage nach Wahl'),
      useFor: FOOD,
      min: 1,
      max: 1,
      choices: [
        { key: 'roast_potatoes', label: L('Roast potatoes', 'Patate al forno', 'Ofenkartoffeln'), priceDelta: 0, kind: 'add' },
        { key: 'mixed_salad', label: L('Mixed salad', 'Insalata mista', 'Gemischter Salat'), priceDelta: 0, kind: 'add' },
        { key: 'grilled_vegetables', label: L('Grilled vegetables', 'Verdure grigliate', 'Gegrilltes Gemüse'), priceDelta: 0, kind: 'add' },
      ],
    },
    {
      key: 'cooking_point',
      name: L('Cooking point', 'Cottura', 'Garstufe'),
      useFor: FOOD,
      min: 1,
      max: 1,
      choices: [
        { key: 'rare', label: L('Rare', 'Al sangue', 'Blutig'), priceDelta: 0, kind: 'add' },
        { key: 'medium', label: L('Medium', 'Media', 'Medium'), priceDelta: 0, kind: 'add' },
        { key: 'well_done', label: L('Well done', 'Ben cotta', 'Durchgebraten'), priceDelta: 0, kind: 'add' },
      ],
    },
  ],
  policySuggestions: [],
}
