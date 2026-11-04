import { cookies } from 'next/headers'
import { initialListQuery, listQueryCookieName, type RememberedList } from './remembered-list-query'

/** The query a list page starts from: the address's, else this person's last one for this list and site. */
export async function startingListQuery(list: RememberedList, projectSlug: string, addressQuery: string): Promise<string> {
  if (addressQuery) return addressQuery
  const jar = await cookies()
  return initialListQuery('', jar.get(listQueryCookieName(list, projectSlug))?.value)
}
