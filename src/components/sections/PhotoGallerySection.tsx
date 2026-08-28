import type { PhotoGallerySection, GalleryItem, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'

interface Props {
  section: PhotoGallerySection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAspectRatioClass(ratio: PhotoGallerySection['imageRatio']): string {
  switch (ratio) {
    case 'landscape': return 'aspect-[4/3]'
    case 'portrait':  return 'aspect-[3/4]'
    case 'auto':      return ''
    case 'square':
    default:          return 'aspect-square'
  }
}

function getGridClass(columns: number): string {
  switch (columns) {
    case 2:  return 'grid-cols-1 sm:grid-cols-2'
    case 4:  return 'grid-cols-2 md:grid-cols-4'
    case 3:
    default: return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
  }
}

function getGapClass(spacing: PhotoGallerySection['spacing']): string {
  switch (spacing) {
    case 'tight': return 'gap-1'
    case 'loose': return 'gap-6'
    case 'normal':
    default:      return 'gap-3'
  }
}

/** Derive effective display title and caption from a gallery item */
function resolveItem(item: GalleryItem): { title?: string; caption?: string } {
  const title = item.titleOverrideEnabled && item.titleOverride
    ? item.titleOverride
    : item.mediaAsset?.title

  const caption = item.captionOverrideEnabled && item.captionOverride
    ? item.captionOverride
    : item.mediaAsset?.caption

  return { title, caption }
}

// ─── Video fallback card ───────────────────────────────────────────────────────

function VideoFallbackCard({ item, ratioClass }: { item: GalleryItem; ratioClass: string }) {
  const { title } = resolveItem(item)
  return (
    <div
      className={`relative w-full overflow-hidden rounded-sm ${ratioClass || 'aspect-video'} flex items-center justify-center`}
      style={{ backgroundColor: 'var(--color-surface, var(--color-background))' }}
    >
      {/* Play icon */}
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.15 }}
      />
      <svg
        className="absolute h-6 w-6"
        style={{ color: 'var(--color-text-primary)', opacity: 0.5 }}
        fill="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
      {title && (
        <p
          className="absolute bottom-2 left-2 right-2 truncate text-xs font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {title}
        </p>
      )}
    </div>
  )
}

// ─── Single gallery image ──────────────────────────────────────────────────────

function GalleryImageCard({
  item,
  ratioClass,
  showCaptions,
}: {
  item: GalleryItem
  ratioClass: string
  showCaptions: boolean
}) {
  const asset = item.mediaAsset
  const { title, caption } = resolveItem(item)

  if (!asset?.image) {
    return (
      <div
        className={`w-full rounded-sm ${ratioClass || 'aspect-square'}`}
        style={{ backgroundColor: 'var(--color-surface-alt, var(--color-background))' }}
      />
    )
  }

  const src = imageUrl(asset.image, 800)
  const srcSet = imageSrcSet(asset.image, [400, 800, 1200])
  const altValue = asset.altText ?? title ?? ''

  return (
    <figure className="group relative overflow-hidden rounded-sm">
      {ratioClass ? (
        <div className={`relative w-full ${ratioClass} overflow-hidden`}>
          <img
            src={src}
            srcSet={srcSet}
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 33vw"
            alt={altValue}
            loading="lazy"
            decoding="async"
            className={`absolute inset-0 h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
          />
        </div>
      ) : (
        <img
          src={src}
          srcSet={srcSet}
          sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 33vw"
          alt={altValue}
          loading="lazy"
          decoding="async"
          className={`w-full object-cover ${IMAGE_HOVER_CLASSES}`}
        />
      )}

      {showCaptions && (caption || title) && (
        <figcaption
          className="mt-2 text-xs leading-relaxed"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {caption ?? title}
        </figcaption>
      )}
    </figure>
  )
}

// ─── Main section ──────────────────────────────────────────────────────────────

export function PhotoGallerySection({ section, surface, designSystem }: Props) {
  const { eyebrow, headline, description, gallery, showCaptions = false } = section
  const columns = section.columns ?? 3
  const imageRatio = section.imageRatio ?? 'square'
  const spacing = section.spacing ?? 'normal'

  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  const hasHeader = Boolean(eyebrow || headline || description)
  const items = gallery?.items ?? []

  const gridClass = getGridClass(columns)
  const gapClass = getGapClass(spacing)
  const ratioClass = getAspectRatioClass(imageRatio)

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {/* Optional header */}
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-12 max-w-2xl">
          {eyebrow && (
            <p
              className="mb-5 text-xs font-semibold uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {eyebrow}
            </p>
          )}
          {headline && (
            <h2
              className="text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-heading)',
              }}
            >
              {headline}
            </h2>
          )}
          {description && (
            <p
              className="mt-5 text-base leading-relaxed"
              style={{
                color: 'var(--color-text-secondary)',
                fontFamily: 'var(--font-body)',
                maxWidth: '52ch',
              }}
            >
              {description}
            </p>
          )}
        </SlideUp>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No items in this gallery yet.
        </p>
      )}

      {/* Gallery grid */}
      {items.length > 0 && (
        <div className={`grid ${gridClass} ${gapClass}`}>
          {items.map((item, index) => (
            <SlideUp
              key={item._key}
              duration={duration}
              ease={ease}
              delay={Math.min(index * 0.04, 0.4)}
            >
              {item.mediaAsset?.mediaType === 'video' ? (
                <VideoFallbackCard item={item} ratioClass={ratioClass} />
              ) : (
                <GalleryImageCard
                  item={item}
                  ratioClass={ratioClass}
                  showCaptions={showCaptions}
                />
              )}
            </SlideUp>
          ))}
        </div>
      )}
    </SectionContainer>
  )
}
