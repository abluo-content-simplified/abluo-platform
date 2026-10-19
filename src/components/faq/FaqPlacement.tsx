import type { DesignSystem } from '@/lib/sanity/types'
import type { FaqGroup } from '@/lib/faq/items'
import { siteHostsForProject } from '@/lib/links/link-target'
import { resolveEasing } from '@/lib/motion/easing'
import { FaqAccordion } from './FaqAccordion'
import { FaqAnswer } from './FaqAnswer'

// ── FaqPlacement (server) ─────────────────────────────────────────────────────
// The ONE renderer of FAQ questions (ADR-037 D6), like GalleryPlacement: the
// FAQ section, a blog post and later an event all hand it the groups from
// placementFaqGroups (src/lib/faq/items.ts) — the same groups the FAQPage
// JSON-LD is built from — so what visitors read and what answer engines read
// never drift. Headings around it belong to the placement; this renders the
// questions only. Empty groups → nothing.

export interface FaqPlacementProps {
  groups: FaqGroup[]
  /** With several sets, head each group with its set title (default on). */
  showSetTitles?: boolean | null
  /** Link prefix of this site (`/it/hoffmann`, or `/it` on its own domain). */
  siteBase: string
  designSystem: DesignSystem | null
}

export function FaqPlacement({ groups, showSetTitles, siteBase, designSystem }: FaqPlacementProps) {
  if (groups.length === 0) return null

  // Motion tokens — durationFast for the accordion interaction (CLAUDE.md).
  const m = designSystem?.motion
  const itemDuration = m?.durationFast !== undefined ? m.durationFast / 1000 : 0.12
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])
  const titled = showSetTitles !== false && groups.length > 1

  return (
    <div className={titled ? 'space-y-10' : undefined}>
      {groups.map((group) => {
        const links = { siteBase, siteHosts: siteHostsForProject(group.projectSlug), projectSlug: group.projectSlug }
        return (
          <div key={group.id}>
            {titled && group.title && (
              <h3
                className="mb-4 text-lg font-semibold"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {group.title}
              </h3>
            )}
            <FaqAccordion
              items={group.items.map((item) => ({
                key: item.key,
                question: item.question,
                answer: <FaqAnswer answer={item.answer} links={links} />,
              }))}
              itemDuration={itemDuration}
              ease={ease}
            />
          </div>
        )
      })}
    </div>
  )
}
