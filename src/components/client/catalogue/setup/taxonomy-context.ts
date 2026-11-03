import type { CatalogueTaxonomyView } from '@/lib/modules/catalogue/taxonomy/service'
import type { CategoryTree, PathContext } from '@/lib/modules/catalogue/taxonomy/types'
import type { ChannelDraft } from './setup-model'
import type { SetupFail } from './setup-ui'

/** What the Categories & Tags panels share: the loaded view, its tree, and the one way to run an action. */
export type TaxonomyScreen = {
  projectSlug: string
  view: CatalogueTaxonomyView
  tree: CategoryTree
  pathContext: PathContext
  /** A category's or tag's name in the website's main language. */
  categoryName: (key: string) => string
  tagName: (key: string) => string
  /** The row fingerprints loaded with the view (C1.7a changedKeys on conflict). */
  baseHashes: () => Record<string, string>
  /** Active channels with their defaults (what "Inherit" gives at the top of the tree). */
  channels: readonly ChannelDraft[]
  /**
   * Runs an action result: on success reloads the list and shows `ok` (when given); on a refusal
   * shows it in plain words (a conflict reloads first, so the person sees the latest). Returns
   * the success value or null.
   */
  settle: <T extends object>(result: ({ ok: true } & T) | SetupFail, ok?: string | ((value: T) => string)) => Promise<T | null>
  failText: (fail: SetupFail) => string
  show: (message: string, tone?: 'status' | 'error') => void
}
