import type { DownloadSection as DownloadSectionType, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { renderHeadline } from '@/lib/headline-accent'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { formatAccessMessage, getAccessMessages } from '@/lib/i18n/access-messages'
import { imageUrl } from '@/lib/sanity/image'
import { DownloadDocumentList } from '@/components/sections/DownloadDocumentList'

// ── Download section (Documents module, ADR-040 §15) ──────────────────────────
// Presentation only. The documents were chosen by the client in the dashboard
// ("Show on") and filtered for THIS visitor by hydrateDownloadSections (the
// page gate already decided the page). Each row links to the document route,
// which authorises the file again on its own. No document → no section.
// The list itself (with the category filter and tags) is DownloadDocumentList.

interface Props {
  section: DownloadSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
}

const TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
}

function formatSize(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024)
  try {
    if (mb >= 1) return new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(mb)
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 0 }).format(Math.max(1, Math.round(bytes / 1024)))
  } catch {
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
}

function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

export function DownloadSection({ section, surface, designSystem, locale }: Props) {
  const documents = section.documents ?? []
  if (documents.length === 0) return null
  const m = getAccessMessages(locale)
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const motion = designSystem?.motion
  const entranceDuration = motion?.durationSlow !== undefined ? motion.durationSlow / 1000 : 0.35
  const ease = resolveEasing(motion?.easingDecelerate, [0.0, 0.0, 0.2, 1])
  const image = section.image ? imageUrl(section.image as never, 320) : null

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      <div className="max-w-[760px]">
        <SlideUp duration={entranceDuration} ease={ease} delay={0}>
          <div className="mb-10 flex items-start gap-6">
            <div className="min-w-0 flex-1">
              {section.eyebrow && <EyebrowLabel eyebrow={section.eyebrow} designSystem={designSystem} defaultAccent="none" className="mb-4" />}
              {section.title && (
                <h2
                  className={`${section.intro ? 'mb-4' : ''} [--fs-h2:1.875rem] md:[--fs-h2:2.25rem]`}
                  style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
                >
                  {renderHeadline(section.title, section.headlineAccent)}
                </h2>
              )}
              {section.intro && (
                <p className="text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{section.intro}</p>
              )}
            </div>
            {image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="hidden h-20 w-20 shrink-0 rounded-[var(--radius-md,12px)] object-cover sm:block" />
            )}
          </div>
        </SlideUp>

        <SlideUp duration={entranceDuration} ease={ease} delay={0.1}>
          <DownloadDocumentList
            documents={documents}
            meta={Object.fromEntries(documents.map((d) => [d.id, [
              d.category?.label ?? null,
              TYPE_LABEL[d.file.mimeType] ?? '',
              formatSize(d.file.sizeBytes, locale),
              d.file.locale !== locale ? formatAccessMessage(m.inLanguage, { language: languageName(d.file.locale, locale) }) : null,
            ].filter(Boolean).join(' · ')]))}
            labels={{ view: m.view, download: m.download, lock: m.lockedLinkLabel, all: m.allCategories, filter: m.categoryFilterLabel }}
          />
        </SlideUp>
      </div>
    </SectionContainer>
  )
}
