/**
 * PostCard — reusable blog post card used in Related Articles and any
 * other context that needs a compact post preview with a link.
 *
 * For the full blog listing section with layout variants (grid / featured /
 * magazine), use BlogListingSection which has its own inline card components.
 */

import type { Post } from '@/lib/sanity/types'
import { imageUrl } from '@/lib/sanity/image'
import { SlideUp } from '@/components/animation/SlideUp'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

interface PostCardProps {
  post: Post
  href: string
  /** Stagger delay in seconds */
  delay?: number
  /** Animation duration in seconds */
  duration?: number
  /** Easing — CSS cubic-bezier string or [x1,y1,x2,y2] array */
  ease?: string | number[]
}

export function PostCard({
  post,
  href,
  delay = 0,
  duration = 0.35,
  ease = [0.0, 0.0, 0.2, 1],
}: PostCardProps) {
  const coverSrc = imageUrl(post.coverImage, 800)

  return (
    <SlideUp delay={delay} duration={duration} ease={ease} className="h-full">
      <a
        href={href}
        className="group flex flex-col h-full overflow-hidden rounded-2xl transition-shadow hover:shadow-lg"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid',
          borderColor: 'var(--color-border)',
          textDecoration: 'none',
        }}
      >
        {/* Cover image */}
        <div className="shrink-0 overflow-hidden" style={{ height: '180px' }}>
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={post.coverImage?.alt ?? post.title ?? ''}
              className={`h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full" style={{ backgroundColor: 'var(--color-border)' }} />
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 p-5">
          {/* Categories */}
          {post.categories && post.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {post.categories.map((cat) => (
                <span
                  key={cat.key}
                  className="text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: cat.color ?? 'var(--color-primary)' }}
                >
                  {cat.title}
                </span>
              ))}
            </div>
          )}

          <h3
            className="text-sm font-semibold leading-snug tracking-tight mb-2 line-clamp-2"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
          >
            {post.title}
          </h3>

          {post.excerpt && (
            <p
              className="text-xs leading-relaxed line-clamp-2 flex-1 mb-3"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {post.excerpt}
            </p>
          )}

          <div className="mt-auto flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {post.publishedAt && <span>{formatDate(post.publishedAt)}</span>}
            {post.publishedAt && post.readingTimeMinutes && <span aria-hidden="true">·</span>}
            {post.readingTimeMinutes && <span>{post.readingTimeMinutes} min</span>}
          </div>
        </div>
      </a>
    </SlideUp>
  )
}
