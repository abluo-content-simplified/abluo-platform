'use client'

import { useTranslations } from 'next-intl'
import type { MessageThreadLabels } from '@/components/app/ui/MessageThread'
import type { ThreadEntry } from '@/lib/support-tickets/model'

/**
 * The words MessageThread needs for a Messages conversation (ADR-050), the
 * same on both dashboards (`app.messages.thread`). `supportName` gives an
 * Abluo message its author: "Tom · Abluo" (D4), just "Abluo" without a name.
 * `linkPlace` names a dashboard destination (the caller's nav labels).
 */
export function useMessageThreadLabels(linkPlace: (id: string) => string): { labels: MessageThreadLabels; supportName: (entry: Extract<ThreadEntry, { kind: 'message' }>) => string; formatEvent: () => null } {
  const t = useTranslations('app.messages.thread')
  const labels: MessageThreadLabels = {
    support: t('abluo'),
    redacted: t('redacted'),
    internalNote: t('redacted'),
    screenshotDeleted: t('imageDeleted'),
    fileDeleted: t('fileDeleted'),
    openScreenshot: (n) => t('openImage', { n }),
    openFile: (name) => t('downloadFile', { name }),
    removedPart: t('removedPart'),
    link: (id) => t('openLink', { place: linkPlace(id) }),
    linkPage: (page) => t('openPage', { page }),
    newTab: t('newTab'),
    viewer: {
      dialog: t('viewer.dialog'),
      close: t('viewer.close'),
      previous: t('viewer.previous'),
      next: t('viewer.next'),
      counter: (n, total) => t('viewer.counter', { n, total }),
    },
    thread: t('label'),
  }
  const supportName = (entry: Extract<ThreadEntry, { kind: 'message' }>) => (entry.author.name ? t('fromAbluo', { name: entry.author.name }) : t('abluo'))
  return { labels, supportName, formatEvent: () => null }
}
