import type { PackDeclaration } from '../../types'
import { FOOD_PROFILE, FORMAT, L, LABEL, TAG, delivery, dineIn, section, takeaway } from '../shared'

/** C7.10 Wine bar — `wine-bar` v3. No schedules; wine stays available for takeaway (a bottle shop). */
export const wineBar: PackDeclaration = {
  id: 'wine-bar',
  version: 3,
  name: L('Wine bar', 'Enoteca', 'Weinbar'),
  description: L(
    'Wine by kind, small plates, boards, beer and spirits, non-alcoholic drinks; glasses and bottles as formats.',
    'Vini per tipologia, piccoli piatti, taglieri, birre e distillati, analcolici; calici e bottiglie come formati.',
    'Weine nach Art, kleine Gerichte, Platten, Bier und Spirituosen, Alkoholfreies; Gläser und Flaschen als Formate.',
  ),
  suggestedPublicName: L('Wine list', 'Carta dei vini', 'Weinkarte'),
  suggestedSegment: 'wine-list',
  suggestedDefaultProfile: FOOD_PROFILE,
  channels: [dineIn(true), { ...takeaway(false), label: L('Takeaway (bottle shop)', 'Da asporto (bottiglie)', 'Zum Mitnehmen (Flaschen)') }, delivery(false)],
  categories: [
    { key: 'wine', label: LABEL.wine, parent: null, channelRules: { takeaway: { state: 'available' } } },
    { key: 'wine_red', label: LABEL.red, parent: 'wine' },
    { key: 'wine_white', label: LABEL.white, parent: 'wine' },
    { key: 'wine_rose', label: LABEL.rose, parent: 'wine' },
    { key: 'wine_orange', label: L('Orange', 'Orange', 'Orange Wein'), parent: 'wine' },
    { key: 'wine_sparkling', label: LABEL.sparkling, parent: 'wine' },
    { key: 'wine_sweet', label: L('Sweet and fortified', 'Passiti e liquorosi', 'Süß- und Likörweine'), parent: 'wine' },
    { key: 'small_plates', label: L('Small plates', 'Piccoli piatti', 'Kleine Gerichte'), parent: null, channelRules: { takeaway: { state: 'unavailable' } } },
    { key: 'boards', label: L('Cheese and charcuterie', 'Taglieri', 'Käse und Wurst'), parent: null },
    { key: 'beer_spirits', label: L('Beer and spirits', 'Birre e distillati', 'Bier und Spirituosen'), parent: null },
    { key: 'non_alcoholic', label: L('Non-alcoholic', 'Analcolici', 'Alkoholfrei'), parent: null },
  ],
  tags: [TAG.natural, TAG.organic, TAG.local, TAG.staffPick, TAG.limited],
  collections: [
    {
      key: 'wine_list',
      name: LABEL.wineList,
      collectionType: 'list',
      sections: [
        section('wine_red', LABEL.red),
        section('wine_white', LABEL.white),
        section('wine_rose', LABEL.rose),
        section('wine_orange', L('Orange', 'Orange', 'Orange Wein')),
        section('wine_sparkling', LABEL.sparkling),
        section('wine_sweet', L('Sweet and fortified', 'Passiti e liquorosi', 'Süß- und Likörweine')),
      ],
    },
    { key: 'food_menu', name: L('Food', 'Cucina', 'Speisen'), collectionType: 'menu', sections: [section('small_plates', L('Small plates', 'Piccoli piatti', 'Kleine Gerichte')), section('boards', L('Cheese and charcuterie', 'Taglieri', 'Käse und Wurst'))] },
  ],
  formatSuggestions: [FORMAT.glass10, FORMAT.glass15, FORMAT.bottle75, FORMAT.halfBottle, FORMAT.magnum],
  optionGroups: [],
  policySuggestions: [],
}
