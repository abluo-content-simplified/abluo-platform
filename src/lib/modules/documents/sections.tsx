// ── Documents module — section component map (ADR-040 §15) ───────────────────
// Imported by src/lib/modules/sections.ts, never by registry.ts (see faq/sections.tsx).

import { DownloadSection } from '@/components/sections/DownloadSection'
import type { DownloadSection as DownloadSectionType, PageSection, DesignSystem } from '@/lib/sanity/types'
import type { SurfaceType } from '@/lib/sanity/surfaces'

type LocalSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
}

export const documentsSectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  downloadSection: ({ section, surface, designSystem, locale }) => (
    <DownloadSection section={section as DownloadSectionType} surface={surface} designSystem={designSystem} locale={locale} />
  ),
}
