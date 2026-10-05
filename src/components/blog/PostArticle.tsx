import type React from 'react'
import type { Post, DesignSystem } from '@/lib/sanity/types'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { resolveEmbedUrl } from '@/lib/embed'
import { SlideUp } from '@/components/animation'
import { BackButton } from '@/components/events/BackButton'
import { PortableText } from '@portabletext/react'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'
import { resolveBodyLinks, siteHostsForProject } from '@/lib/links/link-target'
import { PostCard } from '@/components/blog/PostCard'
import { GalleryPlacement } from '@/components/gallery/GalleryPlacement'
import { focalObjectPosition } from '@/lib/gallery/focal'

/**
 * The blog post article — everything between the site header and footer on a
 * post page. Shared by the live post page (`(website)/[tenant]/blog/[slug]`)
 * and the private draft preview (`(website)/[tenant]/preview/post/[id]`), so
 * a client previews EXACTLY what visitors will see. Moved verbatim out of the
 * live page; anything the post page renders belongs here.
 */
export interface PostArticleProps {
  post: Post
  relatedPosts: Post[]
  designSystem: DesignSystem | null
  locale: string
  /** Link prefix for this site (`/it/hoffmann` on platform hosts, `/it` on its own domain). */
  siteBase: string
  backLabel: string
  backUrl: string
  /** False when the Gallery module is off for this website. */
  showGallery: boolean
  /** End-of-post call to action (rendered by the caller: `<PostCallToAction …/>`). */
  callToAction?: React.ReactNode
}

export function PostArticle({
  post,
  relatedPosts,
  designSystem,
  locale,
  siteBase,
  backLabel,
  backUrl,
  showGallery,
  callToAction,
}: PostArticleProps) {
  const coverSrc = imageUrl(post.coverImage, 1600)
  const coverSrcSet = imageSrcSet(post.coverImage, [800, 1200, 1600, 2400])

  const publishedDate = post.publishedAt
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(post.publishedAt)
      )
    : null

  const authorAvatarSrc = post.author?.avatar ? imageUrl(post.author.avatar, 80) : undefined
  const featuredVideoSrc = resolveEmbedUrl(post.featuredVideo?.youtubeUrl)
  return (
    <div style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="mx-auto max-w-[780px] px-5 py-12 md:px-8">

        {/* ── Back button ───────────────────────────────────────── */}
        <SlideUp duration={0.5}>
          <BackButton
            fallbackUrl={backUrl}
            label={backLabel}
          />
        </SlideUp>

        {/* ── Categories ────────────────────────────────────────── */}
        {post.categories && post.categories.length > 0 && (
          <SlideUp delay={0.05} duration={0.5}>
            <div className="flex flex-wrap gap-2 mb-5">
              {post.categories.map((cat) => (
                <span
                  key={cat.key}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-widest"
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
          </SlideUp>
        )}

        {/* ── Title ────────────────────────────────────────────── */}
        <SlideUp delay={0.08} duration={0.6}>
          <h1
            className="text-[clamp(30px,6vw,50px)] font-bold leading-[1.1] tracking-tight mb-6"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
          >
            {post.title}
          </h1>
        </SlideUp>

        {/* ── Author + date + reading time ──────────────────────── */}
        <SlideUp delay={0.12} duration={0.5}>
          <div
            className="flex items-center gap-3 mb-10 pb-8"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            {authorAvatarSrc && (
              <img
                src={authorAvatarSrc}
                alt={post.author?.name ?? ''}
                className="w-10 h-10 rounded-full object-cover shrink-0"
              />
            )}
            <div>
              {post.author?.name && (
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {post.author.name}
                  {post.author.role && (
                    <span className="font-normal ml-1" style={{ color: 'var(--color-text-muted)' }}>
                      · {post.author.role}
                    </span>
                  )}
                </p>
              )}
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {publishedDate}
                {post.readingTimeMinutes && ` · ${post.readingTimeMinutes} min read`}
              </p>
            </div>
          </div>
        </SlideUp>

        {/* ── Cover image ───────────────────────────────────────── */}
        {coverSrc && (
          <SlideUp delay={0.15} duration={0.6}>
            <figure className="mb-10">
              {/* Fixed 16:9 container — image always fills with object-cover, no gaps */}
              <div className="overflow-hidden rounded-xl" style={{ aspectRatio: '16 / 9' }}>
                <img
                  src={coverSrc}
                  srcSet={coverSrcSet}
                  alt={post.coverImage?.alt ?? post.title ?? ''}
                  className="block h-full w-full object-cover"
                  style={{ objectPosition: focalObjectPosition(post.coverImage) }}
                  loading="eager"
                />
              </div>
              {post.coverImage?.caption && (
                <figcaption className="mt-2 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                  {post.coverImage.caption}
                </figcaption>
              )}
            </figure>
          </SlideUp>
        )}

        {/* ── Excerpt / lead ────────────────────────────────────── */}
        {post.excerpt && (
          <SlideUp delay={0.18} duration={0.5}>
            <p
              className="text-lg font-medium leading-relaxed mb-8"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {post.excerpt}
            </p>
          </SlideUp>
        )}

        {/* ── Body ──────────────────────────────────────────────── */}
        {post.body && (
          <SlideUp delay={0.2} duration={0.5}>
            <div className="mb-12">
              <PortableText
                // Internal links → URLs in this language; new-tab rule + override (links round 2).
                value={
                  resolveBodyLinks(post.body, {
                    siteBase,
                    siteHosts: siteHostsForProject(post.projectSlug),
                    projectSlug: post.projectSlug,
                  }) as Parameters<typeof PortableText>[0]['value']
                }
                components={articlePortableTextComponents}
              />
            </div>
          </SlideUp>
        )}

        {/* ── Gallery (ADR-022 §6) ──────────────────────────────────
            Optional, below the text. Rendered only while the Gallery module
            is active for this website; an unresolved module list fails open,
            like module sections do (isSectionTypeAvailable). */}
        {showGallery && post.gallery && (
          <section className="mb-12" aria-label={post.gallery.title ?? undefined}>
            {post.gallery.title && (
              <h2
                className="text-2xl font-semibold mb-6"
                style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
              >
                {post.gallery.title}
              </h2>
            )}
            <GalleryPlacement
              galleries={[post.gallery]}
              layout={post.galleryLayout ?? 'grid'}
              columns={2}
              imageRatio="landscape"
              locale={locale}
              designSystem={designSystem}
            />
          </section>
        )}

        {/* ── Call to action (site default / chosen / none) ─────────── */}
        {callToAction ? <div className="mb-12">{callToAction}</div> : null}

        {/* ── Featured video ────────────────────────────────────── */}
        {featuredVideoSrc && (
          <SlideUp delay={0.25} duration={0.5}>
            <div className="mb-12">
              <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
                <iframe
                  src={featuredVideoSrc}
                  title={post.title}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          </SlideUp>
        )}

        {/* ── Related event ─────────────────────────────────────── */}
        {post.relatedEvent && (
          <SlideUp delay={0.28} duration={0.5}>
            <div
              className="mb-12 p-6 rounded-xl flex items-center gap-4"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-primary)' }}>
                  Related Event
                </p>
                <p className="text-base font-semibold truncate" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
                  {post.relatedEvent.title}
                </p>
                {post.relatedEvent.startDate && (
                  <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
                      new Date(post.relatedEvent.startDate)
                    )}
                  </p>
                )}
              </div>
              <a
                href={`${siteBase}/events/${post.relatedEvent.slug.current}`}
                className="shrink-0 text-sm font-medium px-4 py-2 rounded-lg transition-opacity hover:opacity-75"
                style={{ backgroundColor: 'color-mix(in oklch, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)' }}
              >
                View Event →
              </a>
            </div>
          </SlideUp>
        )}

        {/* ── Related posts ─────────────────────────────────────── */}
        {relatedPosts && relatedPosts.length > 0 && (
          <SlideUp delay={0.3} duration={0.5}>
            <div
              className="mt-16 pt-10"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <h2
                className="text-2xl font-semibold mb-8"
                style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
              >
                Related Articles
              </h2>
              <div
                className={`grid gap-6 ${
                  relatedPosts.length === 1
                    ? 'grid-cols-1 max-w-sm'
                    : relatedPosts.length === 2
                    ? 'grid-cols-1 sm:grid-cols-2'
                    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                }`}
              >
                {relatedPosts.map((related, i) => (
                  <PostCard
                    locale={locale}
                    key={related._id}
                    post={related}
                    href={`${siteBase}/blog/${related.slug.current}`}
                    delay={i * 0.07}
                  />
                ))}
              </div>
            </div>
          </SlideUp>
        )}

        {/* ── Bottom navigation ─────────────────────────────────── */}
        <SlideUp delay={0.35} duration={0.5}>
          <div
            className="mt-16 pt-8 flex items-center justify-between gap-4 flex-wrap"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <a
              href={backUrl}
              className="inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-75"
              style={{ color: 'var(--color-primary)' }}
            >
              ← {backLabel}
            </a>
            <a
              href={`${siteBase}/blog`}
              className="inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-75"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              View All Posts →
            </a>
          </div>
        </SlideUp>

      </div>
    </div>
  )
}
