import 'server-only'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { PEOPLE_GROUP_KIND, PEOPLE_MODULE_ID } from '@/lib/modules/people/model'
import { listTerms } from '@/lib/taxonomy/service'
import { toPickerTerm, type PickerTerm } from '@/components/client/taxonomy/term-picker-model'

/**
 * The People groups ("Dentist", "Yoga Teacher" …) of a project, for the group
 * filter and the editor's group picker: the People module's category terms
 * from Categories & Tags (ADR-043 D3), in their order. A project that cannot
 * read them (no taxonomy yet, a read failure) simply has no groups — the
 * People screens work without.
 */
export async function loadGroupTerms(ctx: TenantAuthorizationContext, projectId: string): Promise<PickerTerm[]> {
  try {
    const list = await listTerms(ctx, projectId, PEOPLE_MODULE_ID, PEOPLE_GROUP_KIND)
    return list.terms.map((x) => toPickerTerm(x))
  } catch {
    return []
  }
}
