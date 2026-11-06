// The notes under the timetable (and at the bottom of the printout): restricted rich text — paragraphs, lists,
// bold, italic and links — rendered with the same rules as FAQ answers (internal links resolved server-side,
// plain text when the target is gone). Server component: the blocks are turned into elements here and passed on.

import { FaqAnswer } from '@/components/faq/FaqAnswer'
import { siteHostsForProject } from '@/lib/links/link-target'
import type { PortableTextBlock } from '@/lib/sanity/types'

export function TimetableNotes({ blocks, siteBase, projectSlug, className }: { blocks: unknown; siteBase: string; projectSlug: string; className?: string }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null
  return (
    <div className={className} data-timetable-notes>
      <FaqAnswer answer={{ kind: 'rich', blocks: blocks as PortableTextBlock[] }} links={{ siteBase, siteHosts: siteHostsForProject(projectSlug), projectSlug }} />
    </div>
  )
}
