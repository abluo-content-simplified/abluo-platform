// ── Gallery module — section component map (ADR-022) ─────────────────────────
// Imported by src/lib/modules/sections.ts, never by registry.ts — the registry
// stays declarative and out of the Next.js bundle's way (see blog/sections.tsx).

import { PhotoGallerySection } from '@/components/sections/PhotoGallerySection'
import type { PhotoGallerySection as PhotoGallerySectionType, PageSection, DesignSystem } from '@/lib/sanity/types'
import type { SurfaceType } from '@/lib/sanity/surfaces'

type LocalSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
}

export const gallerySectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  photoGallerySection: ({ section, surface, designSystem, locale }) => (
    <PhotoGallerySection
      section={section as PhotoGallerySectionType}
      surface={surface}
      designSystem={designSystem}
      locale={locale}
    />
  ),
}
