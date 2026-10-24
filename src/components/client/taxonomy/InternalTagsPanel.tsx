'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BarButton } from '@/components/app/ui/BarButton'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FieldError, FieldLabel } from '@/components/app/ui/FieldLabel'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { RadioList } from '@/components/app/ui/RadioList'
import { SelectionBar } from '@/components/app/ui/SelectionBar'
import { TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellText } from '@/components/app/ui/list/cells'
import { searchText } from '@/lib/client/search-text'
import { addInternalTagAction, changeInternalTagsAction, listInternalTagsAction } from '@/app/[locale]/(client)/[tenant]/taxonomy/internal-tags-actions'
import { InlineAdd } from './InlineAdd'
import {
  applyChangeToRows,
  countAffected,
  countTagsWithListed,
  findDuplicateTag,
  INTERNAL_TAG_LIMITS,
  normaliseInternalTag,
  renameCollision,
  rewriteListed,
  resolveTagSpelling,
  showTagSearch,
  sortTagCounts,
  TAG_SORTS,
  tagMatchKey,
  type InternalTagScope,
  type TagChange,
  type TagCount,
  type TagRow,
  type TagSort,
} from '@/lib/tags/internal-tags'

/**
 * Categories & Tags → Media / Galleries: the tags people put on photos or on
 * galleries to find them again. They are internal (never on the website), so
 * there are no colours, order or translations — just a list with how many
 * items use each tag, and Rename, Merge and Delete. Every change shows at
 * once and is carried out after a few seconds, so "Undo" simply cancels it
 * (useUndo); a failed save puts the list back and says so. "Add a tag" (the
 * same inline control as "Add category") adds one nothing uses yet: it shows
 * as "Not used yet"; a name that matches an existing tag ignoring case and
 * accents is refused with a message. Photos and
 * galleries have SEPARATE lists. The server re-checks every call.
 *
 * Order: A–Z (default, accent-insensitive, in the dashboard language) or Most
 * used, remembered per person and list (useViewPreference). The search box
 * shows only once a list has more than TAG_SEARCH_THRESHOLD (20) tags.
 */

type Dialog = { kind: 'rename'; tag: string } | { kind: 'merge'; tags: string[] } | null
const NEW_NAME = '__new__'

const ICON = (d: string) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const MERGE_ICON = ICON('M6 4v5a6 6 0 0 0 6 6h0a6 6 0 0 0 6-6V4M12 15v5')
const TRASH_ICON = ICON('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')
const CLEAR_ICON = ICON('M6 6l12 12M18 6L6 18')

export function InternalTagsPanel({ projectSlug, scope, canWrite }: { projectSlug: string; scope: InternalTagScope; canWrite: boolean }) {
  const t = useTranslations('clientDashboard.internalTags')
  const ts = useTranslations(scope === 'media' ? 'clientDashboard.internalTags.media' : 'clientDashboard.internalTags.galleries')
  const { toast, show, schedule } = useUndo()
  const locale = useLocale()
  // A–Z by default; the choice is remembered per person and per list.
  const [sort, setSort] = useViewPreference<TagSort>(`tags.${scope}.sort`, TAG_SORTS, 'az')

  const [rows, setRows] = useState<TagRow[]>([])
  const [listed, setListed] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<Dialog>(null)
  const [combine, setCombine] = useState<{ from: string; into: string } | null>(null)

  const load = useCallback(async () => {
    const r = await listInternalTagsAction({ projectSlug, scope })
    if (!r.ok) return setState((s) => (s === 'ready' ? s : 'error'))
    setRows(r.rows)
    setListed(r.listed ?? [])
    setState('ready')
  }, [projectSlug, scope])
  useEffect(() => {
    setState('loading')
    setSelected(new Set())
    setQuery('')
    setAdding(false)
    setAddText('')
    setAddError(null)
    void load()
  }, [load])

  const counts: TagCount[] = useMemo(() => countTagsWithListed(rows, listed), [rows, listed])
  // Search only once the list is long enough to need it.
  const searchable = showTagSearch(counts.length)
  const q = searchable ? tagMatchKey(searchText(query)) : ''
  const shown = useMemo(() => sortTagCounts(counts.filter((c) => !q || tagMatchKey(c.tag).includes(q)), sort, locale), [counts, q, sort, locale])
  const sortFilter: ListToolbarFilter = {
    key: 'sort',
    label: t('sort'),
    value: sort,
    options: [
      { value: 'az', label: t('sortAz') },
      { value: 'used', label: t('sortUsed') },
    ],
    onChange: (v) => setSort(v as TagSort),
  }
  const usedHref = (tag: string) => `/${projectSlug}/${scope === 'media' ? 'media' : 'galleries'}?tag=${encodeURIComponent(tag)}`

  // ── Changes ────────────────────────────────────────────────────────────────
  function run(change: TagChange, message: (n: number) => string) {
    const before = rows
    const listedBefore = listed
    const n = countAffected(before, change)
    setRows(applyChangeToRows(before, change))
    setListed(rewriteListed(listedBefore, change))
    setSelected(new Set())
    schedule({
      id: `tags-${Date.now()}`,
      message: message(n),
      undoLabel: t('undo'),
      failMessage: t('failed'),
      run: async () => {
        const r = await changeInternalTagsAction({ projectSlug, scope, change })
        if (!r.ok) void load()
        return r.ok
      },
      restore: () => {
        setRows(before)
        setListed(listedBefore)
      },
    })
  }
  const rename = (from: string, into: string) => run({ op: 'merge', from: [from], to: into }, (n) => ts('renamed', { count: n, tag: into }))
  const remove = (tags: string[]) => run({ op: 'delete', tags }, (n) => ts('deleted', { count: n, tags: tags.length }))

  // ── Add ────────────────────────────────────────────────────────────────────
  async function add() {
    const name = normaliseInternalTag(addText)
    if (!name) return setAddError(t('errors.nameRequired'))
    const same = findDuplicateTag(name, counts.map((c) => c.tag))
    if (same) return setAddError(t('errors.duplicate', { tag: same }))
    setAddBusy(true)
    setAddError(null)
    const r = await addInternalTagAction({ projectSlug, scope, name })
    setAddBusy(false)
    if (!r.ok) {
      if (r.error === 'duplicate') void load()
      return setAddError(t(r.error === 'duplicate' ? 'errors.duplicateServer' : r.error === 'too_many' ? 'errors.tooMany' : 'failed'))
    }
    setListed(r.listed)
    setAddText('')
    show({ message: t('added', { tag: r.tag }), tone: 'status' })
  }
  const cancelAdd = () => {
    setAdding(false)
    setAddText('')
    setAddError(null)
  }
  const addControl = canWrite ? (
    <InlineAdd
      id={`internal-tag-add-${scope}`}
      open={adding}
      onOpen={() => setAdding(true)}
      onCancel={cancelAdd}
      addLabel={t('add')}
      placeholder={t('addPlaceholder')}
      submitLabel={t('addSubmit')}
      busyLabel={t('adding')}
      cancelLabel={t('cancel')}
      value={addText}
      onValueChange={(v) => {
        setAddText(v)
        setAddError(null)
      }}
      busy={addBusy}
      error={addError}
      maxLength={INTERNAL_TAG_LIMITS.length}
      onSubmit={() => void add()}
    />
  ) : null

  // ── Rows ───────────────────────────────────────────────────────────────────
  const menuFor = (c: TagCount): CardMenuItem[] =>
    canWrite
      ? [
          { key: 'rename', label: t('rename'), onSelect: () => setDialog({ kind: 'rename', tag: c.tag }) },
          { key: 'delete', label: t('delete'), destructive: true, separated: true, onSelect: () => remove([c.tag]) },
        ]
      : []
  const usedBy = (c: TagCount) => (
    <Link href={usedHref(c.tag)} className="text-sm leading-6 text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {ts('usedBy', { count: c.count })}
    </Link>
  )
  const toggle = (tag: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(tag)
      else next.delete(tag)
      return next
    })
  const shownTags = shown.map((c) => c.tag)
  const allState: 'none' | 'some' | 'all' = shownTags.length && shownTags.every((x) => selected.has(x)) ? 'all' : shownTags.some((x) => selected.has(x)) ? 'some' : 'none'
  const selectedTags = counts.filter((c) => selected.has(c.tag)).map((c) => c.tag)

  const columns: DataTableColumn<TagCount>[] = [
    { key: 'name', header: t('columns.tag'), width: 'min-w-56', render: (c) => <CellText primary={c.tag} clamp={1} /> },
    { key: 'usedBy', header: t('columns.usedBy'), width: 'w-48', className: 'whitespace-nowrap', render: (c) => <span className="flex min-h-6 items-center">{usedBy(c)}</span> },
    ...(canWrite
      ? [{ key: 'menu', header: <span className="sr-only">{t('columns.actions')}</span>, width: 'w-14', render: (c: TagCount) => <CardMenu variant="cell" label={t('menu', { tag: c.tag })} items={menuFor(c)} /> }]
      : []),
  ]

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-[0.9375rem] leading-6 text-muted-foreground">{ts('note')}</p>
        {state === 'ready' && counts.length > 0 && !adding ? addControl : null}
      </div>
      {state === 'ready' && adding && counts.length > 0 ? addControl : null}
      {!canWrite ? <p className="text-sm text-muted-foreground">{t('readOnly')}</p> : null}

      {state === 'loading' ? (
        <p className="text-[0.9375rem] text-muted-foreground" role="status">
          {t('loading')}
        </p>
      ) : state === 'error' ? (
        <EmptyState titleAs="p" title={t('loadError')} action={<Button onClick={() => (setState('loading'), void load())}>{t('retry')}</Button>} />
      ) : counts.length === 0 ? (
        <EmptyState title={ts('emptyTitle')} body={ts('emptyBody')} action={addControl ?? undefined} />
      ) : (
        <>
          <ListToolbar
            label={ts('search')}
            search={searchable ? { value: query, onChange: setQuery, placeholder: ts('search'), label: ts('search') } : undefined}
            filters={[sortFilter]}
            summary={ts('count', { shown: shown.length, total: counts.length })}
            clear={{ label: t('clear'), onClear: () => setQuery(''), visible: Boolean(q) }}
            sheet={{ activeCount: 0, resultCount: shown.length, chips: [], onRemoveChip: () => undefined }}
          />
          {shown.length === 0 ? (
            <EmptyState titleAs="p" title={t('noMatch')} action={<Button onClick={() => setQuery('')}>{t('clear')}</Button>} />
          ) : (
            <>
              {/* Computers: a table. */}
              <div className="hidden md:block">
                <DataTable
                  label={ts('search')}
                  rows={shown}
                  columns={columns}
                  rowKey={(c) => c.tag}
                  minWidth="min-w-[36rem]"
                  selection={
                    canWrite
                      ? {
                          selected,
                          onToggle: (tag, on) => toggle(tag, on),
                          allState,
                          onToggleAll: (on) => setSelected(on ? new Set(shownTags) : new Set()),
                          rowLabel: (c) => t('select', { tag: c.tag }),
                          allLabel: t('selectAll'),
                        }
                      : undefined
                  }
                />
              </div>
              {/* Phones: rows. */}
              <ul className="flex flex-col gap-2 md:hidden" aria-label={ts('search')}>
                {shown.map((c) => (
                  <ListRow
                    key={c.tag}
                    label={canWrite ? t('rename') + ' ' + c.tag : undefined}
                    onOpen={canWrite ? () => setDialog({ kind: 'rename', tag: c.tag }) : undefined}
                    select={canWrite ? { checked: selected.has(c.tag), label: t('select', { tag: c.tag }), onChange: (on) => toggle(c.tag, on) } : undefined}
                    menu={canWrite ? { label: t('menu', { tag: c.tag }), items: menuFor(c) } : undefined}
                  >
                    <span className="block max-w-full truncate text-[0.9375rem] leading-6 font-semibold text-foreground">{c.tag}</span>
                    {usedBy(c)}
                  </ListRow>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {canWrite && selectedTags.length > 0 ? (
        <SelectionBar label={t('bar.label')} count={t('bar.count', { count: selectedTags.length })}>
          <BarButton disabled={selectedTags.length < 2} onPress={() => setDialog({ kind: 'merge', tags: selectedTags })} icon={MERGE_ICON}>
            {t('merge')}
          </BarButton>
          <BarButton destructive onPress={() => remove(selectedTags)} icon={TRASH_ICON}>
            {t('delete')}
          </BarButton>
          <BarButton onPress={() => setSelected(new Set())} icon={CLEAR_ICON}>
            {t('bar.clear')}
          </BarButton>
        </SelectionBar>
      ) : null}

      <RenameSheet
        open={dialog?.kind === 'rename'}
        tag={dialog?.kind === 'rename' ? dialog.tag : ''}
        onClose={() => setDialog(null)}
        onSave={(from, name) => {
          setDialog(null)
          const clash = renameCollision(counts, from, name)
          if (clash) setCombine({ from, into: clash })
          else if (normaliseInternalTag(name) !== from) rename(from, normaliseInternalTag(name))
        }}
      />
      <MergeSheet
        open={dialog?.kind === 'merge'}
        tags={dialog?.kind === 'merge' ? dialog.tags : []}
        counts={counts}
        onClose={() => setDialog(null)}
        onMerge={(from, into) => {
          setDialog(null)
          run({ op: 'merge', from, to: into }, (n) => ts('merged', { count: n, tag: into }))
        }}
      />
      <ConfirmDialog
        open={combine !== null}
        title={t('combine.title', { tag: combine?.into ?? '' })}
        body={t('combine.body', { from: combine?.from ?? '', tag: combine?.into ?? '' })}
        confirmLabel={t('combine.confirm')}
        onCancel={() => setCombine(null)}
        onConfirm={() => {
          if (combine) rename(combine.from, combine.into)
          setCombine(null)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </>
  )
}

// ── Rename ──────────────────────────────────────────────────────────────────

function RenameSheet({
  open,
  tag,
  onClose,
  onSave,
}: {
  open: boolean
  tag: string
  onClose: () => void
  onSave: (from: string, name: string) => void
}) {
  const t = useTranslations('clientDashboard.internalTags')
  return (
    <BottomSheet open={open} title={t('renameTitle')} onClose={onClose}>
      {/* Remounted per tag so the box starts with its name. */}
      <RenameForm key={tag} tag={tag} onSave={onSave} onClose={onClose} />
    </BottomSheet>
  )
}

function RenameForm({ tag, onSave, onClose }: { tag: string; onSave: (from: string, name: string) => void; onClose: () => void }) {
  const t = useTranslations('clientDashboard.internalTags')
  const [name, setName] = useState(tag)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    if (!normaliseInternalTag(name)) return setError(t('errors.nameRequired'))
    onSave(tag, name)
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div>
        <FieldLabel htmlFor="internal-tag-rename">{t('renameLabel')}</FieldLabel>
        <TextInput
          id="internal-tag-rename"
          flush
          controlSize="md"
          value={name}
          maxLength={INTERNAL_TAG_LIMITS.length}
          autoFocus
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          onChange={(e) => (setName(e.target.value), setError(null))}
        />
        <FieldError>{error}</FieldError>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button variant="primary" type="submit">
          {t('save')}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  )
}

// ── Merge ───────────────────────────────────────────────────────────────────

function MergeSheet({
  open,
  tags,
  counts,
  onClose,
  onMerge,
}: {
  open: boolean
  tags: string[]
  counts: readonly TagCount[]
  onClose: () => void
  onMerge: (from: string[], into: string) => void
}) {
  const t = useTranslations('clientDashboard.internalTags')
  return (
    <BottomSheet open={open} title={t('mergeTitle')} onClose={onClose}>
      <MergeForm key={tags.join('|')} tags={tags} counts={counts} onMerge={onMerge} onClose={onClose} />
    </BottomSheet>
  )
}

function MergeForm({ tags, counts, onMerge, onClose }: { tags: string[]; counts: readonly TagCount[]; onMerge: (from: string[], into: string) => void; onClose: () => void }) {
  const t = useTranslations('clientDashboard.internalTags')
  // The most used of the chosen tags is the natural one to keep.
  const first = counts.find((c) => tags.includes(c.tag))?.tag ?? tags[0] ?? ''
  const [keep, setKeep] = useState<string>(first)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    if (keep !== NEW_NAME) return onMerge(tags, keep)
    // A typed name that matches an existing tag (even outside the chosen ones) uses that spelling.
    const into = resolveTagSpelling(custom, counts.map((c) => c.tag))
    if (!into) return setError(t('errors.nameRequired'))
    onMerge(tags, into)
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Notice>{t('mergeBody', { count: tags.length })}</Notice>
      <RadioList
        legend={t('keepLabel')}
        name="internal-tag-keep"
        value={keep}
        onChange={setKeep}
        options={[
          ...tags.map((tag) => ({ value: tag, label: tag })),
          { value: NEW_NAME, label: t('keepNew') },
        ]}
      />
      {keep === NEW_NAME ? (
        <div>
          <FieldLabel htmlFor="internal-tag-merge-name">{t('renameLabel')}</FieldLabel>
          <TextInput
            id="internal-tag-merge-name"
            flush
            controlSize="md"
            value={custom}
            maxLength={INTERNAL_TAG_LIMITS.length}
            autoFocus
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            onChange={(e) => (setCustom(e.target.value), setError(null))}
          />
          <FieldError>{error}</FieldError>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button variant="primary" type="submit">
          {t('mergeConfirm')}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  )
}
