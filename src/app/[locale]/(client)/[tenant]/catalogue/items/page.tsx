import { CatalogueListScreen, type CatalogueListProps } from '../list-screen'

/** ADR-042 N2: Catalogue → Items is its own route and sidebar destination. */
export const dynamic = 'force-dynamic'

export default function ItemsPage(props: CatalogueListProps) {
  return <CatalogueListScreen {...props} view="items" />
}
