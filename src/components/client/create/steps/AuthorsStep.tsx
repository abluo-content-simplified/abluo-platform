'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { SitePerson, StepProps } from '@/components/client/create/types'
import { StepHeading } from '@/components/client/create/StepHeading'
import { PersonPickerField } from '@/components/client/persons/PersonPickerField'

/** Mirrors LIMITS.authors in post-drafts.ts (server code, not importable here); the server re-checks. */
const MAX_AUTHORS = 10

/**
 * "Who wrote this post?" (ADR-043 D5) — shown after the FAQ step on sites with
 * the People module. The authors in order (the first is the main author), chosen
 * from the site's People list, with "Add new person" in a sheet. Optional: a post
 * with no authors publishes exactly as before. Saved as `authors` (person ids) on
 * the post draft; the server checks every person belongs to this project.
 */
export function AuthorsStep({ draft, site, update, rememberPeople }: StepProps) {
  const t = useTranslations('clientDashboard.create.authors')
  const people = site.people
  // The objects the picker shows; names of people added here are kept for the session.
  const [known, setKnown] = useState<SitePerson[]>(people?.initial ?? [])
  if (!people) return null
  const byId = new Map(known.map((p) => [p.id, p]))
  const value = (draft.authors ?? []).map((id) => byId.get(id) ?? { id, name: t('unknownPerson') })

  return (
    <section aria-labelledby="authors-step-title">
      <StepHeading id="authors-step-title" title={t('title')} helper={t('helper')} />
      <div className="mt-8">
        <PersonPickerField
          projectSlug={site.projectSlug}
          label={t('label')}
          primaryLabel={t('primary')}
          max={MAX_AUTHORS}
          canCreate={people.canCreate}
          value={value}
          onChange={(next) => {
            setKnown((k) => [...next, ...k.filter((p) => !next.some((n) => n.id === p.id))])
            rememberPeople?.(next)
            update({ authors: next.map((p) => p.id) })
          }}
        />
      </div>
    </section>
  )
}
