'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import type { DigitalCardLinkValue, DigitalCardSnapshot } from '@/lib/api/digital-cards'
import { DIGITAL_CARD_LIMITS, DIGITAL_CARD_LINK_KINDS, DIGITAL_CARD_LINK_TARGET, cardLinkTargetFields, defaultNewLinkKind, type DigitalCardLinkKind } from '@/lib/modules/digital-cards/model'
import { formatDigitalCardsMessage, getDigitalCardsMessages, type DigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DragGrip, DropLine } from '@/components/app/ui/DragGrip'
import { Field } from '@/components/app/ui/Field'
import { Panel } from '@/components/app/ui/Panel'
import { Select } from '@/components/app/ui/Select'
import { DigitalCardPagePicker } from './DigitalCardPagePicker'
import { TextInput } from '@/components/app/ui/TextInput'
import { Pill } from '@/components/app/ui/list/cells'
import { usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { dropLink, linkDisplay, linkFallbackLabel, linkTargetIdOf, moveIndex } from './links-model'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9 ()./-]{6,}$/

export function linkKindLabel(m: DigitalCardsMessages, kind: DigitalCardLinkKind): string {
  const e = m.editor
  const labels: Record<DigitalCardLinkKind, string> = {
    url: e.kindUrl,
    page: e.kindPage,
    form: e.kindForm,
    booking: e.kindBooking,
    whatsapp: e.kindWhatsapp,
    phone: e.kindPhone,
    email: e.kindEmail,
    file: e.kindFile,
  }
  return labels[kind]
}

/** A web address as the server accepts it ('' while it is not one yet; https:// added to a bare domain). */
function urlForServer(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  const withScheme = /^https?:\/\//i.test(v) ? v : /^[^\s/]+\.[^\s/]+/.test(v) ? `https://${v}` : v
  try {
    const u = new URL(withScheme)
    return u.protocol === 'https:' || u.protocol === 'http:' ? withScheme : ''
  } catch {
    return ''
  }
}

/** Is the link's target filled in (the publish check)? */
export function linkComplete(l: DigitalCardLinkValue): boolean {
  switch (DIGITAL_CARD_LINK_TARGET[l.kind]) {
    case 'url':
      return Boolean(urlForServer(l.url))
    case 'page':
      return Boolean(l.page || (l.kind === 'page' && (l.internalPage || l.moduleId)))
    case 'file':
      return Boolean(l.file)
    case 'value':
      return l.kind === 'email' ? EMAIL_RE.test(l.value.trim()) : PHONE_RE.test(l.value.trim())
  }
}

/**
 * One line as the server stores it (spaces collapsed), within `max` UTF-16
 * units without splitting an emoji. The input's `maxLength` counts grapheme
 * clusters in Chrome, so an emoji-rich label can pass the browser yet be
 * longer for the server — which would refuse the WHOLE links list.
 */
function fitLine(value: string, max: number): string {
  const t = value.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  let out = ''
  for (const ch of t) {
    if (out.length + ch.length > max) break
    out += ch
  }
  return out.trimEnd()
}
const fitAll = (values: Record<string, string>, max: number): Record<string, string> => Object.fromEntries(Object.entries(values).map(([loc, v]) => [loc, fitLine(v, max)]))

/**
 * The links as the autosave sends them: a value still being typed that is not
 * valid yet goes as empty (a draft may hold an unfinished link), so one
 * keystroke never gets the whole list refused.
 */
export function linksPayload(links: readonly DigitalCardLinkValue[]): Array<Record<string, unknown>> {
  return links.map((l) => {
    const target = DIGITAL_CARD_LINK_TARGET[l.kind]
    const value = l.value.trim()
    const valueOk = l.kind === 'email' ? EMAIL_RE.test(value) : PHONE_RE.test(value)
    return {
      key: l.key,
      kind: l.kind,
      label: fitAll(l.label, DIGITAL_CARD_LIMITS.label),
      description: fitAll(l.description, DIGITAL_CARD_LIMITS.linkDescription),
      url: target === 'url' ? urlForServer(l.url) : '',
      page: target === 'page' ? l.page : null,
      // Amendment B — a page link may hold a built-in section or a module page instead.
      internalPage: l.kind === 'page' && !l.page ? (l.internalPage ?? null) : null,
      moduleId: l.kind === 'page' && !l.page && !l.internalPage ? (l.moduleId ?? null) : null,
      file: target === 'file' ? l.file : null,
      logo: l.logo,
      value: target === 'value' && valueOk ? value.slice(0, DIGITAL_CARD_LIMITS.value) : '',
      hidden: l.hidden,
      primary: l.primary,
    }
  })
}

/**
 * Changing a link's type: form / booking point at a PAGE, so a section, module
 * page or catalogue target chosen for a page link is cleared (Amendment B).
 */
export function kindPatch(l: DigitalCardLinkValue, kind: DigitalCardLinkKind, pages: DigitalCardSnapshot['pages']): Partial<DigitalCardLinkValue> {
  if (kind === 'page') return { kind }
  const isPage = l.page ? pages.some((p) => p.id === l.page && (p.group ?? 'pages') === 'pages') : false
  return { kind, internalPage: null, moduleId: null, ...(l.page && !isPage ? { page: null } : {}) }
}

function newKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  } catch {
    return Math.random().toString(36).slice(2, 14)
  }
}

/** A new link: "a page of this website" — or a web address when the site has no pages yet. */
export function newLink(key: string, sitePages: boolean): DigitalCardLinkValue {
  return { key, kind: defaultNewLinkKind(sitePages), label: {}, description: {}, url: '', page: null, file: null, logo: null, value: '', hidden: false, primary: false }
}

const H2 = 'text-[1.0625rem] leading-7 font-semibold text-foreground'

/**
 * Links (D8), round 4 (Tom 2026-11-09: "adding a link is confusing"). The
 * list shows every link as it will look on the card — its label (or the
 * label it gets when none is typed: the page's or file's title, else the
 * standard one, exactly as the website does), the one-liner, and a small
 * "type · target" line — with the ⋮⋮ grip to reorder (drag, or ArrowUp /
 * ArrowDown on the grip) and the ⋯ menu: Edit, Show / Hide, Primary Action,
 * Remove.
 *
 * Add link → the new link opens for editing in the order you fill it in:
 * Type (a page of this website first) → its target (page, address, number,
 * file) → Label (optional; the placeholder shows what the card shows when it
 * stays empty) → One-line description (optional). Labels and one-liners are
 * per language (the language switch above). Booking needs the Reservations
 * module; files come from the Media Library picker.
 */
export function DigitalCardLinks({
  projectSlug,
  links,
  onChange,
  onRemove,
  lang,
  defaultLocale,
  editable,
  pages,
  files,
  reservations,
}: {
  projectSlug: string
  links: DigitalCardLinkValue[]
  onChange: (next: DigitalCardLinkValue[]) => void
  /** Called after a link is removed (the editor offers Undo). */
  onRemove: (removed: DigitalCardLinkValue, index: number) => void
  lang: string
  defaultLocale: string
  editable: boolean
  pages: DigitalCardSnapshot['pages']
  files: DigitalCardSnapshot['files']
  reservations: boolean
}) {
  const m = getDigitalCardsMessages(useLocale())
  const e = m.editor
  const siteMessages = getDigitalCardSiteMessages(lang)
  const [pickingFor, setPickingFor] = useState<string | null>(null)
  const [pickingLogoFor, setPickingLogoFor] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [fileNames, setFileNames] = useState<Record<string, string>>({})
  /** Logos chosen in this session (asset id → image URL) until the next read of the card. */
  const [logoUrls, setLogoUrls] = useState<Record<string, string>>({})
  const kinds = DIGITAL_CARD_LINK_KINDS.filter((k) => k !== 'booking' || reservations || links.some((l) => l.kind === 'booking'))
  const targets = { pages, files: { ...files, ...Object.fromEntries(Object.entries(fileNames).map(([id, title]) => [id, { url: files[id]?.url ?? null, title }])) } as DigitalCardSnapshot['files'] }

  const update = (key: string, patch: Partial<DigitalCardLinkValue>) => {
    onChange(
      links.map((l) => {
        if (l.key === key) return { ...l, ...patch }
        // One Primary Action per card: choosing it here takes it off the others.
        if (patch.primary === true) return { ...l, primary: false }
        return l
      })
    )
  }
  const drag = usePointerDrag((key, over) => {
    const next = dropLink(links, key, over)
    if (next) onChange(next)
  })
  const add = () => {
    if (links.length >= DIGITAL_CARD_LIMITS.links) return
    const link = newLink(newKey(), pages.some((p) => (p.group ?? 'pages') === 'pages'))
    onChange([...links, link])
    setEditing(link.key)
  }

  return (
    <Panel as="section" aria-labelledby="card-links" className="space-y-4" id="card-links-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="card-links" className={H2}>
            {e.linksTitle}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">{e.linksHint}</p>
        </div>
        {editable ? (
          <Button onClick={add} disabled={links.length >= DIGITAL_CARD_LIMITS.links}>
            {e.addLink}
          </Button>
        ) : null}
      </div>
      {links.length === 0 ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{e.noLinks}</p> : null}
      <ol aria-label={e.linksTitle} className="flex flex-col gap-3">
        {links.map((l, i) => {
          const target = DIGITAL_CARD_LINK_TARGET[l.kind]
          const complete = linkComplete(l)
          const shown = linkDisplay(l, lang, defaultLocale, targets, siteMessages)
          const kindName = linkKindLabel(m, l.kind)
          const open = editing === l.key
          const menu: CardMenuItem[] = editable
            ? [
                { key: 'edit', label: open ? e.linkDone : e.linkEdit, onSelect: () => setEditing(open ? null : l.key) },
                { key: 'shown', label: l.hidden ? e.linkShow : e.linkHide, onSelect: () => update(l.key, { hidden: !l.hidden, ...(l.hidden ? {} : { primary: false }) }) },
                ...(l.hidden ? [] : [{ key: 'primary', label: l.primary ? e.linkRemovePrimary : e.linkMakePrimary, onSelect: () => update(l.key, { primary: !l.primary }) }]),
                {
                  key: 'remove',
                  label: e.removeLink,
                  destructive: true,
                  separated: true,
                  onSelect: () => {
                    if (open) setEditing(null)
                    onChange(links.filter((x) => x.key !== l.key))
                    onRemove(l, i)
                  },
                },
              ]
            : []
          // What the card shows when the label stays empty in this language.
          const labelPlaceholder = (lang !== defaultLocale && l.label[defaultLocale]?.trim()) || linkFallbackLabel(l, targets, siteMessages)
          const fileName = l.file ? targets.files[l.file]?.title ?? l.file : null
          return (
            <Panel as="li" key={l.key} padding="md" className={`relative space-y-3 ${drag.dragging === l.key ? 'opacity-50' : ''}`} {...drag.rowProps(l.key)}>
              <DropLine edge={drag.edge(l.key)} />
              <div className="flex items-start gap-2">
                {editable && links.length > 1 ? (
                  <DragGrip
                    label={formatDigitalCardsMessage(e.linkMove, { name: shown.label, position: i + 1, total: links.length })}
                    drag={drag.gripProps(l.key)}
                    onMove={(dir) => onChange(moveIndex(links, i, i + dir))}
                  />
                ) : null}
                <div className={`min-w-0 flex-1 space-y-0.5 ${editable && links.length > 1 ? 'pt-2' : ''}`}>
                  <p className={`text-[0.9375rem] leading-6 font-semibold break-words ${l.hidden ? 'text-muted-foreground' : 'text-foreground'}`}>{shown.label}</p>
                  {shown.description ? <p className="text-sm leading-5 break-words text-foreground">{shown.description}</p> : null}
                  <p className="text-sm leading-5 break-words text-muted-foreground">
                    {complete && shown.target ? formatDigitalCardsMessage(m.card.buttonTarget, { kind: kindName, target: shown.target }) : kindName}
                  </p>
                  <span className="flex flex-wrap items-start gap-1.5 pt-1 empty:hidden">
                    {l.primary && !l.hidden ? <Pill tone="success">{e.linkPrimaryNote}</Pill> : null}
                    {l.hidden ? <Pill tone="muted">{e.linkHiddenNote}</Pill> : null}
                    {!complete ? <Pill tone="warning">{e.linkIncomplete}</Pill> : null}
                  </span>
                </div>
                {editable && !open ? (
                  <Button variant="quiet" aria-label={formatDigitalCardsMessage(e.linkEditFor, { name: shown.label })} onClick={() => setEditing(l.key)}>
                    {e.linkEdit}
                  </Button>
                ) : null}
                {menu.length ? <CardMenu label={formatDigitalCardsMessage(e.linkActionsFor, { name: shown.label })} items={menu} /> : null}
              </div>
              {open && editable ? (
                <div className="space-y-3 border-t border-border-subtle pt-3">
                  <Field label={e.linkKind} hint={e.linkKindHint}>
                    {(p) => (
                      <Select {...p} value={l.kind} onChange={(ev) => update(l.key, kindPatch(l, ev.target.value as DigitalCardLinkKind, pages))}>
                        {kinds.map((k) => (
                          <option key={k} value={k}>
                            {linkKindLabel(m, k)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {target === 'page' ? (
                    <Field label={e.linkPage} hint={l.kind === 'form' ? e.linkFormHint : l.kind === 'booking' ? e.linkBookingHint : undefined}>
                      {(p) => (
                        <DigitalCardPagePicker
                          control={p}
                          value={linkTargetIdOf(l)}
                          options={pages}
                          pagesOnly={l.kind !== 'page'}
                          onChange={(id) => update(l.key, l.kind === 'page' ? cardLinkTargetFields(id) : { page: id, internalPage: null, moduleId: null })}
                          e={e}
                        />
                      )}
                    </Field>
                  ) : null}
                  {target === 'url' ? (
                    <Field label={e.linkUrl}>
                      {(p) => <TextInput {...p} type="url" inputMode="url" value={l.url} maxLength={2000} placeholder="https://" onChange={(ev) => update(l.key, { url: ev.target.value })} />}
                    </Field>
                  ) : null}
                  {target === 'value' ? (
                    <Field label={l.kind === 'email' ? e.linkEmail : l.kind === 'whatsapp' ? e.linkWhatsapp : e.linkPhone} hint={l.kind === 'email' ? undefined : e.linkNumberHint}>
                      {(p) => (
                        <TextInput
                          {...p}
                          type={l.kind === 'email' ? 'email' : 'tel'}
                          inputMode={l.kind === 'email' ? 'email' : 'tel'}
                          value={l.value}
                          maxLength={DIGITAL_CARD_LIMITS.value}
                          onChange={(ev) => update(l.key, { value: ev.target.value })}
                        />
                      )}
                    </Field>
                  ) : null}
                  {target === 'file' ? (
                    <div className="space-y-2">
                      <p className="text-[0.9375rem] font-medium text-foreground">{e.linkFile}</p>
                      <div className="flex flex-wrap items-start gap-3">
                        <p className="min-w-0 py-2.5 text-[0.9375rem] leading-6 break-all text-foreground">{fileName ?? <span className="text-muted-foreground">{e.noFile}</span>}</p>
                        <Button onClick={() => setPickingFor(l.key)}>{l.file ? e.changeFile : e.chooseFile}</Button>
                      </div>
                    </div>
                  ) : null}
                  <Field label={formatDigitalCardsMessage(e.linkLabel, { language: lang.toUpperCase() })} hint={formatDigitalCardsMessage(e.linkLabelDefaultHint, { label: labelPlaceholder })} hintBelow>
                    {(p) => (
                      <TextInput
                        {...p}
                        value={l.label[lang] ?? ''}
                        maxLength={DIGITAL_CARD_LIMITS.label}
                        placeholder={labelPlaceholder}
                        onChange={(ev) => update(l.key, { label: { ...l.label, [lang]: ev.target.value } })}
                      />
                    )}
                  </Field>
                  <Field label={formatDigitalCardsMessage(e.linkDescription, { language: lang.toUpperCase() })} hint={e.linkDescriptionHint}>
                    {(p) => (
                      <TextInput
                        {...p}
                        value={l.description[lang] ?? ''}
                        maxLength={DIGITAL_CARD_LIMITS.linkDescription}
                        placeholder={lang !== defaultLocale ? l.description[defaultLocale] || undefined : undefined}
                        onChange={(ev) => update(l.key, { description: { ...l.description, [lang]: ev.target.value } })}
                      />
                    )}
                  </Field>
                  <div className="space-y-2">
                    <p className="text-[0.9375rem] font-medium text-foreground">{e.linkLogo}</p>
                    <p className="text-sm leading-5 text-muted-foreground">{e.linkLogoHint}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      {l.logo && (logoUrls[l.logo] ?? files[l.logo]?.url) ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Media Library thumbnail, decorative
                        <img src={`${logoUrls[l.logo] ?? files[l.logo]?.url}?h=96&fit=max`} alt="" className="h-8 max-w-24 rounded-md bg-muted object-contain p-1" />
                      ) : null}
                      <Button onClick={() => setPickingLogoFor(l.key)}>{l.logo ? e.changeLogo : e.chooseLogo}</Button>
                      {l.logo ? <Button onClick={() => update(l.key, { logo: null })}>{e.removeLogo}</Button> : null}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={() => setEditing(null)}>{e.linkDone}</Button>
                  </div>
                </div>
              ) : null}
            </Panel>
          )
        })}
      </ol>
      {pickingFor ? (
        <MediaLibraryPicker
          projectSlug={projectSlug}
          scope="media"
          defaultLocale={defaultLocale}
          exclude={[]}
          room={1}
          onClose={() => setPickingFor(null)}
          onAdd={(photos) => {
            const photo = photos[0]
            const key = pickingFor
            setPickingFor(null)
            if (!photo || !key) return
            setFileNames((n) => ({ ...n, [photo.assetId]: photo.name || photo.alt[defaultLocale] || photo.assetId }))
            update(key, { file: photo.assetId })
          }}
        />
      ) : null}
      {pickingLogoFor ? (
        <MediaLibraryPicker
          projectSlug={projectSlug}
          scope="media"
          defaultLocale={defaultLocale}
          exclude={[]}
          room={1}
          onClose={() => setPickingLogoFor(null)}
          onAdd={(photos) => {
            const photo = photos[0]
            const key = pickingLogoFor
            setPickingLogoFor(null)
            if (!photo || !key) return
            setLogoUrls((n) => ({ ...n, [photo.assetId]: photo.url }))
            update(key, { logo: photo.assetId })
          }}
        />
      ) : null}
    </Panel>
  )
}
