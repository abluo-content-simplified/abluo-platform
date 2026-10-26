'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import { Field } from '@/components/app/ui/Field'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { ProgressBar } from '@/components/app/ui/ProgressBar'
import { RadioList } from '@/components/app/ui/RadioList'
import { TextInput } from '@/components/app/ui/TextInput'
import { LocalDate, Pill } from '@/components/app/ui/list/cells'
import {
  createAccessDocumentAction,
  renameAccessDocumentAction,
  setAccessDocumentArchivedAction,
  setAccessDocumentGroupsAction,
} from '@/app/[locale]/(client)/[tenant]/access/actions'
import type { AccessDocumentView, AccessGroupView, AccessSite } from '@/lib/access/dashboard'
import { errorText, GroupChecklist, groupNames, useFileSize, useLanguageName } from './access-bits'
import { RenameSheet } from './GroupsTab'
import { uploadProtectedPdf } from './upload'
import type { AccessRunner } from './AccessScreen'

/**
 * Protected documents (ADR-040 B2.4/B2.5): a PDF (one per language) behind a
 * stable link that only the chosen groups can open. Adding one is a single
 * sheet — name, file, who can open it — like adding any other content; the
 * file goes straight to private storage and the server checks it before the
 * link serves it.
 */
export function DocumentsTab({
  projectSlug,
  documents,
  groups,
  site,
  canManage,
  maxBytes,
  creating,
  onCreatingChange,
  onShowGroups,
  runner,
}: {
  projectSlug: string
  documents: AccessDocumentView[]
  groups: AccessGroupView[]
  site: AccessSite
  canManage: boolean
  maxBytes: number
  creating: boolean
  onCreatingChange: (open: boolean) => void
  onShowGroups: () => void
  runner: AccessRunner
}) {
  const t = useTranslations('clientDashboard.access')
  const lang = useLanguageName()
  const size = useFileSize()
  const [uploadFor, setUploadFor] = useState<AccessDocumentView | null>(null)
  const [groupsFor, setGroupsFor] = useState<AccessDocumentView | null>(null)
  const [renaming, setRenaming] = useState<AccessDocumentView | null>(null)
  const [archiving, setArchiving] = useState<AccessDocumentView | null>(null)
  const multilingual = site.locales.length > 1
  // A document removed before it ever had a PDF is gone from the list: nobody could
  // ever open it, so there is nothing to restore. (Archive-only in storage — never deleted.)
  const sorted = documents.filter((d) => !(d.archived && d.files.length === 0)).sort((a, b) => Number(a.archived) - Number(b.archived))
  const [removing, setRemoving] = useState<AccessDocumentView | null>(null)

  async function copyLink(d: AccessDocumentView) {
    if (!d.link) return runner.fail(t('documents.linkUnavailable'))
    try {
      await navigator.clipboard.writeText(d.link)
      runner.done(t('documents.linkCopied'))
    } catch {
      runner.fail(t('documents.linkCopyFailed'))
    }
  }

  const menuFor = (d: AccessDocumentView): CardMenuItem[] => {
    const items: CardMenuItem[] = []
    if (d.link && !d.archived && d.files.length > 0) items.push({ key: 'copy', label: t('documents.copyLink'), onSelect: () => void copyLink(d) })
    if (!canManage) return items
    if (d.archived) return [...items, { key: 'restore', label: t('documents.restore'), onSelect: () => void runner.run(() => setAccessDocumentArchivedAction({ projectSlug, documentId: d.id, archived: false }), t('documents.restored', { title: d.title })) }]
    return [
      ...items,
      { key: 'upload', label: d.files.length ? (multilingual ? t('documents.uploadPdf') : t('documents.replacePdf')) : t('documents.addPdf'), onSelect: () => setUploadFor(d) },
      { key: 'groups', label: t('documents.whoCanOpen'), onSelect: () => setGroupsFor(d) },
      { key: 'rename', label: t('documents.rename'), onSelect: () => setRenaming(d) },
      d.files.length === 0
        ? { key: 'remove', label: t('documents.remove'), onSelect: () => setRemoving(d), destructive: true, separated: true }
        : { key: 'archive', label: t('documents.archive'), onSelect: () => setArchiving(d), destructive: true, separated: true },
    ]
  }

  return (
    <div className="flex flex-col gap-4">
      {sorted.length === 0 ? (
        <EmptyState
          title={t('documents.emptyTitle')}
          body={t('documents.emptyBody')}
          action={canManage ? <Button variant="primary" onClick={() => onCreatingChange(true)}>{t('documents.new')}</Button> : undefined}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {sorted.map((d) => {
            const items = menuFor(d)
            const who = groupNames(groups, d.groupIds, (n) => t('groups.archivedName', { name: n }))
            const liveWho = groups.filter((g) => !g.archived && d.groupIds.includes(g.id))
            return (
              <Panel as="li" key={d.id} className="flex flex-col gap-3 md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <h3 className="truncate text-[1.0625rem] leading-6 font-semibold text-foreground">{d.title}</h3>
                    <span className="flex flex-wrap gap-1.5">
                      {d.archived ? (
                        <Pill tone="muted">{t('documents.archived')}</Pill>
                      ) : d.files.length === 0 ? (
                        <Pill tone="highlight">{t('documents.notAvailable')}</Pill>
                      ) : liveWho.length === 0 ? (
                        <Pill tone="highlight">{t('documents.nobody')}</Pill>
                      ) : null}
                    </span>
                  </div>
                  {items.length ? <CardMenu label={t('documents.actionsFor', { title: d.title })} items={items} /> : null}
                </div>
                <dl>
                  <FactRow label={t('documents.whoCanOpen')}>
                    {who.length ? who.join(', ') : <span className="text-muted-foreground">{t('documents.nobodyYet')}</span>}
                  </FactRow>
                  {site.locales.map((code) => {
                    const f = d.files.find((x) => x.locale === code)
                    if (!f && !multilingual) return <FactRow key={code} label={t('documents.file')}><span className="text-muted-foreground">{t('documents.noPdfYet')}</span></FactRow>
                    return (
                      <FactRow key={code} label={multilingual ? lang(code) : t('documents.file')}>
                        {f ? (
                          <>
                            {size(f.sizeBytes)} · <LocalDate iso={f.uploadedAt} />
                          </>
                        ) : (
                          <span className="text-muted-foreground">{t('documents.noPdfInLanguage')}</span>
                        )}
                      </FactRow>
                    )
                  })}
                </dl>
                {!d.archived && d.files.length === 0 ? (
                  <Notice
                    tone="info"
                    action={
                      canManage ? (
                        <span className="flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setUploadFor(d)}>{t('documents.addPdf')}</Button>
                          <Button variant="quiet" onClick={() => setRemoving(d)}>{t('documents.remove')}</Button>
                        </span>
                      ) : undefined
                    }
                  >
                    {t('documents.notAvailableBody')}
                  </Notice>
                ) : !d.archived && d.link ? (
                  <div>
                    <Button variant="secondary" onClick={() => void copyLink(d)}>{t('documents.copyLink')}</Button>
                  </div>
                ) : null}
              </Panel>
            )
          })}
        </ul>
      )}

      <DocumentSheet
        mode={creating ? { kind: 'new' } : uploadFor ? { kind: 'upload', document: uploadFor } : null}
        onClose={() => {
          onCreatingChange(false)
          setUploadFor(null)
        }}
        projectSlug={projectSlug}
        groups={groups}
        site={site}
        maxBytes={maxBytes}
        onShowGroups={() => {
          onCreatingChange(false)
          onShowGroups()
        }}
        onDone={(message) => {
          onCreatingChange(false)
          setUploadFor(null)
          runner.done(message)
        }}
      />
      <DocumentGroupsSheet
        document={groupsFor}
        groups={groups}
        onClose={() => setGroupsFor(null)}
        onSave={async (ids) => {
          const d = groupsFor!
          const ok = await runner.run(() => setAccessDocumentGroupsAction({ projectSlug, documentId: d.id, groupIds: ids }), t('documents.groupsSaved'))
          if (ok === true) setGroupsFor(null)
        }}
        busy={runner.busy}
      />
      <RenameSheet
        title={t('documents.renameTitle')}
        label={t('documents.title')}
        initial={renaming?.title ?? null}
        maxLength={80}
        onClose={() => setRenaming(null)}
        onSave={async (title) => {
          const d = renaming!
          const ok = await runner.run(() => renameAccessDocumentAction({ projectSlug, documentId: d.id, title }), t('documents.renamed'))
          if (ok === true) setRenaming(null)
          return ok === true
        }}
      />
      {canManage ? (
        <ConfirmDialog
          open={archiving !== null}
          title={t('documents.archiveConfirm.title', { title: archiving?.title ?? '' })}
          body={t('documents.archiveConfirm.body')}
          confirmLabel={t('documents.archive')}
          busy={runner.busy}
          onConfirm={() => {
            const d = archiving!
            setArchiving(null)
            void runner.run(() => setAccessDocumentArchivedAction({ projectSlug, documentId: d.id, archived: true }), t('documents.archivedToast', { title: d.title }))
          }}
          onCancel={() => setArchiving(null)}
        />
      ) : null}
      {canManage ? (
        <ConfirmDialog
          open={removing !== null}
          title={t('documents.removeConfirm.title', { title: removing?.title ?? '' })}
          body={t('documents.removeConfirm.body')}
          confirmLabel={t('documents.remove')}
          busy={runner.busy}
          onConfirm={() => {
            const d = removing!
            setRemoving(null)
            void runner.run(() => setAccessDocumentArchivedAction({ projectSlug, documentId: d.id, archived: true }), t('documents.removed', { title: d.title }))
          }}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </div>
  )
}

type SheetMode = { kind: 'new' } | { kind: 'upload'; document: AccessDocumentView }

/** New document (name + PDF + who can open it), or a PDF for an existing one. */
function DocumentSheet({
  mode,
  onClose,
  projectSlug,
  groups,
  site,
  maxBytes,
  onShowGroups,
  onDone,
}: {
  mode: SheetMode | null
  onClose: () => void
  projectSlug: string
  groups: AccessGroupView[]
  site: AccessSite
  maxBytes: number
  onShowGroups: () => void
  onDone: (message: string) => void
}) {
  const t = useTranslations('clientDashboard.access')
  const lang = useLanguageName()
  const size = useFileSize()
  const fileInput = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [locale, setLocale] = useState(site.defaultLocale)
  const [who, setWho] = useState<string[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A document created on an earlier attempt whose upload failed: retry the upload only.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const liveGroups = groups.filter((g) => !g.archived)
  const isNew = mode?.kind === 'new'
  const existing = mode?.kind === 'upload' ? mode.document : null
  const replacing = existing ? existing.files.some((f) => f.locale === locale) : false
  const busy = progress !== null

  useEffect(() => {
    if (!mode) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each opening starts fresh
    setTitle('')
    setFile(null)
    setWho(liveGroups.length === 1 ? [liveGroups[0].id] : [])
    setProgress(null)
    setError(null)
    setCreatedId(null)
    const missing = mode.kind === 'upload' ? site.locales.find((l) => !mode.document.files.some((f) => f.locale === l)) : undefined
    setLocale(missing ?? site.defaultLocale)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the sheet opens for something else
  }, [mode?.kind, existing?.id])

  async function submit() {
    if (busy) return
    setError(null)
    if (isNew && !title.trim()) return setError(t('errors.name_needed'))
    if (!file) return setError(t('documents.chooseFileFirst'))
    setProgress(0)
    try {
      let documentId = existing?.id ?? createdId
      if (!documentId) {
        const r = await createAccessDocumentAction({ projectSlug, title: title.trim(), groupIds: who })
        if (!r.ok) {
          setError(errorText(t, r.error))
          setProgress(null)
          return
        }
        documentId = r.documentId
        setCreatedId(documentId)
      }
      const up = await uploadProtectedPdf({ projectSlug, documentId, locale, file, maxBytes, onProgress: setProgress })
      if (!up.ok) {
        setError(errorText(t, up.problem))
        setProgress(null)
        return
      }
      onDone(isNew ? t('documents.added', { title: title.trim() }) : up.replaced ? t('documents.replaced') : t('documents.uploaded'))
    } catch {
      setError(t('errors.failed'))
      setProgress(null)
    }
  }

  const sheetTitle = isNew ? t('documents.newTitle') : existing ? t('documents.uploadTitle', { title: existing.title }) : ''
  return (
    <BottomSheet open={mode !== null} title={sheetTitle} onClose={busy ? () => undefined : onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {isNew ? (
          <Field label={t('documents.title')} hint={t('documents.titleHint')}>
            {(p) => <TextInput {...p} autoFocus value={title} maxLength={80} disabled={busy || createdId !== null} placeholder={t('documents.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
        ) : null}

        <div className="flex flex-col gap-2">
          <FieldLabel as="p">{t('documents.file')}</FieldLabel>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setError(null)
              e.target.value = ''
            }}
          />
          {file ? (
            <Panel tone="muted" padding="md" className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[0.9375rem] text-foreground">{file.name} · {size(file.size)}</span>
              <Button variant="quiet" disabled={busy} onClick={() => fileInput.current?.click()}>{t('documents.changeFile')}</Button>
            </Panel>
          ) : (
            <div>
              <Button variant="secondary" onClick={() => fileInput.current?.click()}>{t('documents.chooseFile')}</Button>
            </div>
          )}
          <span className="text-sm text-muted-foreground">{t('documents.fileHint', { max: size(maxBytes) })}</span>
        </div>

        {site.locales.length > 1 ? (
          <RadioList
            legend={t('documents.language')}
            name="access-document-language"
            value={locale}
            onChange={setLocale}
            options={site.locales.map((code) => ({
              value: code,
              label: lang(code),
              description: existing?.files.some((f) => f.locale === code) ? t('documents.languageHasPdf') : undefined,
              disabled: busy,
            }))}
          />
        ) : null}
        {replacing ? <Notice tone="info">{t('documents.replaceNote')}</Notice> : null}

        {isNew ? (
          liveGroups.length === 0 ? (
            <Notice tone="info" action={<Button variant="secondary" onClick={onShowGroups}>{t('documents.goToGroups')}</Button>}>
              {t('documents.noGroupsYet')}
            </Notice>
          ) : (
            <>
              <GroupChecklist legend={t('documents.whoCanOpen')} groups={groups} value={who} onChange={setWho} disabled={busy || createdId !== null} />
              {who.length === 0 ? <p className="text-sm text-muted-foreground">{t('documents.nobodyHint')}</p> : null}
            </>
          )
        ) : null}

        {progress !== null ? <ProgressBar value={progress} label={t('documents.uploading')} /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? t('documents.uploading') : isNew ? (createdId ? t('documents.tryAgain') : t('documents.add')) : replacing ? t('documents.replace') : t('documents.upload')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  )
}

function DocumentGroupsSheet({
  document,
  groups,
  onClose,
  onSave,
  busy,
}: {
  document: AccessDocumentView | null
  groups: AccessGroupView[]
  onClose: () => void
  onSave: (ids: string[]) => Promise<void>
  busy: boolean
}) {
  const t = useTranslations('clientDashboard.access')
  const [who, setWho] = useState<string[]>([])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start from the document's groups
    if (document) setWho(document.groupIds.filter((id) => groups.some((g) => g.id === id && !g.archived)))
  }, [document, groups])
  return (
    <BottomSheet open={document !== null} title={t('documents.whoCanOpenTitle', { title: document?.title ?? '' })} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void onSave(who)
        }}
      >
        <GroupChecklist legend={t('documents.whoCanOpen')} groups={groups} value={who} onChange={setWho} disabled={busy} />
        {who.length === 0 ? <Notice tone="info">{t('documents.nobodyWarning')}</Notice> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? t('saving') : t('save')}</Button>
        </div>
      </form>
    </BottomSheet>
  )
}
