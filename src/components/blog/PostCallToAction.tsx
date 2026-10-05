import { tenantClient } from '@/lib/sanity/client'
import { postCallToActionsQuery } from '@/lib/sanity/queries'
import { resolvePostCta, selectPostCta, type PostCtaChoice, type ResolvedPostCta, type SiteCallToAction } from '@/lib/blog/post-cta'
import type { RenderableFormDefinition } from '@/lib/sanity/types'
import type { UrlProjectSegment } from '@/lib/tenancy/ids'
import { PostCtaButton } from './PostCtaButton'

/**
 * The call to action at the end of a blog post (server component).
 *
 * Usage (live page and draft preview):
 *   <PostCallToAction tenantSlug={tenantId} locale={locale} defaultLocale={defaultLocale} cta={post.cta} />
 *
 * `cta` is the post's choice (`postBySlugQuery` projects it). The project's
 * callToAction documents are fetched here (`postCallToActionsQuery`) unless the caller
 * already has them (`ctas`). Renders nothing for "none", for a site without
 * CTAs, and when the CTA has no heading / button label in `locale` — never a
 * fallback to another language.
 */
export async function PostCallToAction({
  tenantSlug,
  locale,
  defaultLocale,
  cta,
  ctas,
}: {
  /** The `[tenant]` URL segment. */
  tenantSlug: UrlProjectSegment
  locale: string
  /** The site's default locale (the form definition's own language fallback). */
  defaultLocale?: string
  cta: PostCtaChoice
  /** Pre-fetched result of postCallToActionsQuery; fetched when omitted. */
  ctas?: SiteCallToAction[] | null
}) {
  if ((cta?.mode ?? 'default') === 'none') return null
  const list =
    ctas !== undefined
      ? ctas
      : await tenantClient(tenantSlug)
          .fetchForTenant<SiteCallToAction[] | null>(postCallToActionsQuery, { locale, defaultLocale: defaultLocale ?? locale })
          .catch(() => null)
  const resolved = resolvePostCta({ cta }, list, locale)
  if (!resolved) return null
  const form = resolved.target.kind === 'form' ? (selectPostCta(cta, list)?.form as RenderableFormDefinition | null) : null
  return <PostCallToActionView cta={resolved} form={form} tenantSlug={tenantSlug} locale={locale} />
}

/** Pure render of a resolved CTA (exported for tests and for callers that resolve themselves). */
export function PostCallToActionView({
  cta,
  form,
  tenantSlug,
  locale,
}: {
  cta: ResolvedPostCta
  form?: RenderableFormDefinition | null
  tenantSlug: UrlProjectSegment
  locale: string
}) {
  const id = `post-cta-${cta.id.replace(/[^A-Za-z0-9_-]/g, '')}`
  return (
    <aside
      aria-labelledby={id}
      data-post-cta={cta.id}
      className="mx-auto mt-16 w-full max-w-2xl rounded-[var(--radius-card,1rem)] border px-6 py-10 text-center md:px-10"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface-1, transparent)' }}
    >
      <h2
        id={id}
        style={{
          color: 'var(--color-text-primary)',
          fontFamily: 'var(--font-heading)',
          fontSize: 'var(--font-size-h3, 1.5rem)',
          fontWeight: 'var(--font-weight-h3, 700)',
          letterSpacing: 'var(--letter-spacing-h3, -0.01em)',
          lineHeight: 'var(--line-height-h3, 1.25)',
        }}
      >
        {cta.heading}
      </h2>
      {cta.text ? (
        <p
          className="mx-auto mt-3 max-w-prose text-base"
          style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.7 }}
        >
          {cta.text}
        </p>
      ) : null}
      <div className="mt-6 flex justify-center">
        <PostCtaButton
          target={cta.target}
          label={cta.buttonLabel}
          internalName={cta.internalName}
          form={form}
          tenantSlug={tenantSlug}
          locale={locale}
        />
      </div>
    </aside>
  )
}
