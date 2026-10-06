'use client'

import type { MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Checkbox, isShiftChange } from '@/components/client/ui/Checkbox'
import { CardMenu, type CardMenuItem } from '@/components/client/ui/CardMenu'
import { CardGrid, CardGridItem, ContentCard } from '@/components/client/ui/list/ContentCard'
import { CardDateLine, CategoryChips, FeaturedStar, LanguageTicks, LocalDate, StatusPill, Thumb } from './post-bits'
import type { BrowserPost } from './types'

type CardProps = {
  posts: BrowserPost[]
  canEdit: boolean
  selected: Set<string>
  onToggle: (id: string, checked: boolean, shift: boolean) => void
  onOpen: (post: BrowserPost, newTab: boolean) => void
  menuFor: (post: BrowserPost) => CardMenuItem[]
}

/** A click on the card body opens the post; its own controls and links keep their click. */
function cardClick(post: BrowserPost, onOpen: CardProps['onOpen']) {
  return (e: MouseEvent<HTMLElement>) => {
    if (!post.href) return
    if ((e.target as HTMLElement).closest('a,button,input,label,[role="dialog"]')) return
    onOpen(post, e.metaKey || e.ctrlKey)
  }
}

/**
 * Desktop cards view: the generic CardGrid / ContentCard configured for posts
 * — 16:10 cover (or same-size placeholder), title, categories, status,
 * language ticks and dates. Checkbox top-left, star and ⋯ top-right, all as
 * 2rem overlay chips.
 */
export function PostCardsGrid({
  posts,
  canEdit,
  selected,
  onToggle,
  onOpen,
  menuFor,
  onFeatured,
}: CardProps & { onFeatured: (post: BrowserPost, next: boolean) => Promise<boolean> }) {
  const t = useTranslations('clientDashboard.posts')
  return (
    <CardGrid>
      {posts.map((post) => (
        <CardGridItem key={post._id}>
          <ContentCard
            media={{ src: post.cardImage ?? post.thumb }}
            title={post.title}
            subtitle={post.subtitle}
            href={post.href}
            onOpen={post.href ? (newTab) => onOpen(post, newTab) : undefined}
            selection={
              canEdit
                ? {
                    checked: selected.has(post._id),
                    onChange: (checked, shift) => onToggle(post._id, checked, shift),
                    label: t('select.checkbox', { title: post.title }),
                  }
                : undefined
            }
            overlay={
              <>
                <FeaturedStar variant="chip" featured={post.featured} title={post.title} onChange={canEdit ? (next) => onFeatured(post, next) : undefined} />
                {canEdit ? <CardMenu variant="chip" label={t('card.menu', { title: post.title })} items={menuFor(post)} /> : null}
              </>
            }
          >
            {post.categories.length ? <CategoryChips categories={post.categories} max={2} oneLine /> : null}
            <StatusPill status={post.status} badge={post.badge} oneLine />
            {post.languageStates.length ? <LanguageTicks states={post.languageStates} oneLine /> : null}
            {/* Always the same three rows, label left / value right, so they line up across cards. */}
            <dl className="mt-auto flex w-full flex-col gap-0.5 text-xs leading-5">
              {[
                { key: 'updated', label: t('columns.updated'), iso: post.updatedAt },
                {
                  key: 'published',
                  label: t(post.status === 'scheduled' ? 'columns.scheduled' : 'columns.published'),
                  iso: post.status === 'draft' ? null : post.publishedAt,
                },
                { key: 'ends', label: t('columns.ends'), iso: post.expiresAt },
              ].map((row) => (
                <div key={row.key} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="text-right text-foreground tabular-nums">
                    <LocalDate iso={row.iso} empty="—" />
                  </dd>
                </div>
              ))}
            </dl>
          </ContentCard>
        </CardGridItem>
      ))}
    </CardGrid>
  )
}

/**
 * Phone cards: square checkbox · thumbnail · title (2 lines), categories,
 * status, language ticks, date line · ⋯ with the star under it. The star is
 * display-only here (change it from ⋯ or the selection bar — no accidental
 * taps). Tapping the checkbox selects; tapping the card opens.
 */
export function PostPhoneList({ posts, canEdit, selected, onToggle, onOpen, menuFor }: CardProps) {
  const t = useTranslations('clientDashboard.posts')
  return (
    <ul className="flex flex-col gap-3">
      {posts.map((post) => {
        const isSel = selected.has(post._id)
        const body = (
          <>
            <Thumb src={post.thumb} className="size-14 rounded-lg" />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
              <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{post.title}</span>
              <CategoryChips categories={post.categories} max={2} />
              <StatusPill status={post.status} badge={post.badge} />
              <LanguageTicks states={post.languageStates} />
              <span className="text-sm leading-5 text-muted-foreground">
                <CardDateLine status={post.status} publishedAt={post.publishedAt} expiresAt={post.expiresAt} updatedAt={post.updatedAt} />
              </span>
            </span>
          </>
        )
        return (
          <li
            key={post._id}
            onClick={cardClick(post, onOpen)}
            className={`flex items-start gap-1 rounded-xl border bg-card py-2 pr-1 ${isSel ? 'border-action ring-1 ring-action' : 'border-border'} ${
              canEdit ? 'pl-1' : 'pl-3'
            }`}
          >
            {canEdit ? (
              <Checkbox
                checked={isSel}
                aria-label={t('select.checkbox', { title: post.title })}
                onChange={(checked, e) => onToggle(post._id, checked, isShiftChange(e))}
              />
            ) : null}
            {post.href ? (
              <Link href={post.href} className="flex min-w-0 flex-1 items-start gap-3 pt-3 pb-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {body}
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 items-start gap-3 pt-3 pb-1">{body}</div>
            )}
            <div className="flex shrink-0 flex-col items-end gap-1 pr-2.5">
              {canEdit ? (
                <span className="-mr-2.5">
                  <CardMenu label={t('card.menu', { title: post.title })} items={menuFor(post)} />
                </span>
              ) : (
                <span className="size-11" aria-hidden="true" />
              )}
              <FeaturedStar featured={post.featured} title={post.title} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

