'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Avatar } from './Avatar'
import { BottomSheet } from './BottomSheet'
import { Button, IconButton } from './Button'
import { Checkbox } from './Checkbox'
import { DragGrip, DropLine } from './DragGrip'
import { EmptyState } from './EmptyState'
import { Field } from './Field'
import { FilterSearch } from './FilterBar'
import { Notice } from './Notice'
import { Skeleton } from './Skeleton'
import { TextInput } from './TextInput'
import { Pill } from './list/cells'
import { dropIndex, usePointerDrag } from './use-pointer-drag'

/** One person as the picker shows and returns them. The caller maps its own data to this. */
export type PersonPickerPerson = {
  /** Stable id the caller uses (e.g. the Sanity document id). */
  id: string
  name: string
  photoUrl?: string | null
  /** Professional title, in the editor's language. */
  jobTitle?: string
  /** Group keys, shown by `groupLabel` when there is no job title. */
  groups?: string[]
  /** Archived people can still be listed (they stay on content that names them) and are marked. */
  archived?: boolean
}

/** Wording for the place the picker is used in; each part falls back to the generic "people" text. */
export type PersonPickerLabels = {
  /** Under the field when nobody is chosen ("No teacher yet"). */
  empty?: string
  /** The button that opens the sheet (multiple mode: "Add teacher"). */
  add?: string
  /** Title of the sheet ("Choose teachers"). */
  title?: string
}

export type PersonPickerProps = {
  /** Accessible name of the whole field ("Authors", "Hosts"). */
  label: string
  /** Context wording (empty text, add button, sheet title) for lists that are not "people" in general — teachers, hosts. */
  labels?: PersonPickerLabels
  /** multiple (default): an ordered list; single: exactly one or nobody. */
  mode?: 'multiple' | 'single'
  /** The chosen people, in order. The caller holds the objects, so the picker never needs a lookup. */
  value: PersonPickerPerson[]
  onChange: (next: PersonPickerPerson[]) => void
  /**
   * Looks people up for the sheet (empty query = the first people of the list). INJECTED by the caller —
   * the picker itself reaches no backend. Reject (throw) to show "Couldn't load people" with a retry.
   */
  search: (query: string) => Promise<PersonPickerPerson[]>
  /**
   * "Add new person": creates a person from a first and last name and returns them (INJECTED, like `search`).
   * Omit it and the button is not offered. Reject (throw) to show an error in the sheet.
   */
  onCreate?: (input: { firstName: string; lastName: string }) => Promise<PersonPickerPerson>
  /**
   * Before "Add new person" makes a duplicate: the people who already have this name (INJECTED, like `search`;
   * the caller decides what counts — the People service ignores case, accents and first/last order). Asked while
   * the name is typed and again on submit. Found ⇒ a notice offers "Use this person" or "Create anyway".
   * Reject (throw) to skip the check silently. Omit it and no check is made.
   */
  findDuplicates?: (input: { firstName: string; lastName: string }) => Promise<PersonPickerPerson[]>
  /** When given, the first person is the main one and is marked with this label ("Main author"). */
  primaryLabel?: string
  /** Most people allowed (multiple mode). */
  max?: number
  /** Maps a group key to its label (default: the key). */
  groupLabel?: (key: string) => string
  disabled?: boolean
  /** Why the field is disabled, shown under it. */
  disabledReason?: string
}

const NAME_MAX = 80

function subtitleOf(p: PersonPickerPerson, groupLabel: (key: string) => string): string {
  if (p.jobTitle?.trim()) return p.jobTitle.trim()
  return (p.groups ?? []).slice(0, 2).map(groupLabel).join(', ')
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return list
  const next = list.slice()
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/**
 * Chooses people from the site's People list (ADR-043 D8) — authors of a post,
 * hosts of an event, a team section's hand-picked people. Shared and backend-
 * free: the caller injects `search` and `onCreate`.
 *
 *   <PersonPicker label="Authors" primaryLabel="Main author" value={authors} onChange={setAuthors}
 *     search={(q) => searchPeople(q)} onCreate={(n) => createPerson(n)} />
 *
 * Multiple mode shows the chosen people as an ordered list (drag the grip, or
 * ArrowUp / ArrowDown on it; the first is the main one when `primaryLabel` is
 * given) with a remove button each, and "Add people" opens a sheet with search,
 * the photo or initials, name and job title or groups, and a checkbox per
 * person. Single mode shows one person with Change / Remove and picks in one
 * tap. "Add new person" in the sheet asks for first and last name only and
 * adds the new person without leaving the editor behind it.
 */
export function PersonPicker({ label, labels, mode = 'multiple', value, onChange, search, onCreate, findDuplicates, primaryLabel, max, groupLabel = (k) => k, disabled = false, disabledReason }: PersonPickerProps) {
  const t = useTranslations('app.ui.personPicker')
  const single = mode === 'single'
  const [open, setOpen] = useState(false)
  const full = !single && max !== undefined && value.length >= max
  const ids = value.map((p) => p.id)

  const drag = usePointerDrag((key, over) => {
    const to = dropIndex(ids, key, over)
    if (to !== null) onChange(moveItem(value, ids.indexOf(key), to))
  })

  const remove = (id: string) => onChange(value.filter((p) => p.id !== id))
  const canReorder = !single && !disabled && value.length > 1

  return (
    <div role="group" aria-label={label} className="space-y-3">
      {value.length === 0 ? (
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{labels?.empty ?? (single ? t('noneSingle') : t('none'))}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {value.map((p, n) => (
            <li
              key={p.id}
              {...drag.rowProps(p.id)}
              className={`relative flex items-start gap-1 rounded-xl border border-border bg-card p-2 ${drag.dragging === p.id ? 'opacity-50' : ''}`}
            >
              <DropLine edge={drag.edge(p.id)} />
              {canReorder ? (
                <DragGrip
                  label={t('drag', { name: p.name, position: n + 1, total: value.length })}
                  drag={drag.gripProps(p.id)}
                  onMove={(dir) => onChange(moveItem(value, n, n + dir))}
                />
              ) : null}
              <span className="flex min-w-0 flex-1 items-start gap-3 py-1 pl-1">
                <Avatar name={p.name} email="" src={p.photoUrl} size="md" muted={p.archived} />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <span className="line-clamp-2 text-[0.9375rem] leading-6 font-semibold text-foreground">{p.name}</span>
                  {subtitleOf(p, groupLabel) ? <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">{subtitleOf(p, groupLabel)}</span> : null}
                  <span className="flex flex-wrap items-start gap-1.5">
                    {primaryLabel && n === 0 && !single ? <Pill tone="highlight">{primaryLabel}</Pill> : null}
                    {p.archived ? <Pill tone="muted">{t('archived')}</Pill> : null}
                  </span>
                </span>
              </span>
              {disabled ? null : (
                <IconButton aria-label={t('remove', { name: p.name })} className="text-muted-foreground" onClick={() => remove(p.id)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {primaryLabel && canReorder ? <p className="text-sm leading-5 text-muted-foreground">{t('orderHint', { primary: primaryLabel })}</p> : null}

      <div className="flex flex-col items-start gap-1">
        <Button onClick={() => setOpen(true)} disabled={disabled || full} aria-describedby={disabled || full ? `${label}-why` : undefined}>
          {single ? (value.length ? t('change') : t('choose')) : (labels?.add ?? t('add'))}
        </Button>
        {disabled && disabledReason ? (
          <p id={`${label}-why`} className="text-sm leading-5 text-muted-foreground">
            {disabledReason}
          </p>
        ) : full ? (
          <p id={`${label}-why`} className="text-sm leading-5 text-muted-foreground">
            {t('full', { max: max ?? 0 })}
          </p>
        ) : null}
      </div>

      <PickerSheet
        open={open}
        onClose={() => setOpen(false)}
        single={single}
        value={value}
        onChange={onChange}
        search={search}
        onCreate={onCreate}
        findDuplicates={findDuplicates}
        max={max}
        groupLabel={groupLabel}
        title={labels?.title}
      />
    </div>
  )
}

function PickerSheet({
  open,
  onClose,
  single,
  value,
  onChange,
  search,
  onCreate,
  findDuplicates,
  max,
  groupLabel,
  title,
}: {
  open: boolean
  onClose: () => void
  single: boolean
  value: PersonPickerPerson[]
  onChange: (next: PersonPickerPerson[]) => void
  search: (query: string) => Promise<PersonPickerPerson[]>
  onCreate?: PersonPickerProps['onCreate']
  findDuplicates?: PersonPickerProps['findDuplicates']
  max?: number
  groupLabel: (key: string) => string
  title?: string
}) {
  const t = useTranslations('app.ui.personPicker')
  const [view, setView] = useState<'search' | 'create'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PersonPickerPerson[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const request = useRef(0)
  const chosen = new Set(value.map((p) => p.id))
  const room = max === undefined ? Infinity : max - value.length

  // A fresh sheet each time it opens.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
    setView('search')
    setQuery('')
  }, [open])

  // Search as the person types (a short pause), and once when the sheet opens.
  useEffect(() => {
    if (!open || view !== 'search') return
    const n = ++request.current
    const id = setTimeout(
      () => {
        setState('loading')
        search(query.trim())
          .then((r) => {
            if (n === request.current) {
              setResults(r)
              setState('ready')
            }
          })
          .catch(() => {
            if (n === request.current) setState('error')
          })
      },
      query ? 250 : 0
    )
    return () => clearTimeout(id)
  }, [open, view, query, attempt, search])

  const toggle = (p: PersonPickerPerson) => {
    if (single) {
      onChange([p])
      onClose()
      return
    }
    if (chosen.has(p.id)) onChange(value.filter((x) => x.id !== p.id))
    else if (room > 0) onChange([...value, p])
  }

  /** A person who now belongs in the field (just created, or an existing one found by the duplicate check). */
  const adopt = (person: PersonPickerPerson) => {
    if (single) {
      onChange([person])
      onClose()
    } else {
      if (room > 0 && !chosen.has(person.id)) onChange([...value, person])
      setView('search')
      setQuery('')
    }
  }

  return (
    <BottomSheet open={open} title={view === 'create' ? t('createTitle') : (title ?? t('title'))} onClose={onClose} size="lg">
      {view === 'create' && onCreate ? (
        <CreateForm
          initialName={query.trim()}
          onCancel={() => setView('search')}
          findDuplicates={findDuplicates}
          onUse={adopt}
          onCreate={async (input) => adopt(await onCreate(input))}
        />
      ) : (
        <div className="flex h-[min(80dvh,calc(100dvh-10rem))] flex-col gap-3">
          <FilterSearch sizing="w-full" label={t('search')} value={query} maxLength={80} placeholder={t('searchPlaceholder')} onChange={setQuery} />
          <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={state === 'loading' || undefined}>
            {state === 'error' ? (
              <Notice tone="error" action={<Button onClick={() => setAttempt((a) => a + 1)}>{t('retry')}</Button>}>
                {t('loadFailed')}
              </Notice>
            ) : state === 'loading' && results.length === 0 ? (
              <div className="space-y-2" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : results.length === 0 ? (
              <EmptyState titleAs="p" title={query ? t('noMatch', { query: query.trim() }) : t('empty')} />
            ) : (
              <ul className="flex flex-col gap-2">
                {results.map((p) => {
                  const picked = chosen.has(p.id)
                  const row = (
                    <>
                      <Avatar name={p.name} email="" src={p.photoUrl} size="md" muted={p.archived} />
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                        <span className="line-clamp-2 text-[0.9375rem] leading-6 font-semibold text-foreground">{p.name}</span>
                        {subtitleOf(p, groupLabel) ? <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">{subtitleOf(p, groupLabel)}</span> : null}
                        {p.archived ? <Pill tone="muted">{t('archived')}</Pill> : null}
                      </span>
                    </>
                  )
                  return (
                    <li key={p.id}>
                      {single ? (
                        <button
                          type="button"
                          onClick={() => toggle(p)}
                          aria-pressed={picked}
                          className={`flex w-full items-start gap-3 rounded-xl border p-3 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${picked ? 'border-action ring-1 ring-action' : 'border-border'}`}
                        >
                          {row}
                        </button>
                      ) : (
                        <label className={`flex cursor-pointer items-start gap-1 rounded-xl border py-1 pr-3 pl-1 hover:bg-hover ${picked ? 'border-action ring-1 ring-action' : 'border-border'}`}>
                          <Checkbox checked={picked} aria-label={t('select', { name: p.name })} disabled={!picked && room <= 0} onChange={() => toggle(p)} />
                          <span className="flex min-w-0 flex-1 items-start gap-3 pt-2.5 pb-2">{row}</span>
                        </label>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border-subtle pt-3">
            {onCreate ? (
              <Button onClick={() => setView('create')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t('addNew')}
              </Button>
            ) : (
              <span />
            )}
            {single ? null : (
              <div className="flex flex-col items-end gap-1">
                <Button variant="primary" onClick={onClose}>
                  {value.length ? t('done', { count: value.length }) : t('close')}
                </Button>
                {room <= 0 ? <p className="text-sm leading-5 text-muted-foreground">{t('full', { max: max ?? 0 })}</p> : null}
              </div>
            )}
          </div>
        </div>
      )}
    </BottomSheet>
  )
}

/** First and last name only — everything else is filled in later in People. */
function CreateForm({
  initialName,
  onCancel,
  onCreate,
  findDuplicates,
  onUse,
}: {
  initialName: string
  onCancel: () => void
  onCreate: (input: { firstName: string; lastName: string }) => Promise<void>
  findDuplicates?: PersonPickerProps['findDuplicates']
  onUse: (person: PersonPickerPerson) => void
}) {
  const t = useTranslations('app.ui.personPicker')
  // A typed "Anna Bianchi" is split at the last space as a starting point.
  const at = initialName.lastIndexOf(' ')
  const [first, setFirst] = useState(at > 0 ? initialName.slice(0, at) : initialName)
  const [last, setLast] = useState(at > 0 ? initialName.slice(at + 1) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = Boolean(first.trim())
  const [duplicates, setDuplicates] = useState<PersonPickerPerson[]>([])
  /** The name the person chose to create anyway: no notice for it again. */
  const [allowed, setAllowed] = useState('')
  const nameKey = `${first.trim()}|${last.trim()}`
  const latestDuplicates = useRef(0)

  // Look for the same name while it is typed (a short pause).
  useEffect(() => {
    if (!findDuplicates || !first.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to compare yet
      setDuplicates([])
      return
    }
    const n = ++latestDuplicates.current
    const id = setTimeout(() => {
      findDuplicates({ firstName: first.trim(), lastName: last.trim() })
        .then((r) => n === latestDuplicates.current && setDuplicates(r))
        .catch(() => n === latestDuplicates.current && setDuplicates([]))
    }, 400)
    return () => clearTimeout(id)
  }, [first, last, findDuplicates])

  async function submit(anyway = false) {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      if (findDuplicates && !anyway && allowed !== nameKey) {
        // The pause may not have elapsed yet: ask once more before making a duplicate.
        const found = await findDuplicates({ firstName: first.trim(), lastName: last.trim() }).catch(() => [] as PersonPickerPerson[])
        if (found.length) {
          setDuplicates(found)
          setBusy(false)
          return
        }
      }
      if (anyway) setAllowed(nameKey)
      await onCreate({ firstName: first.trim(), lastName: last.trim() })
    } catch {
      setError(t('createFailed'))
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('createIntro')}</p>
      <Field label={t('firstName')}>
        {(p) => <TextInput {...p} autoFocus autoComplete="off" value={first} maxLength={NAME_MAX} onChange={(e) => setFirst(e.target.value)} />}
      </Field>
      <Field label={t('lastName')} hint={ready ? undefined : t('namesNeeded')} error={error}>
        {(p) => <TextInput {...p} autoComplete="off" value={last} maxLength={NAME_MAX} onChange={(e) => setLast(e.target.value)} />}
      </Field>
      {ready && allowed !== nameKey && duplicates.length ? (
        <div className="space-y-2">
          {duplicates.slice(0, 3).map((d) => (
            <Notice key={d.id} tone="info" layout="row" action={<Button onClick={() => onUse(d)}>{t('useThis')}</Button>}>
              {t(d.archived ? 'duplicateArchived' : 'duplicate', { name: d.name })}
            </Notice>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="quiet" onClick={onCancel}>
          {t('back')}
        </Button>
        {ready && allowed !== nameKey && duplicates.length ? (
          <Button onClick={() => void submit(true)} disabled={busy}>
            {busy ? t('creating') : t('createAnyway')}
          </Button>
        ) : (
          <Button variant="primary" type="submit" disabled={!ready || busy}>
            {busy ? t('creating') : t('create')}
          </Button>
        )}
      </div>
    </form>
  )
}
