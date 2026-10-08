'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { MediaLibraryScreen } from '@/components/client/media/MediaLibraryScreen'
import type { ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { ADMIN_MEDIA_LINKS, adminMediaHref } from '@/lib/client/media-links'

/**
 * Admin Media (ADR-030 step 4): the client dashboard's Media Library screen,
 * driven by the admin's actions (`scope="admin"`), with a project picker first
 * in its toolbar. "All projects" lists every project's photos, each labelled
 * with its project; choosing one project enables "Add photos" (into that
 * project) and selecting for tags / rename. Unused photos can be deleted.
 * The project lives in the URL (`?project=`), so a view can be linked and the
 * server page re-reads the project's languages.
 */
export function AdminMediaLibrary({
  projects,
  projectSlug,
  site,
}: {
  projects: { slug: string; name: string }[]
  projectSlug: string | null
  site: { defaultLocale: string; locales: string[] }
}) {
  const t = useTranslations('admin.media')
  const router = useRouter()

  const picker: ListToolbarFilter = {
    key: 'project',
    label: t('project'),
    value: projectSlug ?? '',
    options: [{ value: '', label: t('allProjects') }, ...projects.map((p) => ({ value: p.slug, label: p.name }))],
    onChange: (slug) => router.replace(adminMediaHref(slug || null)),
  }

  return (
    <MediaLibraryScreen
      key={projectSlug ?? ''}
      projectSlug={projectSlug}
      site={site}
      scope="admin"
      links={ADMIN_MEDIA_LINKS}
      toolbarFilters={[picker]}
      projectLabel={t('project')}
      addDisabledHint={t('chooseProjectToAdd')}
      remove={{ label: t('delete'), deleted: t('deleted'), undo: t('undo'), failed: t('deleteFailed') }}
    />
  )
}
