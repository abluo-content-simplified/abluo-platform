// Frozen shapes of the real tmz production Catalogue data (2026-11-02), as the
// contracts describe them (C1.9, C7 D3, C10-5, C11.5): 16 catalogueItem
// documents (10 published, 6 drafts), 4 of them with one unscoped window-less
// offer, no channels; Catalogue terms — categories design, literature,
// technology and 7 tags (incl. the misspelt key `illustrated_boos`, copied
// verbatim); one draft with categories ["technology","literature"]; one food
// draft with no categories; a stale config.categories [design, technology];
// navLabel {en: Books, it: Libri, de: Bücher}; appliedPreset bookshop v1;
// cataloguePage tmz-catalogue-page with heroTitle "Between the Lines".
// Ids and texts are representative; the SHAPES are the production ones.

import type { Doc } from '../../lib/docs'

const label = (en: string, it: string, de: string) => ({ _type: 'localizedString', en, it, de })

const term = (kind: 'category' | 'tag', key: string, order: number, l: ReturnType<typeof label>): Doc => ({
  _id: `term.tmz.catalogue.${kind}.${key}`,
  _type: 'taxonomyTerm',
  _rev: `rev-${key}`,
  projectSlug: 'tmz',
  module: 'catalogue',
  kind,
  key,
  order,
  label: l,
})

const offer = (key: string, price: number) => ({ _key: key, _type: 'catalogueOffer', price })

const item = (id: string, fields: Record<string, unknown>): Doc => ({
  _id: id,
  _type: 'catalogueItem',
  _rev: `rev-${id}`,
  _createdAt: '2026-10-14T13:20:00Z',
  _updatedAt: '2026-10-20T09:00:00Z',
  projectSlug: 'tmz',
  profile: 'book',
  lifecycle: 'published',
  ...fields,
})

export const TMZ_APPLIED_AT = '2026-10-14T13:17:53.730Z'

export function tmzProduction(): Doc[] {
  return [
    {
      _id: 'project-tmz',
      _type: 'project',
      _rev: 'rev-project',
      projectSlug: 'tmz',
      name: 'tmz.it',
      moduleInstallations: [
        { _key: 'inst-blog', _type: 'moduleInstallation', moduleId: 'blog', enabled: true, config: {} },
        {
          _key: 'inst-catalogue',
          _type: 'moduleInstallation',
          moduleId: 'catalogue',
          enabled: true,
          config: {
            currency: 'EUR',
            publicSegment: 'books',
            defaultItemProfile: 'product',
            navLabel: label('Books', 'Libri', 'Bücher'),
            categories: [
              { _key: 'c1', _type: 'catalogueCategoryOption', value: 'design', label: label('Design', 'Design', 'Design') },
              { _key: 'c2', _type: 'catalogueCategoryOption', value: 'technology', label: label('Technology', 'Tecnologia', 'Technologie') },
            ],
            appliedPreset: { id: 'bookshop', version: 1, appliedAt: TMZ_APPLIED_AT },
          },
        },
      ],
    },
    { _id: 'siteConfig-tmz', _type: 'siteConfig', _rev: 'rev-site', projectSlug: 'tmz', timeZone: 'Europe/Rome', defaultLocale: 'en', supportedLocales: ['en', 'it', 'de'], siteName: 'tmz.it' },
    { _id: 'tmz-catalogue-page', _type: 'cataloguePage', _rev: 'rev-page', projectSlug: 'tmz', heroTitle: { _type: 'localizedString', en: 'Between the Lines', it: 'Between the Lines' } },
    term('category', 'technology', 1000, label('Technology', 'Tecnologia', 'Technologie')),
    term('category', 'design', 2000, label('Design', 'Design', 'Design')),
    term('category', 'literature', 3000, label('Literature', 'Letteratura', 'Literatur')),
    term('tag', 'fantasy', 1000, label('Fantasy', 'Fantasy', 'Fantasy')),
    term('tag', 'humour', 2000, label('Humour', 'Umorismo', 'Humor')),
    term('tag', 'illustrated_boos', 3000, label('Illustrated books', 'Libri illustrati', 'Illustrierte Bücher')),
    term('tag', 'inspirational', 4000, label('Inspirational', 'Ispirazionale', 'Inspirierend')),
    term('tag', 'memoir', 5000, label('Memoir', 'Memorie', 'Memoiren')),
    term('tag', 'satire', 6000, label('Satire', 'Satira', 'Satire')),
    term('tag', 'science_fiction', 7000, label('Science fiction', 'Fantascienza', 'Science-Fiction')),
    // 10 published
    item('b1a7e0c2-0001', { name: label('Book 1', 'Libro 1', 'Buch 1'), categories: ['design'], tags: ['illustrated_boos'], offers: [offer('o-1', 24)] }),
    item('b1a7e0c2-0002', { name: label('Book 2', 'Libro 2', 'Buch 2'), categories: ['technology'], offers: [offer('o-2', 18.5)] }),
    item('b1a7e0c2-0003', { name: label('Book 3', 'Libro 3', 'Buch 3'), categories: ['literature'], tags: ['memoir'], offers: [offer('o-3', 12)] }),
    item('b1a7e0c2-0004', { name: label('Book 4', 'Libro 4', 'Buch 4'), categories: ['literature'], tags: ['fantasy', 'humour'] }),
    item('b1a7e0c2-0005', { name: label('Book 5', 'Libro 5', 'Buch 5'), categories: ['technology'] }),
    item('b1a7e0c2-0006', { name: label('Book 6', 'Libro 6', 'Buch 6'), categories: ['design'], tags: ['inspirational'] }),
    item('b1a7e0c2-0007', { name: label('Book 7', 'Libro 7', 'Buch 7'), categories: ['literature'], tags: ['satire'] }),
    item('b1a7e0c2-0008', { name: label('Book 8', 'Libro 8', 'Buch 8'), categories: ['literature'], tags: ['science_fiction'] }),
    item('b1a7e0c2-0009', { name: label('Book 9', 'Libro 9', 'Buch 9'), categories: ['design'] }),
    item('b1a7e0c2-0010', { name: label('Book 10', 'Libro 10', 'Buch 10'), categories: ['technology'] }),
    // 6 drafts: 4 edits of published items (one priced) + 2 new drafts
    item('drafts.b1a7e0c2-0001', { name: label('Book 1 (edit)', 'Libro 1', 'Buch 1'), categories: ['design'], tags: ['illustrated_boos'], offers: [offer('o-1', 24)] }),
    item('drafts.b1a7e0c2-0004', { name: label('Book 4 (edit)', 'Libro 4', 'Buch 4'), categories: ['literature'] }),
    item('drafts.b1a7e0c2-0005', { name: label('Book 5 (edit)', 'Libro 5', 'Buch 5'), categories: ['technology'] }),
    item('drafts.b1a7e0c2-0009', { name: label('Book 9 (edit)', 'Libro 9', 'Buch 9'), categories: ['design'] }),
    item('drafts.c2c4fa97-0011', { name: label('Two categories', 'Due categorie', 'Zwei Kategorien'), lifecycle: 'draft', categories: ['technology', 'literature'] }),
    item('drafts.c2c4fa97-0012', { name: label('Focaccia', 'Focaccia', 'Focaccia'), lifecycle: 'draft', profile: 'food' }),
  ]
}

export const TMZ_COUNTS = { published: 10, drafts: 6, versions: 0, total: 16 }
