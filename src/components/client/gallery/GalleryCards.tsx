'use client'

import type { MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Checkbox, isShiftChange } from '@/components/client/ui/Checkbox'
import { CardMenu, type CardMenuItem } from '@/components/client/ui/CardMenu'
import { CardGrid, CardGridItem, ContentCard } from '@/components/client/ui/list/ContentCard'
import { Chips, LocalDate } from '@/components/client/ui/list/cells'
import { ThumbStrip } from '@/components/client/ui/list/ThumbStrip'
import { GalleryStatePill, type GalleryRow } from './gallery-bits'

type CardProps = {
  rows: GalleryRow[]
  canWrite: boolean
  selected: Set<string>
  onToggle: (id: string, checked: boolean, shift: boolean) => void
  onOpen: (row: GalleryRow, newTab: boolean) => void
  menuFor: (row: GalleryRow) => CardMenuItem[]
}

/**
 * Desktop grid view (the default): the generic CardGrid / ContentCard
 * configured for galleries — the 16:10 media area shows a ThumbStrip (the
 * main image large, the next photos small, "+N"), then title (+ internal
 * name), status, photos · where used, tags and the two dates. Checkbox
 * top-left, ⋯ top-right.
 */
export function GalleryCardsGrid({ rows, canWrite, selected, onToggle, onOpen, menuFor }: CardProps) {
  const t = useTranslations('clientDashboard.gallery.list')
  const ts = useTranslations('clientDashboard.gallery.status')
  const tsel = useTranslations('clientDashboard.gallery.select')
  return (
    <CardGrid label={t('title')}>
      {rows.map((g) => (
        <CardGridItem key={g.id}>
          <ContentCard
            media={{ src: g.thumbs[0] ?? null }}
            mediaContent={<ThumbStrip srcs={g.thumbs} total={g.count} className="absolute inset-0 size-full" />}
            title={g.title}
            subtitle={g.internalName && g.internalName !== g.title ? g.internalName : null}
            href={g.href}
            onOpen={g.href ? (newTab) => onOpen(g, newTab) : undefined}
            selection={
              canWrite ? { checked: selected.has(g.id), onChange: (checked, shift) => onToggle(g.id, checked, shift), label: tsel('card', { title: g.title }) } : undefined
            }
            overlay={canWrite ? <CardMenu variant="chip" label={t('card.menu', { title: g.title })} items={menuFor(g)} /> : null}
          >
            <span className="flex">
              <GalleryStatePill state={g.state} />
            </span>
            <p className="text-sm leading-5 text-muted-foreground">
              {ts('photos', { count: g.count })}
              {' · '}
              <span className={g.places.length ? 'text-foreground' : undefined}>{g.places.length ? ts('shownOn', { places: g.places.join(' · ') }) : ts('notUsed')}</span>
            </p>
            {g.tags.length ? <Chips items={g.tags} max={3} oneLine /> : null}
            <dl className="mt-auto flex w-full flex-col gap-0.5 text-xs leading-5">
              {[
                { key: 'updated', label: t('columns.updated'), iso: g.updatedAt },
                { key: 'created', label: t('columns.created'), iso: g.createdAt },
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

/** A click on the card body opens the gallery; its own controls and links keep their click. */
function cardClick(g: GalleryRow, onOpen: CardProps['onOpen']) {
  return (e: MouseEvent<HTMLElement>) => {
    if (!g.href) return
    if ((e.target as HTMLElement).closest('a,button,input,label,[role="dialog"]')) return
    onOpen(g, e.metaKey || e.ctrlKey)
  }
}

/**
 * Phone cards (the Posts phone pattern): square checkbox · small ThumbStrip ·
 * title, status, photos · where used · ⋯. Tapping the checkbox selects;
 * tapping the card opens the gallery.
 */
export function GalleryPhoneList({ rows, canWrite, selected, onToggle, onOpen, menuFor }: CardProps) {
  const t = useTranslations('clientDashboard.gallery.list')
  const ts = useTranslations('clientDashboard.gallery.status')
  const tsel = useTranslations('clientDashboard.gallery.select')
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((g) => {
        const isSel = selected.has(g.id)
        const body = (
          <>
            <ThumbStrip srcs={g.thumbs} total={g.count} size={{ width: '7rem', height: '3.5rem' }} className="rounded-lg" />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
              <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{g.title}</span>
              <GalleryStatePill state={g.state} />
              <span className="text-sm leading-5 text-muted-foreground">
                {ts('photos', { count: g.count })} · {g.places.length ? ts('shownOn', { places: g.places.join(' · ') }) : ts('notUsed')}
              </span>
            </span>
          </>
        )
        return (
          <li
            key={g.id}
            onClick={cardClick(g, onOpen)}
            className={`flex items-start gap-1 rounded-xl border bg-card py-2 pr-1 ${isSel ? 'border-action ring-1 ring-action' : 'border-border'} ${canWrite ? 'pl-1' : 'pl-3'}`}
          >
            {canWrite ? (
              <Checkbox checked={isSel} aria-label={tsel('card', { title: g.title })} onChange={(checked, e) => onToggle(g.id, checked, isShiftChange(e))} />
            ) : null}
            {g.href ? (
              <Link href={g.href} className="flex min-w-0 flex-1 items-start gap-3 pt-3 pb-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {body}
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 items-start gap-3 pt-3 pb-1">{body}</div>
            )}
            {canWrite ? (
              <span className="shrink-0">
                <CardMenu label={t('card.menu', { title: g.title })} items={menuFor(g)} />
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
