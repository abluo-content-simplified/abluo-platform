import { CatalogueListScreen, type CatalogueListProps } from '../list-screen'

/** ADR-042 N2: Catalogue → Collections is its own route and sidebar destination. */
export const dynamic = 'force-dynamic'

export default function CollectionsPage(props: CatalogueListProps) {
  return <CatalogueListScreen {...props} view="collections" />
}
