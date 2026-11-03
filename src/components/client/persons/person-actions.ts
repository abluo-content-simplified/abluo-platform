import { anonymisePersonAction } from '@/app/[locale]/(client)/[tenant]/people/actions'

/** Anonymises from the list; resolves to the error code, or null when it worked. */
export async function anonymiseFromList(projectSlug: string, id: string): Promise<string | null> {
  const r = await anonymisePersonAction({ projectSlug, id })
  return r.ok ? null : r.error
}
