'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  defineSchema,
  EditorProvider,
  PortableTextEditable,
  useEditor,
  useEditorSelector,
  type EditorSelection,
  type PortableTextBlock,
  type RenderAnnotationFunction,
  type RenderBlockFunction,
  type RenderChildFunction,
  type RenderDecoratorFunction,
  type RenderStyleFunction,
  type SchemaDefinition,
} from '@portabletext/editor'
import { EventListenerPlugin } from '@portabletext/editor/plugins'
import * as selectors from '@portabletext/editor/selectors'
import { urlFor } from '@/lib/sanity/image'
import {
  hrefFromUserInput,
  SUPPORTED_DECORATORS,
  SUPPORTED_LISTS,
  SUPPORTED_STYLES,
  type BodyObject,
} from '@/lib/client/normalize-blocks'
import { autoOpensInNewTab, blankToStore } from '@/lib/links/link-target'

/**
 * Body editor for the dashboard — "Tell your story" (ADR-025 D6).
 *
 * Native Portable Text: what the writer types is stored as-is in
 * `post.body[locale]` (localizedPortableText), with no HTML conversion.
 * The toolbar is deliberately small: what a practice owner needs on a phone
 * (heading, bold, italic, lists, quote, link).
 *
 * Existing posts (wave 2): content the dashboard can't create — images and
 * other block objects, inline objects, unknown annotations, h1/h4 styles,
 * code/underline decorators — is added to this mount's schema from the
 * initial value so it loads untouched. Block and inline objects render as
 * read-only chips ("edit in Studio") that can be moved or deleted but never
 * created; unknown styles render like the nearest heading.
 *
 * Emits the full value on every change; the autosave engine (S2) debounces it.
 * `initialValue` is read on mount only — remount with a new `key` to replace it.
 */
export const bodySchema = defineSchema({
  decorators: [{ name: 'strong' }, { name: 'em' }],
  styles: [{ name: 'normal' }, { name: 'h2' }, { name: 'h3' }, { name: 'blockquote' }],
  lists: [{ name: 'bullet' }, { name: 'number' }],
  annotations: [
    {
      name: 'link',
      fields: [
        { name: 'href', type: 'string' },
        { name: 'internal', type: 'object' },
        { name: 'blank', type: 'boolean' },
      ],
    },
  ],
  inlineObjects: [],
  blockObjects: [],
})

/** The base schema plus whatever unsupported-but-existing types the value uses. */
export function schemaForValue(value?: PortableTextBlock[]): SchemaDefinition {
  const styles = new Set<string>()
  const lists = new Set<string>()
  const decorators = new Set<string>()
  const annotations = new Set<string>()
  const inlineObjects = new Set<string>()
  const blockObjects = new Set<string>()
  for (const raw of Array.isArray(value) ? value : []) {
    const b = raw as Record<string, unknown>
    if (!b || typeof b._type !== 'string') continue
    if (b._type !== 'block') {
      blockObjects.add(b._type)
      continue
    }
    if (typeof b.style === 'string') styles.add(b.style)
    if (typeof b.listItem === 'string') lists.add(b.listItem)
    const defKeys = new Set<string>()
    for (const d of Array.isArray(b.markDefs) ? (b.markDefs as Record<string, unknown>[]) : []) {
      if (typeof d?._key === 'string') defKeys.add(d._key)
      if (typeof d?._type === 'string' && d._type !== 'link') annotations.add(d._type)
    }
    for (const c of Array.isArray(b.children) ? (b.children as Record<string, unknown>[]) : []) {
      if (c?._type === 'span') {
        for (const m of Array.isArray(c.marks) ? c.marks : []) if (typeof m === 'string' && !defKeys.has(m)) decorators.add(m)
      } else if (typeof c?._type === 'string') inlineObjects.add(c._type)
    }
  }
  const extra = (found: Set<string>, base: readonly string[]) => [...found].filter((n) => !base.includes(n)).map((name) => ({ name }))
  return {
    decorators: [...bodySchema.decorators!, ...extra(decorators, SUPPORTED_DECORATORS)],
    styles: [...bodySchema.styles!, ...extra(styles, SUPPORTED_STYLES)],
    lists: [...bodySchema.lists!, ...extra(lists, SUPPORTED_LISTS)],
    annotations: [...bodySchema.annotations!, ...[...annotations].map((name) => ({ name }))],
    inlineObjects: [...inlineObjects].map((name) => ({ name })),
    blockObjects: [...blockObjects].map((name) => ({ name })),
  }
}

const renderStyle: RenderStyleFunction = (props) => {
  switch (props.value) {
    case 'h1':
    case 'h2':
      return <h2 className="mt-6 mb-2 text-2xl font-semibold tracking-tight">{props.children}</h2>
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return <h3 className="mt-5 mb-1 text-xl font-semibold">{props.children}</h3>
    case 'blockquote':
      return (
        <blockquote className="my-4 border-l-[3px] border-foreground/30 pl-4 text-lg italic leading-8 text-foreground/80">
          {props.children}
        </blockquote>
      )
    default:
      return <p className="my-3">{props.children}</p>
  }
}

const renderDecorator: RenderDecoratorFunction = (props) => {
  if (props.value === 'strong') return <strong className="font-semibold">{props.children}</strong>
  if (props.value === 'em') return <em>{props.children}</em>
  if (props.value === 'underline') return <span className="underline">{props.children}</span>
  if (props.value === 'strike-through') return <s>{props.children}</s>
  if (props.value === 'code') return <code className="rounded bg-muted px-1 font-mono text-[0.9em]">{props.children}</code>
  return <>{props.children}</>
}

const renderAnnotation: RenderAnnotationFunction = (props) =>
  props.schemaType.name === 'link' ? (
    (props.value as { internal?: unknown }).internal ? (
      // A link to a page of the site: a small page mark before the text.
      <span className="underline decoration-foreground/60 underline-offset-2">
        <span contentEditable={false} className="mr-0.5 inline-block align-[-2px] text-muted-foreground select-none">
          <PageIcon size={14} />
        </span>
        {props.children}
      </span>
    ) : (
      <span className="underline decoration-foreground/60 underline-offset-2" title={String((props.value as { href?: string }).href ?? '')}>
        {props.children}
      </span>
    )
  ) : (
    // An annotation only Studio can edit: keep it, hint at it quietly.
    <span className="underline decoration-dotted decoration-muted-foreground underline-offset-2">{props.children}</span>
  )

function ObjectIcon({ image }: { image: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={image ? 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01' : 'M4 4h16v16H4zM9 9h6v6H9z'} />
    </svg>
  )
}

/**
 * Read-only stand-in for content only Sanity Studio can edit (an image, an
 * embed, …). Shown in the editor (selectable: move / delete) and in previews.
 */
export function PreservedChip({ value, inline = false }: { value: BodyObject; inline?: boolean }) {
  const t = useTranslations('editor.body.preserved')
  const image = value._type === 'image'
  const asset = (value as { asset?: { _ref?: unknown } }).asset
  let thumb: string | undefined
  if (image && typeof asset?._ref === 'string' && asset._ref.startsWith('image-')) {
    try {
      thumb = urlFor({ asset: { _ref: asset._ref } }).width(96).height(96).fit('crop').auto('format').url()
    } catch {
      thumb = undefined
    }
  }
  const label = image ? t('image') : t('other', { type: value._type })
  if (inline) {
    return (
      <span contentEditable={false} className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 align-baseline text-sm text-muted-foreground">
        <ObjectIcon image={image} />
        {label}
      </span>
    )
  }
  return (
    <div
      contentEditable={false}
      className="my-3 flex min-h-11 items-center gap-3 rounded-xl border border-border-subtle bg-muted p-2 pr-3 text-[15px] select-none"
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny CDN thumbnail
        <img src={thumb} alt="" width={48} height={48} className="size-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground">
          <ObjectIcon image={image} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{label}</span>
        <span className="block text-sm text-muted-foreground">{t('hint')}</span>
      </span>
    </div>
  )
}

const renderBlock: RenderBlockFunction = (props) =>
  props.value._type === 'block' ? (
    props.children
  ) : (
    <div data-preserved={props.value._type} className={props.selected ? 'rounded-xl ring-2 ring-ring' : undefined}>
      <PreservedChip value={props.value as BodyObject} />
    </div>
  )

const renderChild: RenderChildFunction = (props) =>
  props.value._type === 'span' ? props.children : <PreservedChip value={props.value as BodyObject} inline />

function ToolButton({
  label,
  active,
  disabled,
  onPress,
  children,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep focus (and the phone keyboard) in the text while tapping a tool.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={`grid h-11 min-w-11 place-items-center rounded-md px-2 text-[15px] font-semibold transition-colors disabled:opacity-40 ${
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground enabled:hover:bg-hover enabled:hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

/** A page of the site a link can point at (from the link search). */
export type LinkTargetOption = { id: string; type: string; title: string; path: string }

/** What the editor needs to offer site-aware links. */
export type LinkTools = {
  /** The site's own hosts — decides the automatic new-tab setting. */
  siteHosts?: readonly string[]
  /** Searches the site's pages / posts by title; omit to offer web addresses only. */
  searchPages?: (query: string) => Promise<LinkTargetOption[] | null>
  /** Looks up the titles of pages already linked (to show them in the sheet). */
  describePages?: (ids: string[]) => Promise<LinkTargetOption[] | null>
}

type InternalRef = { _type: 'reference'; _ref: string; _weak?: boolean }
type LinkDraft = {
  selection: EditorSelection
  href: string
  internal?: InternalRef
  blank?: boolean
  at?: { block: string; def: string }
}

function PageIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4" />
    </svg>
  )
}

const optionClass =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[15px] text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function LinkSheet({ draft, links, onClose }: { draft: LinkDraft; links?: LinkTools; onClose: () => void }) {
  const t = useTranslations('editor.body.linkSheet')
  const editor = useEditor()
  const id = useId()
  const hosts = links?.siteHosts ?? []
  const canPickPage = !!links?.searchPages
  const [mode, setMode] = useState<'web' | 'page'>(draft.internal && canPickPage ? 'page' : 'web')
  const [value, setValue] = useState(draft.href)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [page, setPage] = useState<LinkTargetOption | null>(
    draft.internal ? { id: draft.internal._ref, type: 'page', title: '', path: '' } : null
  )
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LinkTargetOption[] | null>(null)
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'failed'>('idle')
  // The switch follows the automatic rule until the person flips it.
  const [newTabChoice, setNewTabChoice] = useState<boolean | undefined>(draft.blank)

  const webHref = hrefFromUserInput(value)
  const auto = mode === 'page' ? false : autoOpensInNewTab({ href: webHref ?? undefined }, hosts)
  const newTab = newTabChoice ?? auto

  // Title of an already-linked page.
  const linkedId = draft.internal?._ref
  useEffect(() => {
    if (!linkedId || !links?.describePages) return
    let live = true
    links.describePages([linkedId]).then(
      (found) => {
        const hit = found?.find((o) => o.id === linkedId)
        if (live && hit) setPage((p) => (p && p.id === linkedId ? hit : p))
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [linkedId, links])

  // Debounced search while choosing a page.
  useEffect(() => {
    if (mode !== 'page' || page || !links?.searchPages) return
    let live = true
    const timer = setTimeout(() => {
      setSearchState('loading')
      links.searchPages!(query.trim()).then(
        (found) => {
          if (!live) return
          setResults(found ?? [])
          setSearchState(found ? 'idle' : 'failed')
        },
        () => live && setSearchState('failed')
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [mode, page, query, links])

  const restore = () => {
    if (draft.selection) editor.send({ type: 'select', at: draft.selection })
    editor.send({ type: 'focus' })
  }
  const save = () => {
    let props: Record<string, unknown>
    if (mode === 'page') {
      if (!page) {
        setInvalid(t('pickPage'))
        return
      }
      props = { internal: { _type: 'reference', _ref: page.id, _weak: true }, href: undefined }
    } else {
      if (!webHref) {
        setInvalid(t('invalid'))
        return
      }
      props = { href: webHref, internal: undefined }
    }
    // `blank` is stored only when it differs from the automatic rule.
    props.blank = blankToStore(newTab, auto)
    restore()
    if (draft.at) {
      editor.send({ type: 'annotation.set', at: [{ _key: draft.at.block }, 'markDefs', { _key: draft.at.def }], props })
    } else {
      const value = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined))
      editor.send({ type: 'annotation.add', annotation: { name: 'link', value } })
    }
    onClose()
  }
  const remove = () => {
    restore()
    editor.send({ type: 'annotation.remove', annotation: { name: 'link' } })
    onClose()
  }
  const cancel = () => {
    restore()
    onClose()
  }

  const segment = (m: 'web' | 'page', label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => {
        setMode(m)
        setInvalid(null)
      }}
      className={`min-h-11 flex-1 rounded-md px-3 text-[15px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )

  return (
    <form
      className="flex flex-col gap-3 border-b border-border-subtle py-3"
      aria-label={draft.at ? t('editTitle') : t('addTitle')}
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
    >
      <p className="text-sm font-medium text-foreground">{draft.at ? t('editTitle') : t('addTitle')}</p>
      {canPickPage && (
        <div role="group" aria-label={t('modeLabel')} className="flex gap-1 rounded-lg bg-muted p-1">
          {segment('web', t('modeWeb'))}
          {segment('page', t('modePage'))}
        </div>
      )}

      {mode === 'web' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-href`} className="sr-only">
            {t('modeWeb')}
          </label>
          <input
            id={`${id}-href`}
            // Site-relative paths ("/contatti") are allowed, so not type="url".
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={value}
            placeholder={t('placeholder')}
            aria-invalid={!!invalid || undefined}
            aria-describedby={`${id}-help`}
            onChange={(e) => {
              setValue(e.target.value)
              setInvalid(null)
            }}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-[17px] text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-invalid:border-destructive"
          />
          <p id={`${id}-help`} className={`text-sm ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
            {invalid ?? t('help')}
          </p>
        </div>
      ) : page ? (
        <div className="flex min-h-11 items-center gap-3 rounded-lg border border-border-subtle bg-muted px-3 py-2">
          <span className="text-muted-foreground">
            <PageIcon size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium text-foreground">{page.title || t('pageFallback')}</span>
            {page.path !== '' || page.title ? (
              <span className="block truncate text-sm text-muted-foreground">/{page.path}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => {
              setPage(null)
              setInvalid(null)
            }}
            className="min-h-11 rounded-lg px-3 text-[15px] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('change')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-search`} className="sr-only">
            {t('searchLabel')}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            autoFocus
            value={query}
            maxLength={80}
            placeholder={t('searchPlaceholder')}
            aria-describedby={`${id}-search-status`}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-[17px] text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <p id={`${id}-search-status`} role="status" className={`text-sm ${invalid || searchState === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {invalid ??
              (searchState === 'loading'
                ? t('searching')
                : searchState === 'failed'
                  ? t('searchFailed')
                  : results && !results.length
                    ? t('noResults')
                    : '')}
          </p>
          {!!results?.length && (
            <ul className="max-h-60 overflow-y-auto" aria-label={t('searchLabel')}>
              {results.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className={optionClass}
                    onClick={() => {
                      setPage(o)
                      setInvalid(null)
                    }}
                  >
                    <span className="text-muted-foreground">
                      <PageIcon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{o.title}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {t(`types.${o.type in TYPE_KEYS ? o.type : 'page'}`)} · /{o.path}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex min-h-11 items-center gap-3">
        <span className="min-w-0 flex-1">
          <span id={`${id}-tab`} className="block text-[15px] text-foreground">
            {t('newTab')}
          </span>
          <span className="block text-sm text-muted-foreground">{newTabChoice === undefined ? t('newTabAuto') : t('newTabManual')}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={newTab}
          aria-labelledby={`${id}-tab`}
          onClick={() => setNewTabChoice(!newTab)}
          className="grid h-11 w-14 shrink-0 place-items-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors ${newTab ? 'bg-action' : 'bg-muted border border-border'}`}>
            <span className={`size-6 rounded-full bg-background shadow-sm transition-transform ${newTab ? 'translate-x-5' : ''}`} />
          </span>
        </button>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {draft.at && (
          <button
            type="button"
            onClick={remove}
            className="mr-auto min-h-11 rounded-lg px-3 text-[15px] font-medium text-destructive hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('remove')}
          </button>
        )}
        <button
          type="button"
          onClick={cancel}
          className="min-h-11 rounded-lg px-3 text-[15px] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-action px-4 text-[15px] font-medium text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {t('save')}
        </button>
      </div>
    </form>
  )
}

const TYPE_KEYS = { page: 1, post: 1, newsArticle: 1, event: 1 } as const

function Toolbar({ links }: { links?: LinkTools }) {
  const t = useTranslations('editor.body')
  const editor = useEditor()
  const isH2 = useEditorSelector(editor, selectors.isActiveStyle('h2'))
  const isQuote = useEditorSelector(editor, selectors.isActiveStyle('blockquote'))
  const isBold = useEditorSelector(editor, selectors.isActiveDecorator('strong'))
  const isItalic = useEditorSelector(editor, selectors.isActiveDecorator('em'))
  const isBullet = useEditorSelector(editor, selectors.isActiveListItem('bullet'))
  const isNumber = useEditorSelector(editor, selectors.isActiveListItem('number'))
  const isLink = useEditorSelector(editor, selectors.isActiveAnnotation('link'))
  const expanded = useEditorSelector(editor, selectors.isSelectionExpanded)
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)

  const send = (event: Parameters<typeof editor.send>[0]) => {
    editor.send(event)
    editor.send({ type: 'focus' })
  }
  const openLink = () => {
    const snapshot = editor.getSnapshot()
    const link = selectors.getActiveAnnotations(snapshot).find((a) => a._type === 'link') as
      | { _key: string; href?: unknown; internal?: { _ref?: unknown; _weak?: boolean }; blank?: unknown }
      | undefined
    const block = selectors.getFocusTextBlock(snapshot)
    setLinkDraft({
      selection: snapshot.context.selection,
      href: typeof link?.href === 'string' ? link.href : '',
      internal:
        typeof link?.internal?._ref === 'string' ? { _type: 'reference', _ref: link.internal._ref, _weak: link.internal._weak } : undefined,
      blank: typeof link?.blank === 'boolean' ? link.blank : undefined,
      at: link && block ? { block: block.node._key, def: link._key } : undefined,
    })
  }
  const icon = (d: string) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )

  return (
    <>
      {linkDraft && <LinkSheet draft={linkDraft} links={links} onClose={() => setLinkDraft(null)} />}
      <div role="toolbar" aria-label={t('toolbar')} className="flex items-center gap-0.5 overflow-x-auto">
        <ToolButton label={t('heading')} active={isH2} onPress={() => send({ type: 'style.toggle', style: 'h2' })}>H</ToolButton>
        <ToolButton label={t('bold')} active={isBold} onPress={() => send({ type: 'decorator.toggle', decorator: 'strong' })}>B</ToolButton>
        <ToolButton label={t('italic')} active={isItalic} onPress={() => send({ type: 'decorator.toggle', decorator: 'em' })}>
          <span className="font-medium italic">I</span>
        </ToolButton>
        <ToolButton label={isLink ? t('editLink') : t('link')} active={isLink} disabled={!isLink && !expanded} onPress={openLink}>
          {icon('M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7')}
        </ToolButton>
        <ToolButton label={t('bulletList')} active={isBullet} onPress={() => send({ type: 'list item.toggle', listItem: 'bullet' })}>
          {icon('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01')}
        </ToolButton>
        <ToolButton label={t('numberedList')} active={isNumber} onPress={() => send({ type: 'list item.toggle', listItem: 'number' })}>
          {icon('M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1')}
        </ToolButton>
        <ToolButton label={t('quote')} active={isQuote} onPress={() => send({ type: 'style.toggle', style: 'blockquote' })}>
          {icon('M3 21c3 0 7-1 7-8V5H3v7h4c0 4-2 5-4 5M14 21c3 0 7-1 7-8V5h-7v7h4c0 4-2 5-4 5')}
        </ToolButton>
      </div>
    </>
  )
}

export function BodyEditor({
  initialValue,
  onChange,
  placeholder,
  links,
}: {
  /** Read once on mount; to replace the content (e.g. an accepted AI version) remount with a new `key`. */
  initialValue?: PortableTextBlock[]
  onChange?: (value: PortableTextBlock[] | undefined) => void
  /** Overrides the default "Start writing…" hint. */
  placeholder?: string
  /** Site-aware links: own hosts (new-tab rule) and the "A page on your site" search. */
  links?: LinkTools
}) {
  const t = useTranslations('editor.body')
  const [focused, setFocused] = useState(false)
  // Fixed for this mount: the initial value decides which preserved types load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const schemaDefinition = useMemo(() => schemaForValue(initialValue), [])

  return (
    <EditorProvider initialConfig={{ schemaDefinition, initialValue }}>
      <EventListenerPlugin
        on={(event) => {
          if (event.type === 'mutation') onChange?.(event.value)
          if (event.type === 'focused') setFocused(true)
          if (event.type === 'blurred') setFocused(false)
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <PortableTextEditable
          aria-label={t('label')}
          className="abluo-body-editor min-h-[40vh] flex-1 text-[17px] leading-7 text-foreground outline-none"
          renderStyle={renderStyle}
          renderDecorator={renderDecorator}
          renderAnnotation={renderAnnotation}
          renderBlock={renderBlock}
          renderChild={renderChild}
          renderPlaceholder={() => <span className="text-muted-foreground">{placeholder ?? t('placeholder')}</span>}
        />
        {/* Sticky above the phone keyboard; the step's own footer stays below. */}
        <div
          data-focused={focused || undefined}
          className="sticky bottom-0 border-t border-border-subtle bg-background py-1 pb-[env(safe-area-inset-bottom)]"
        >
          <Toolbar links={links} />
        </div>
      </div>
    </EditorProvider>
  )
}
