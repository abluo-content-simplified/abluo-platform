import type { PackDeclaration } from '../../types'
import { BOOK, FORMAT, L, TAG, section } from '../shared'

/**
 * C7.10 Bookshop — `bookshop` v3. Default profile Book (D-13 part 3: fill-if-empty, so tmz keeps
 * `product`). No channel is suggested, so nothing is gated: the website shows every published item
 * with its standard price (K-3.7). tmz's own keys (technology, design, literature) are not pack keys.
 */
export const bookshop: PackDeclaration = {
  id: 'bookshop',
  version: 3,
  name: L('Bookshop', 'Libreria', 'Buchhandlung'),
  description: L(
    'Fiction, non-fiction, children and young adults, travel and cookery; paperback, hardcover and e-book formats.',
    'Narrativa, saggistica, ragazzi, viaggi e cucina; formati brossura, copertina rigida ed e-book.',
    'Belletristik, Sachbuch, Kinder und Jugend, Reise und Küche; Formate Taschenbuch, gebundene Ausgabe und E-Book.',
  ),
  suggestedPublicName: L('Books', 'Libri', 'Bücher'),
  suggestedSegment: 'books',
  suggestedDefaultProfile: 'book',
  channels: [],
  categories: [
    { key: 'fiction', label: L('Fiction', 'Narrativa', 'Belletristik'), parent: null, useFor: BOOK },
    { key: 'literary_fiction', label: L('Literary fiction', 'Narrativa letteraria', 'Literarische Belletristik'), parent: 'fiction' },
    { key: 'crime_thriller', label: L('Crime and thriller', 'Gialli e thriller', 'Krimis und Thriller'), parent: 'fiction' },
    { key: 'sff', label: L('Science fiction and fantasy', 'Fantascienza e fantasy', 'Science-Fiction und Fantasy'), parent: 'fiction' },
    { key: 'non_fiction', label: L('Non-fiction', 'Saggistica', 'Sachbuch'), parent: null, useFor: BOOK },
    { key: 'biography_memoir', label: L('Biography and memoir', 'Biografie e memorie', 'Biografien und Memoiren'), parent: 'non_fiction' },
    { key: 'history', label: L('History', 'Storia', 'Geschichte'), parent: 'non_fiction' },
    { key: 'science_tech', label: L('Science and technology', 'Scienza e tecnologia', 'Wissenschaft und Technik'), parent: 'non_fiction' },
    { key: 'art_design', label: L('Art and design', 'Arte e design', 'Kunst und Design'), parent: 'non_fiction' },
    { key: 'children_ya', label: L('Children and young adults', 'Ragazzi', 'Kinder und Jugend'), parent: null, useFor: BOOK },
    { key: 'travel_cookery', label: L('Travel and cookery', 'Viaggi e cucina', 'Reise und Küche'), parent: null, useFor: BOOK },
  ],
  tags: [TAG.new, TAG.staffPick, TAG.signedCopy, TAG.illustrated, TAG.localAuthor],
  // "One unnamed section": a section name is required, so it carries the list's own name.
  collections: [{ key: 'all_books', name: L('All books', 'Tutti i libri', 'Alle Bücher'), collectionType: 'list', sections: [section('books', L('Books', 'Libri', 'Bücher'))] }],
  formatSuggestions: [FORMAT.paperback, FORMAT.hardcover, FORMAT.ebook],
  optionGroups: [],
  policySuggestions: [],
}
