import type { PackDeclaration } from '../../types'
import { L } from '../shared'

/** C7.7 Empty — `empty` v3 (all launch packs share one version). No content: one history entry + the setup marker. */
export const empty: PackDeclaration = {
  id: 'empty',
  version: 3,
  empty: true,
  name: L('Start empty', 'Inizia da zero', 'Leer beginnen'),
  description: L(
    'Nothing is added. You create your own categories, channels and collections.',
    'Non viene aggiunto nulla. Crei tu categorie, canali e raccolte.',
    'Es wird nichts hinzugefügt. Sie legen Kategorien, Kanäle und Sammlungen selbst an.',
  ),
  channels: [],
  categories: [],
  tags: [],
  collections: [],
  formatSuggestions: [],
  optionGroups: [],
  policySuggestions: [],
}
