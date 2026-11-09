'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import type { DigitalCardLinkValue, DigitalCardSnapshot } from '@/lib/api/digital-cards'
import { DIGITAL_CARD_LIMITS, DIGITAL_CARD_LINK_KINDS, DIGITAL_CARD_LINK_TARGET, defaultNewLinkKind, type DigitalCardLinkKind } from '@/lib/modules/digital-cards/model'
import { formatDigitalCardsMessage, getDigitalCardsMessages, type DigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { Field } from '@/components/app/ui/Field'
import { Panel } from '@/components/app/ui/Panel'
import { Select } from '@/components/app/ui/Select'
import { TextInput } from '@/components/app/ui/TextInput'
import { Pill } from '@/components/app/ui/list/cells'

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
      return Boolean(l.page)
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
      file: target === 'file' ? l.file : null,
      value: target === 'value' && valueOk ? value.slice(0, DIGITAL_CARD_LIMITS.value) : '',
      hidden: l.hidden,
      primary: l.primary,
    }
  })
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
  return { key, kind: defaultNewLinkKind(sitePages), label: {}, description: {}, url: '', page: null, file: null, value: '', hidden: false, primary: false }
}

const H2 = 'text-[1.0625rem] leading-7 font-semibold text-foreground'

/**
 * Links (D8): add, edit, reorder (⋯ Move up / Move down), show or hide, one
 * Primary Action. Labels are per language (the language switch above); left
 * empty, the website uses a standard label for the kind. Booking needs the
 * Reservations module; files come from the Media Library picker.
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
  const [pickingFor, setPickingFor] = useState<string | null>(null)
  const [fileNames, setFileNames] = useState<Record<string, string>>({})
  const kinds = DIGITAL_CARD_LINK_KINDS.filter((k) => k !== 'booking' || reservations || links.some((l) => l.kind === 'booking'))

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
  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir
    if (to < 0 || to >= links.length) return
    const next = [...links]
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange(next)
  }
  const add = () => {
    if (links.length >= DIGITAL_CARD_LIMITS.links) return
    onChange([...links, newLink(newKey(), pages.length > 0)])
  }
  const nameOf = (l: DigitalCardLinkValue) => l.label[lang]?.trim() || l.label[defaultLocale]?.trim() || linkKindLabel(m, l.kind)

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
      <ol className="flex flex-col gap-3">
        {links.map((l, i) => {
          const target = DIGITAL_CARD_LINK_TARGET[l.kind]
          const complete = linkComplete(l)
          const menu: CardMenuItem[] = editable
            ? [
                ...(i > 0 ? [{ key: 'up', label: e.moveUp, onSelect: () => move(i, -1) }] : []),
                ...(i < links.length - 1 ? [{ key: 'down', label: e.moveDown, onSelect: () => move(i, 1) }] : []),
                {
                  key: 'remove',
                  label: e.removeLink,
                  destructive: true,
                  separated: true,
                  onSelect: () => {
                    onChange(links.filter((x) => x.key !== l.key))
                    onRemove(l, i)
                  },
                },
              ]
            : []
          const fileName = l.file ? fileNames[l.file] ?? files[l.file]?.title ?? l.file : null
          return (
            <li key={l.key}>
              <Panel padding="md" className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[0.9375rem] leading-6 font-semibold break-words text-foreground">
                      {i + 1}. {nameOf(l)}
                    </p>
                    <span className="flex flex-wrap items-start gap-1.5">
                      {l.primary && !l.hidden ? <Pill tone="success">{e.linkPrimaryNote}</Pill> : null}
                      {l.hidden ? <Pill tone="muted">{e.linkHiddenNote}</Pill> : null}
                      {!complete ? <Pill tone="warning">{e.linkIncomplete}</Pill> : null}
                    </span>
                  </div>
                  {menu.length ? <CardMenu label={formatDigitalCardsMessage(e.linkActionsFor, { name: nameOf(l) })} items={menu} /> : null}
                </div>
                <div className="grid items-start gap-3 md:grid-cols-2">
                  <Field label={e.linkKind}>
                    {(p) => (
                      <Select {...p} value={l.kind} disabled={!editable} onChange={(ev) => update(l.key, { kind: ev.target.value as DigitalCardLinkKind })}>
                        {kinds.map((k) => (
                          <option key={k} value={k}>
                            {linkKindLabel(m, k)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={formatDigitalCardsMessage(e.linkLabel, { language: lang.toUpperCase() })} hint={e.linkLabelHint} hintBelow>
                    {(p) => (
                      <TextInput
                        {...p}
                        value={l.label[lang] ?? ''}
                        readOnly={!editable}
                        maxLength={DIGITAL_CARD_LIMITS.label}
                        placeholder={lang !== defaultLocale ? l.label[defaultLocale] || linkKindLabel(m, l.kind) : linkKindLabel(m, l.kind)}
                        onChange={(ev) => update(l.key, { label: { ...l.label, [lang]: ev.target.value } })}
                      />
                    )}
                  </Field>
                </div>
                <Field label={formatDigitalCardsMessage(e.linkDescription, { language: lang.toUpperCase() })} hint={e.linkDescriptionHint}>
                  {(p) => (
                    <TextInput
                      {...p}
                      value={l.description[lang] ?? ''}
                      readOnly={!editable}
                      maxLength={DIGITAL_CARD_LIMITS.linkDescription}
                      placeholder={lang !== defaultLocale ? l.description[defaultLocale] || undefined : undefined}
                      onChange={(ev) => update(l.key, { description: { ...l.description, [lang]: ev.target.value } })}
                    />
                  )}
                </Field>
                {target === 'url' ? (
                  <Field label={e.linkUrl}>
                    {(p) => <TextInput {...p} type="url" inputMode="url" value={l.url} readOnly={!editable} maxLength={2000} placeholder="https://" onChange={(ev) => update(l.key, { url: ev.target.value })} />}
                  </Field>
                ) : null}
                {target === 'page' ? (
                  <Field label={e.linkPage} hint={l.kind === 'form' ? e.linkFormHint : l.kind === 'booking' ? e.linkBookingHint : undefined}>
                    {(p) => (
                      <Select {...p} value={l.page ?? ''} disabled={!editable} onChange={(ev) => update(l.key, { page: ev.target.value || null })}>
                        <option value="">{e.linkPageNone}</option>
                        {pages.map((pg) => (
                          <option key={pg.id} value={pg.id}>
                            {pg.title}
                          </option>
                        ))}
                      </Select>
                    )}
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
                        readOnly={!editable}
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
                      {editable ? <Button onClick={() => setPickingFor(l.key)}>{l.file ? e.changeFile : e.chooseFile}</Button> : null}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
                  <label className="flex items-start gap-1">
                    <Checkbox aria-label={e.linkShown} checked={!l.hidden} disabled={!editable} onChange={(on) => update(l.key, { hidden: !on, ...(on ? {} : { primary: false }) })} />
                    <span className="pt-2.5 text-[0.9375rem] leading-6 text-foreground">{e.linkShown}</span>
                  </label>
                  <label className="flex items-start gap-1">
                    <Checkbox aria-label={e.linkPrimary} checked={l.primary} disabled={!editable || l.hidden} describedBy={`link-primary-${l.key}`} onChange={(on) => update(l.key, { primary: on })} />
                    <span className="pt-2.5">
                      <span className="block text-[0.9375rem] leading-6 text-foreground">{e.linkPrimary}</span>
                      <span id={`link-primary-${l.key}`} className="block text-sm leading-5 text-muted-foreground">
                        {e.linkPrimaryHint}
                      </span>
                    </span>
                  </label>
                </div>
              </Panel>
            </li>
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
    </Panel>
  )
}
