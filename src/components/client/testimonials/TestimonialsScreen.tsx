'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import type { TestimonialListItem } from '@/lib/api/testimonials'
import type { TestimonialSubmission } from '@/lib/api/testimonial-submissions'
import { Tabs } from '@/components/app/ui/Tabs'
import { TestimonialsBrowser } from './TestimonialsBrowser'
import { TestimonialSubmissionsBrowser } from './TestimonialSubmissionsBrowser'

type Tab = 'testimonials' | 'submissions'

/**
 * The Testimonials area (ADR-048 D9): the list, and — for people who may see
 * who gave a testimonial (testimonials.private.read) — the Submissions tab
 * next to it. The tab is in the address (`?tab=submissions`), so a link or a
 * reload lands on the same one; the tabs sit under the page header of
 * whichever list is showing.
 */
export function TestimonialsScreen({
  projectSlug,
  testimonials,
  names,
  defaultLocale,
  languages,
  timeZone,
  canWrite,
  canDelete,
  submissions,
  submissionsLoadFailed,
  acceptSubmissions,
  initialTab,
  initialQuery,
}: {
  projectSlug: string
  testimonials: TestimonialListItem[]
  names: Record<string, string>
  defaultLocale: string
  languages: string[]
  timeZone: string | null
  canWrite: boolean
  canDelete: boolean
  /** null = the person may not see submissions (no tab), or they could not be read. */
  submissions: TestimonialSubmission[] | null
  submissionsLoadFailed: boolean
  acceptSubmissions: boolean
  initialTab: Tab
  initialQuery: string
}) {
  const t = useTranslations('clientDashboard.testimonials.tabs')
  const router = useRouter()
  const pathname = usePathname()
  const hasTabs = submissions !== null || submissionsLoadFailed
  const [tab, setTab] = useState<Tab>(hasTabs ? initialTab : 'testimonials')
  const newCount = (submissions ?? []).filter((s) => s.status === 'new' && !s.testimonial).length

  const choose = (next: string) => {
    const value = next === 'submissions' ? 'submissions' : 'testimonials'
    setTab(value)
    router.replace(value === 'submissions' ? `${pathname}?tab=submissions` : pathname, { scroll: false })
  }

  const tabs = hasTabs ? (
    <Tabs
      label={t('label')}
      value={tab}
      onChange={choose}
      items={[
        { id: 'testimonials', label: t('testimonials'), count: testimonials.filter((x) => x.status !== 'archived').length },
        { id: 'submissions', label: t('submissions'), count: newCount || undefined },
      ]}
    />
  ) : null

  return (
    <>
      {tab === 'submissions' && hasTabs ? (
        <TestimonialSubmissionsBrowser
          projectSlug={projectSlug}
          submissions={submissions}
          loadFailed={submissionsLoadFailed}
          acceptSubmissions={acceptSubmissions}
          timeZone={timeZone}
          canWrite={canWrite}
          belowHeader={tabs}
        />
      ) : (
        <TestimonialsBrowser
          projectSlug={projectSlug}
          testimonials={testimonials}
          names={names}
          defaultLocale={defaultLocale}
          languages={languages}
          timeZone={timeZone}
          canWrite={canWrite}
          canDelete={canDelete}
          initialQuery={initialQuery}
          belowHeader={tabs}
        />
      )}
    </>
  )
}
