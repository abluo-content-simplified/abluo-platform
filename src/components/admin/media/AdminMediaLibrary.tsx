'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { MediaLibraryScreen, type AnimationUpload } from '@/components/client/media/MediaLibraryScreen'
import { uploadAdminAnimationAction } from '@/app/[locale]/(admin)/media/actions'
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
 *
 * "Add animation" (ADR-046) files one Lottie animation into the chosen
 * project — admin only: no client screen offers it.
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

  const animations: AnimationUpload = {
    accept: '.lottie,.json',
    upload: async (file) => {
      if (!projectSlug) return { ok: false, error: 'failed' }
      const form = new FormData()
      form.set('projectSlug', projectSlug)
      form.set('file', file)
      const r = await uploadAdminAnimationAction(form)
      if (r.ok) return { ok: true }
      return { ok: false, error: r.error === 'unsupported_type' || r.error === 'too_large' ? r.error : 'failed' }
    },
    labels: {
      add: t('addAnimation'),
      disabledHint: t('chooseProjectToAddAnimation'),
      uploading: t('animationUploading'),
      added: t('animationAdded'),
      errors: { unsupported_type: t('animationUnsupported'), too_large: t('animationTooLarge'), failed: t('animationFailed') },
    },
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
      animations={animations}
    />
  )
}
