'use client'

import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Field } from '@/components/app/ui/Field'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { ProgressBar } from '@/components/app/ui/ProgressBar'
import { RadioList } from '@/components/app/ui/RadioList'
import { TextInput } from '@/components/app/ui/TextInput'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import { Pill } from '@/components/app/ui/list/cells'
import { TermPicker } from '@/components/client/taxonomy/TermPicker'
import {
  createDocumentAction,
  removeDocumentLanguagesAction,
  setDocumentAccessAction,
  deleteDocumentsAction,
  setDocumentArchivedAction,
  updateDocumentAction,
} from '@/app/[locale]/(client)/[tenant]/document-library/actions'
import type { DocumentsDashboardData, DocumentView } from '@/lib/access/documents-dashboard'
import { whyNotFit, type DownloadPage } from '@/lib/access/download-pages'
import { GroupChecklist, useFileSize, useLanguageName } from '@/components/client/access/access-bits'
import { documentErrorText } from './document-bits'
import { fileType, uploadDocumentFile, UPLOAD_TYPES } from './upload'

type Ready = Extract<DocumentsDashboardData, { notReady: false }>
type FileMode = 'one' | 'each'

const ACCEPT = 'application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp'

/**
 * Add or edit one document (ADR-040 §15, R9), in the order Tom set: title,
 * languages, file(s), short note, who can open it, category, tags, and the
 * pages it shows on ("Show on"). Categories and tags are the shared
 * Categories & Tags picker (module `documents`): new ones can be added on the
 * spot by people who may manage them. A document is saved first, then its file(s) are uploaded
 * straight to private storage and checked by the server.
 *
 * Pages that don't fit the document (a members-only document on a public
 * page, or a page for other groups) are shown greyed out with the reason;
 * the server refuses them too.
 */
export function DocumentEditor({
  projectSlug,
  data,
  document,
  canManage,
  canDelete = false,
  supportVisit = false,
}: {
  projectSlug: string
  data: Ready
  document: DocumentView | null
  canManage: boolean
  /** May delete an archived document for good (Owner; the server re-checks). */
  canDelete?: boolean
  supportVisit?: boolean
}) {
  const t = useTranslations('clientDashboard.documents')
  const router = useRouter()
  const lang = useLanguageName()
  const size = useFileSize()
  const d = data.site.defaultLocale
  const siteLocales = data.site.locales
  const isNew = document === null
  const readOnly = !canManage || Boolean(document?.archived)

  const existingLocales = document?.files.map((f) => f.locale) ?? []
  const [title, setTitle] = useState(document?.titles[d] ?? document?.title ?? '')
  const [note, setNote] = useState(document?.note?.[d] ?? '')
  const [locales, setLocales] = useState<string[]>(isNew ? siteLocales : existingLocales.length ? existingLocales : [d])
  const [mode, setMode] = useState<FileMode>(isNew || !document || document.files.length <= 1 || document.sharedFile ? 'one' : 'each')
  const [sharedFile, setSharedFile] = useState<File | null>(null)
  const [eachFile, setEachFile] = useState<Record<string, File | null>>({})
  const [visibility, setVisibility] = useState<'everyone' | 'groups'>(document?.visibility ?? 'everyone')
  const [groupIds, setGroupIds] = useState<string[]>(document?.groupIds ?? [])
  const [pageIds, setPageIds] = useState<string[]>(document?.pageIds ?? [])
  const [categoryKey, setCategoryKey] = useState<string | null>(document?.categoryKey ?? null)
  const [tagKeys, setTagKeys] = useState<string[]>(document?.tagKeys ?? [])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileFor = useRef<string | null>(null)

  const liveGroups = data.groups.filter((g) => !g.archived)
  const docAccess = { visibility, groupIds }
  const fit = (p: DownloadPage) => whyNotFit(docAccess, p)
  const shownOn = pageIds.filter((id) => data.pages.some((p) => p.id === id && fit(p) === null))
  const pageName = (p: DownloadPage) => (p.isHome ? t('homePage') : p.title)
  const groupName = useMemo(() => new Map(data.groups.map((g) => [g.id.toLowerCase(), g.name])), [data.groups])
  const added = locales.filter((l) => !existingLocales.includes(l))
  const removed = existingLocales.filter((l) => !locales.includes(l))

  function pick(target: string) {
    fileFor.current = target
    fileInput.current?.click()
  }
  function onPicked(file: File | null) {
    setError(null)
    if (!file) return
    if (!fileType(file)) return setError(t('errors.file_type'))
    const type = fileType(file)!
    if (file.size > UPLOAD_TYPES[type].maxBytes) return setError(t('errors.file_too_large'))
    if (fileFor.current === '*') setSharedFile(file)
    else if (fileFor.current) setEachFile((m) => ({ ...m, [fileFor.current!]: file }))
  }

  function validate(): string | null {
    if (!title.trim()) return t('errors.title_needed')
    if (locales.length === 0) return t('errors.locales_needed')
    if (visibility === 'groups' && groupIds.filter((g) => liveGroups.some((x) => x.id === g)).length === 0) return t('errors.groups_needed')
    if (mode === 'one') {
      if ((isNew || added.length > 0) && !sharedFile && !(document?.sharedFile && added.length === 0)) return t('errors.chooseFile')
    } else {
      const missing = locales.find((l) => !eachFile[l] && !existingLocales.includes(l))
      if (missing) return t('errors.chooseFileFor', { language: lang(missing) })
    }
    return null
  }

  async function submit() {
    if (busy || readOnly) return
    setError(null)
    setSaved(null)
    const problem = validate()
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const liveChosen = visibility === 'groups' ? groupIds.filter((g) => liveGroups.some((x) => x.id === g)) : []
      let id = document?.id ?? createdId
      if (!id) {
        const r = await createDocumentAction({ projectSlug, title: title.trim(), note: note.trim(), visibility, groupIds: liveChosen, pageIds: shownOn, categoryKey, tagKeys })
        if (!r.ok) return setError(documentErrorText(t, r.error))
        id = r.documentId
        setCreatedId(id)
      } else {
        const termsChanged = categoryKey !== (document?.categoryKey ?? null) || tagKeys.join() !== (document?.tagKeys ?? []).join()
        if (termsChanged || title.trim() !== (document?.titles[d] ?? '') || note.trim() !== (document?.note?.[d] ?? '')) {
          const r = await updateDocumentAction({ projectSlug, documentId: id, title: title.trim(), note: note.trim(), categoryKey, tagKeys })
          if (!r.ok) return setError(documentErrorText(t, r.error))
        }
        const accessChanged = visibility !== document?.visibility || liveChosen.sort().join() !== [...(document?.groupIds ?? [])].sort().join() || shownOn.sort().join() !== [...(document?.pageIds ?? [])].sort().join()
        if (accessChanged) {
          const r = await setDocumentAccessAction({ projectSlug, documentId: id, visibility, groupIds: liveChosen, pageIds: shownOn })
          if (!r.ok) return setError(documentErrorText(t, r.error))
        }
      }
      // Files: one upload per stored file; the same file can serve several languages.
      const uploads: Array<{ locales: string[]; file: File }> = []
      if (mode === 'one' && sharedFile) uploads.push({ locales, file: sharedFile })
      if (mode === 'each') for (const l of locales) if (eachFile[l]) uploads.push({ locales: [l], file: eachFile[l]! })
      for (const [n, u] of uploads.entries()) {
        setProgress(0)
        const up = await uploadDocumentFile({ projectSlug, documentId: id, locales: u.locales, file: u.file, onProgress: (f) => setProgress((n + f) / uploads.length) })
        if (!up.ok) {
          setProgress(null)
          return setError(documentErrorText(t, up.problem))
        }
      }
      setProgress(null)
      if (!isNew && removed.length > 0) {
        const r = await removeDocumentLanguagesAction({ projectSlug, documentId: id, locales: removed })
        if (!r.ok) return setError(documentErrorText(t, r.error))
      }
      setSharedFile(null)
      setEachFile({})
      const where = shownOn.map((pid) => data.pages.find((p) => p.id === pid)).filter((p): p is DownloadPage => Boolean(p)).map(pageName)
      setSaved(isNew
        ? (where.length ? t('addedOn', { title: title.trim(), pages: where.join(', ') }) : t('addedNowhere', { title: title.trim() }))
        : t('saved'))
      if (isNew) router.replace(`/${projectSlug}/document-library/${id}`)
      router.refresh()
    } catch {
      setError(t('errors.failed'))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function setArchived(archived: boolean) {
    if (!document) return
    setBusy(true)
    try {
      const r = await setDocumentArchivedAction({ projectSlug, documentId: document.id, archived })
      if (!r.ok) return setError(documentErrorText(t, r.error))
      setSaved(archived ? t('archivedNotice', { title: document.title }) : t('restoredNotice', { title: document.title }))
      router.refresh()
    } catch {
      setError(t('errors.failed'))
    } finally {
      setBusy(false)
      setArchiveOpen(false)
    }
  }

  async function deleteForGood() {
    if (!document) return
    setBusy(true)
    setDeleteError(null)
    try {
      const r = await deleteDocumentsAction({ projectSlug, documentIds: [document.id] })
      if (!r.ok) return setDeleteError(documentErrorText(t, r.error))
      setDeleteOpen(false)
      router.replace(`/${projectSlug}/document-library`)
      router.refresh()
    } catch {
      setDeleteError(t('errors.failed'))
    } finally {
      setBusy(false)
    }
  }

  const menu: CardMenuItem[] = []
  if (document?.link) {
    menu.push({
      key: 'copy',
      label: t('copyLink'),
      onSelect: () => {
        void navigator.clipboard?.writeText(document.link!).then(() => setSaved(t('linkCopied'))).catch(() => undefined)
      },
    })
  }
  if (document && canManage) {
    menu.push(document.archived
      ? { key: 'restore', label: t('restore'), onSelect: () => void setArchived(false) }
      : { key: 'archive', label: t('archive'), onSelect: () => setArchiveOpen(true), destructive: true, separated: menu.length > 0 })
  }
  // Delete for good: archived documents only (archive first), Owners only.
  if (document?.archived && canDelete) {
    menu.push({ key: 'delete', label: t('bulk.delete'), onSelect: () => { setDeleteError(null); setDeleteOpen(true) }, destructive: true, separated: true })
  }

  const fileRow = (target: string, chosen: File | null, current: DocumentView['files'][number] | undefined) => (
    <Panel tone="muted" padding="md" className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 text-[0.9375rem] break-words text-foreground">
        {chosen ? `${chosen.name} · ${size(chosen.size)}` : current ? t('currentFile', { name: current.originalFilename ?? t('file'), size: size(current.sizeBytes) }) : t('noFileChosen')}
      </span>
      {!readOnly ? <Button variant="quiet" disabled={busy} onClick={() => pick(target)}>{chosen || current ? t('replaceFile') : t('chooseFile')}</Button> : null}
    </Panel>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <BackLink href={`/${projectSlug}/document-library`} label={t('title')} />
        <PageHeader title={isNew ? t('newTitle') : document!.title} actions={menu.length ? <CardMenu label={t('menuFor', { title: document?.title ?? '' })} items={menu} /> : undefined} />
        {document?.archived ? <span><Pill tone="muted">{t('archived')}</Pill></span> : null}
      </div>
      {!canManage ? <Notice tone="info">{supportVisit ? t('supportReadOnly') : t('readOnly')}</Notice> : null}

      <form className="flex max-w-2xl flex-col gap-8" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => { onPicked(e.target.files?.[0] ?? null); e.target.value = '' }}
        />

        <Field label={t('fields.title')} hint={t('fields.titleHint')}>
          {(p) => <TextInput {...p} value={title} maxLength={data.limits.titleMax} disabled={readOnly || busy} onChange={(e) => setTitle(e.target.value)} />}
        </Field>

        {siteLocales.length > 1 ? (
          <fieldset className="flex flex-col gap-2">
            <FieldLabel as="legend" className="mb-1">{t('fields.languages')}</FieldLabel>
            <p className="text-sm text-muted-foreground">{t('fields.languagesHint')}</p>
            {readOnly ? (
              <p className="text-[0.9375rem] text-foreground">{locales.map(lang).join(', ')}</p>
            ) : (
              <div className="flex flex-wrap items-start gap-2">
                <ToggleChips
                  label={t('fields.languages')}
                  options={siteLocales.map((l) => ({ value: l, label: lang(l) }))}
                  value={locales}
                  onChange={(next) => setLocales(next)}
                />
                {locales.length < siteLocales.length ? (
                  <Button variant="quiet" disabled={busy} onClick={() => setLocales(siteLocales)}>{t('allLanguages')}</Button>
                ) : null}
              </div>
            )}
            {!isNew && removed.length > 0 ? <Notice tone="info">{t('languagesRemoved', { languages: removed.map(lang).join(', ') })}</Notice> : null}
          </fieldset>
        ) : null}

        <div className="flex flex-col gap-3">
          <FieldLabel as="p">{t('fields.file')}</FieldLabel>
          {locales.length > 1 ? (
            <RadioList
              legend={t('fields.fileMode')}
              name="document-file-mode"
              value={mode}
              onChange={(m) => setMode(m)}
              options={[
                { value: 'one', label: t('fileMode.one'), description: t('fileMode.oneHint'), disabled: readOnly || busy },
                { value: 'each', label: t('fileMode.each'), description: t('fileMode.eachHint'), disabled: readOnly || busy },
              ]}
            />
          ) : null}
          {mode === 'one' || locales.length <= 1 ? (
            fileRow('*', sharedFile, document?.sharedFile || (document?.files.length ?? 0) === 1 ? document?.files[0] : undefined)
          ) : (
            <div className="flex flex-col gap-3">
              {locales.map((l) => (
                <div key={l} className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-foreground">{t('fileFor', { language: lang(l) })}</span>
                  {fileRow(l, eachFile[l] ?? null, document?.files.find((f) => f.locale === l))}
                </div>
              ))}
            </div>
          )}
          <p className="text-sm text-muted-foreground">{t('fields.fileHint')}</p>
        </div>

        <Field label={t('fields.note')} hint={t('fields.noteHint')}>
          {(p) => <TextInput {...p} value={note} maxLength={data.limits.noteMax} disabled={readOnly || busy} onChange={(e) => setNote(e.target.value)} />}
        </Field>

        {data.groupsAvailable ? (
          <div className="flex flex-col gap-3">
            <RadioList
              legend={t('fields.who')}
              name="document-who"
              value={visibility}
              onChange={(v) => setVisibility(v)}
              options={[
                { value: 'everyone', label: t('everyone'), description: t('whoEveryoneHint'), disabled: readOnly || busy },
                { value: 'groups', label: t('membersOnly'), description: t('whoGroupsHint'), disabled: readOnly || busy || liveGroups.length === 0 },
              ]}
            />
            {visibility === 'groups' ? (
              liveGroups.length === 0 ? <Notice tone="info">{t('noGroupsYet')}</Notice> : (
                <GroupChecklist legend={t('fields.groups')} groups={data.groups} value={groupIds} onChange={setGroupIds} disabled={readOnly || busy} />
              )
            ) : null}
          </div>
        ) : null}

        {data.categories.length > 0 || categoryKey || (data.canAddTerms && !readOnly) ? (
          <div className="flex flex-col gap-2">
            <FieldLabel as="p">{t('fields.category')}</FieldLabel>
            <p className="text-sm text-muted-foreground">{t('fields.categoryHint')}</p>
            <TermPicker
              projectSlug={projectSlug}
              module="documents"
              kind="category"
              label={t('fields.category')}
              terms={data.categories}
              value={categoryKey ? [categoryKey] : []}
              // One category per document: choosing another replaces it; choosing it again clears it.
              onChange={(next) => setCategoryKey(next.find((k) => k !== categoryKey) ?? null)}
              defaultLocale={d}
              canAdd={data.canAddTerms && !readOnly}
              disabled={readOnly || busy}
            />
          </div>
        ) : null}

        {data.tags.length > 0 || tagKeys.length > 0 || (data.canAddTerms && !readOnly) ? (
          <div className="flex flex-col gap-2">
            <FieldLabel as="p">{t('fields.tags')}</FieldLabel>
            <p className="text-sm text-muted-foreground">{t('fields.tagsHint')}</p>
            <TermPicker
              projectSlug={projectSlug}
              module="documents"
              kind="tag"
              label={t('fields.tags')}
              terms={data.tags}
              value={tagKeys}
              onChange={(next) => setTagKeys(next.slice(0, 20))}
              defaultLocale={d}
              canAdd={data.canAddTerms && !readOnly}
              disabled={readOnly || busy}
            />
          </div>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <FieldLabel as="legend" className="mb-1">{t('fields.pages')}</FieldLabel>
          <p className="text-sm text-muted-foreground">{t('fields.pagesHint')}</p>
          {data.pages.length === 0 ? <Notice tone="info">{t('noPages.body')}</Notice> : data.pages.map((p) => {
            const why = fit(p)
            const groups = p.groupIds.map((g) => groupName.get(g) ?? t('unknownGroup')).join(', ')
            return (
              <CheckboxCard
                key={p.id}
                label={pageName(p)}
                description={why === 'public_page' ? t('whyPublicPage') : why === 'other_groups' ? t('whyOtherGroups') : p.restricted ? t('pageProtected', { groups: groups || t('noGroup') }) : t('pagePublic')}
                checked={why === null && pageIds.includes(p.id)}
                disabled={readOnly || busy || why !== null}
                onChange={(on) => setPageIds((cur) => (on ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
              />
            )
          })}
          <Notice tone={shownOn.length ? 'neutral' : 'info'}>
            {shownOn.length
              ? t('willAppearOn', { pages: shownOn.map((id) => data.pages.find((p) => p.id === id)).filter((p): p is DownloadPage => Boolean(p)).map(pageName).join(', ') })
              : t('notShownHint')}
          </Notice>
        </fieldset>

        {progress !== null ? <ProgressBar value={progress} label={t('uploading')} /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved ? <Notice tone="info" action={<ButtonLink variant="secondary" href={`/${projectSlug}/document-library`}>{t('backToList')}</ButtonLink>}>{saved}</Notice> : null}

        {!readOnly ? (
          <div className="flex flex-wrap justify-end gap-2">
            <ButtonLink variant="quiet" href={`/${projectSlug}/document-library`}>{t('cancel')}</ButtonLink>
            <Button variant="primary" type="submit" disabled={busy}>{busy ? (progress !== null ? t('uploading') : t('saving')) : isNew ? (createdId ? t('tryAgain') : t('create')) : t('save')}</Button>
          </div>
        ) : null}
      </form>

      {document && canManage ? (
        <ConfirmDialog
          open={archiveOpen}
          title={t('archiveConfirm.title', { title: document.title })}
          body={t('archiveConfirm.body')}
          confirmLabel={t('archive')}
          busy={busy}
          onConfirm={() => void setArchived(true)}
          onCancel={() => setArchiveOpen(false)}
        />
      ) : null}
      {document?.archived && canDelete ? (
        <ConfirmDialog
          open={deleteOpen}
          title={t('deleteConfirm.titleOne', { title: document.title })}
          body={t('deleteConfirm.body', { count: 1 })}
          confirmLabel={t('bulk.delete')}
          busy={busy}
          error={deleteError}
          onConfirm={() => void deleteForGood()}
          onCancel={() => setDeleteOpen(false)}
        />
      ) : null}
    </div>
  )
}
