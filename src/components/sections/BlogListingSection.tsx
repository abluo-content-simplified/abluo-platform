import type { BlogListingSection as BlogListingSectionType, Post, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { imageUrl } from '@/lib/sanity/image'

// ─── Date formatting ──────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ─── Category chips ───────────────────────────────────────────────────────────

function CategoryChips({ categories }: { categories?: Post['categories'] }) {
  if (!categories?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {categories.map((cat) => (
        <span
          key={cat._id}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest"
          style={{
            background: cat.color
              ? `color-mix(in oklch, ${cat.color} 12%, transparent)`
              : 'color-mix(in oklch, var(--color-primary) 12%, transparent)',
            color: cat.color ?? 'var(--color-primary)',
          }}
        >
          {cat.title}
        </span>
      ))}
    </div>
  )
}

// ─── Post meta (date + read time + author) ────────────────────────────────────

function PostMeta({ post, size = 'sm' }: { post: Post; size?: 'sm' | 'base' }) {
  const textSize = size === 'base' ? 'text-sm' : 'text-xs'
  const avatarSize = size === 'base' ? 'w-8 h-8' : 'w-6 h-6'
  const avatarSrc = post.author?.avatar ? imageUrl(post.author.avatar, 64) : undefined

  return (
    <div className="flex items-center gap-2.5">
      {avatarSrc && (
        <img
          src={avatarSrc}
          alt={post.author?.name ?? ''}
          className={`${avatarSize} rounded-full object-cover shrink-0`}
          loading="lazy"
        />
      )}
      <div className="flex flex-col gap-0.5 min-w-0">
        {post.author?.name && (
          <span
            className={`${textSize} font-medium truncate`}
            style={{ color: 'var(--color-text-primary)' }}
          >
            {post.author.name}
          </span>
        )}
        <div className={`flex items-center gap-1.5 ${textSize}`} style={{ color: 'var(--color-text-muted)' }}>
          {post.publishedAt && <span>{formatDate(post.publishedAt)}</span>}
          {post.publishedAt && post.readingTimeMinutes && (
            <span aria-hidden="true">·</span>
          )}
          {post.readingTimeMinutes && (
            <span>{post.readingTimeMinutes} min read</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Post Card — Standard (used in Grid layout) ───────────────────────────────

function PostCard({ post, href, priority = false }: { post: Post; href: string; priority?: boolean }) {
  const coverSrc = imageUrl(post.coverImage, 800)

  return (
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
      <div className="shrink-0 overflow-hidden" style={{ height: '200px' }}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={post.coverImage?.alt ?? post.title ?? ''}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            loading={priority ? 'eager' : 'lazy'}
          />
        ) : (
          <div className="h-full w-full" style={{ backgroundColor: 'var(--color-border)' }} />
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-5">
        <CategoryChips categories={post.categories} />
        <h3
          className="text-base font-semibold leading-snug tracking-tight mb-2 line-clamp-2"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {post.title}
        </h3>
        {post.excerpt && (
          <p
            className="text-sm leading-relaxed line-clamp-3 flex-1 mb-4"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {post.excerpt}
          </p>
        )}
        <div className="mt-auto pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <PostMeta post={post} />
        </div>
      </div>
    </a>
  )
}

// ─── Post Card — Large (used in Featured layout + Magazine main card) ─────────

function PostCardLarge({ post, href }: { post: Post; href: string }) {
  const coverSrc = imageUrl(post.coverImage, 1200)

  return (
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
      {/* Cover image — taller aspect ratio for impact */}
      <div className="shrink-0 overflow-hidden" style={{ aspectRatio: '16/9' }}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={post.coverImage?.alt ?? post.title ?? ''}
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
            loading="eager"
          />
        ) : (
          <div className="h-full w-full" style={{ backgroundColor: 'var(--color-border)' }} />
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-6 md:p-8">
        <CategoryChips categories={post.categories} />
        <h3
          className="text-2xl md:text-3xl font-semibold leading-snug tracking-tight mb-3 line-clamp-3"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {post.title}
        </h3>
        {post.excerpt && (
          <p
            className="text-base leading-relaxed line-clamp-3 flex-1 mb-6"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {post.excerpt}
          </p>
        )}
        <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <PostMeta post={post} size="base" />
        </div>
      </div>
    </a>
  )
}

// ─── Post Card — Mini (used in Magazine right column) ─────────────────────────

function PostCardMini({ post, href }: { post: Post; href: string }) {
  const coverSrc = imageUrl(post.coverImage, 240)

  return (
    <a
      href={href}
      className="group flex gap-4 p-4 rounded-xl overflow-hidden transition-shadow hover:shadow-md"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid',
        borderColor: 'var(--color-border)',
        textDecoration: 'none',
      }}
    >
      {/* Thumbnail */}
      <div className="shrink-0 overflow-hidden rounded-lg" style={{ width: '80px', height: '80px' }}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={post.coverImage?.alt ?? post.title ?? ''}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full" style={{ backgroundColor: 'var(--color-border)' }} />
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col justify-center min-w-0 gap-1">
        {post.categories?.[0] && (
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-primary)' }}
          >
            {post.categories[0].title}
          </span>
        )}
        <h4
          className="text-sm font-semibold leading-snug line-clamp-2"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {post.title}
        </h4>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {post.publishedAt && <span>{formatDate(post.publishedAt)}</span>}
          {post.readingTimeMinutes && (
            <>
              <span aria-hidden="true">·</span>
              <span>{post.readingTimeMinutes} min</span>
            </>
          )}
        </div>
      </div>
    </a>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a blog post href, optionally appending ?from= for back-button context. */
function postHref(blogBase: string, slug: string, fromParam?: string): string {
  const base = `${blogBase}/${slug}`
  return fromParam ? `${base}?from=${fromParam}` : base
}

// ─── Grid Layout ──────────────────────────────────────────────────────────────

function GridLayout({
  posts,
  blogBase,
  fromParam,
  duration,
  ease,
}: {
  posts: Post[]
  blogBase: string
  fromParam?: string
  duration: number
  ease: string | number[]
}) {
  const count = posts.length
  const gridCols =
    count === 1
      ? 'grid-cols-1 max-w-xl mx-auto w-full'
      : count === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'

  return (
    <div className={`grid gap-6 ${gridCols}`}>
      {posts.map((post, i) => (
        <SlideUp key={post._id} duration={duration} ease={ease} delay={i * 0.08} className="h-full">
          <PostCard post={post} href={postHref(blogBase, post.slug.current, fromParam)} priority={i === 0} />
        </SlideUp>
      ))}
    </div>
  )
}

// ─── Featured Layout ─────────────────────────────────────────────────────────

function FeaturedLayout({
  posts,
  blogBase,
  fromParam,
  duration,
  ease,
}: {
  posts: Post[]
  blogBase: string
  fromParam?: string
  duration: number
  ease: string | number[]
}) {
  const [first, ...rest] = posts
  if (!first) return null

  return (
    <div className="flex flex-col gap-6">
      {/* Primary — always large */}
      <SlideUp duration={duration} ease={ease} delay={0}>
        <PostCardLarge post={first} href={postHref(blogBase, first.slug.current, fromParam)} />
      </SlideUp>

      {/* Secondary cards below — if any */}
      {rest.length > 0 && (
        <div
          className={`grid gap-6 ${
            rest.length === 1
              ? 'grid-cols-1 max-w-xl'
              : rest.length === 2
              ? 'grid-cols-1 sm:grid-cols-2'
              : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          }`}
        >
          {rest.map((post, i) => (
            <SlideUp key={post._id} duration={duration} ease={ease} delay={0.1 + i * 0.08} className="h-full">
              <PostCard post={post} href={postHref(blogBase, post.slug.current, fromParam)} />
            </SlideUp>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Magazine Layout ──────────────────────────────────────────────────────────

function MagazineLayout({
  posts,
  blogBase,
  fromParam,
  duration,
  ease,
}: {
  posts: Post[]
  blogBase: string
  fromParam?: string
  duration: number
  ease: string | number[]
}) {
  const [first, ...rest] = posts
  if (!first) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Main card — 3/5 width on large screens */}
      <SlideUp duration={duration} ease={ease} delay={0} className="lg:col-span-3 h-full">
        <PostCardLarge post={first} href={postHref(blogBase, first.slug.current, fromParam)} />
      </SlideUp>

      {/* Secondary cards — 2/5 width, stacked */}
      {rest.length > 0 && (
        <div className="lg:col-span-2 flex flex-col gap-4">
          {rest.map((post, i) => (
            <SlideUp key={post._id} duration={duration} ease={ease} delay={0.12 + i * 0.1}>
              <PostCardMini post={post} href={postHref(blogBase, post.slug.current, fromParam)} />
            </SlideUp>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  section: BlogListingSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
  tenantId: string
  /**
   * When set, appended as ?from=${fromParam} to every card link.
   * The blog detail page reads this to show the correct back-button label.
   * e.g. "home" → "Back to Home", "investors" → "Back to Investors"
   */
  fromParam?: string
}

export function BlogListingSection({ section, surface, designSystem, locale, tenantId, fromParam }: Props) {
  const {
    eyebrow,
    title,
    subtitle,
    layout = 'grid',
    viewAllLabel,
    viewAllHref,
  } = section

  const posts = section.posts ?? []
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Base URL for post detail links: /[locale]/[tenant]/blog
  const blogBase = `/${locale}/${tenantId}/blog`

  // Motion tokens — durationSlow for content sections
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // Nothing to render without posts
  if (posts.length === 0) return null

  return (
      <SectionContainer style={surfaceStyles}>
        {/* Section header */}
        {(eyebrow || title || subtitle) && (
          <SlideUp duration={duration} ease={ease} delay={0} className="mb-12">
            {eyebrow && (
              <p
                className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {eyebrow}
              </p>
            )}
            {title && (
              <h2
                className="text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {title}
              </h2>
            )}
            {subtitle && (
              <p
                className="mt-3 text-base leading-relaxed max-w-2xl"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {subtitle}
              </p>
            )}
          </SlideUp>
        )}

        {/* Posts — layout variant */}
        {layout === 'featured' ? (
          <FeaturedLayout posts={posts} blogBase={blogBase} fromParam={fromParam} duration={duration} ease={ease} />
        ) : layout === 'magazine' ? (
          <MagazineLayout posts={posts} blogBase={blogBase} fromParam={fromParam} duration={duration} ease={ease} />
        ) : (
          <GridLayout posts={posts} blogBase={blogBase} fromParam={fromParam} duration={duration} ease={ease} />
        )}

        {/* View All button — shown when label + href are both set */}
        {viewAllLabel && viewAllHref && (
          <SlideUp duration={duration} ease={ease} delay={0.25} className="mt-12 flex justify-center">
            <a
              href={viewAllHref}
              className="inline-flex items-center gap-2 px-7 py-3 rounded-lg text-sm font-medium border transition-opacity hover:opacity-75"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            >
              {viewAllLabel}
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                style={{ opacity: 0.5 }}
              >
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </SlideUp>
        )}
      </SectionContainer>

  )
}
