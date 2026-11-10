'use client'

import { useId, type ReactNode } from 'react'
import { useLocale } from 'next-intl'
import type { DigitalCardAvailability, DigitalCardLinkValue, DigitalCardSnapshot } from '@/lib/api/digital-cards'
import type { DigitalCardShow } from '@/lib/modules/digital-cards/model'
import { formatDigitalCardsMessage, getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { shortUrl, socialPlatformLabel } from '@/lib/settings/social-links'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { Panel } from '@/components/app/ui/Panel'
import { Switch } from '@/components/app/ui/Switch'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import { linkDisplay } from './links-model'
import { linkComplete, linkKindLabel } from './DigitalCardLinks'

const H2 = 'text-[1.0625rem] leading-7 font-semibold text-foreground'
const H3 = 'text-[0.9375rem] leading-6 font-semibold text-foreground'

/** People contact kinds shown as social profiles, by name. */
const PERSON_SOCIAL_NAMES: Record<string, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', website: 'Website', url: 'Link' }

type Row = {
  key: string
  label: string
  /** The real value shown (number, address, "LinkedIn · linkedin.com/in/…"). */
  value: ReactNode
  /** Switch state; undefined = no switch (nothing to show yet). */
  on?: boolean
  onChange?: (on: boolean) => void
  /** Where the missing data is added. */
  fix?: { href: string; label: string } | null
  /** Shown under the row (e.g. the name mode, the description field). */
  extra?: ReactNode
}

/**
 * "What's on your card" (ADR-049 Amendment A): ONE list, grouped About ·
 * Contact · Social profiles · Locations · Buttons. Every row shows the REAL
 * value it would put on the card and one switch. A row without data has no
 * switch: it says so and links to where the data is added (Settings → Social
 * Profiles for the site's profiles, Support for other site data, the person in
 * People for a person's data).
 */
export function DigitalCardContents({
  snapshot,
  show,
  links,
  lang,
  defaultLocale,
  editable,
  projectSlug,
  descriptionText,
  onSwitch,
  onSocial,
  onLocation,
  onLinkShown,
  onEditButtons,
  nameMode,
  descriptionField,
}: {
  snapshot: DigitalCardSnapshot
  show: DigitalCardShow
  links: readonly DigitalCardLinkValue[]
  lang: string
  defaultLocale: string
  editable: boolean
  projectSlug: string
  /** The card's own description in the language shown ('' = none). */
  descriptionText: string
  onSwitch: (key: string, on: boolean) => void
  onSocial: (key: string, on: boolean) => void
  onLocation: (key: string, on: boolean) => void
  onLinkShown: (key: string, shown: boolean) => void
  onEditButtons: () => void
  /** Person card: the "Name as shown" control, under Name. */
  nameMode?: ReactNode
  /** The description field, under Short description. */
  descriptionField: ReactNode
}) {
  const m = getDigitalCardsMessages(useLocale())
  const e = m.editor
  const c = m.card
  const av: DigitalCardAvailability = snapshot.availability
  const isPerson = snapshot.kind === 'person'
  const personName = snapshot.person?.name || e.personFallback
  const firstName = snapshot.person?.firstName || personName
  const rec = show as unknown as Record<string, unknown>
  const flag = (k: string) => rec[k] === true

  const supportFix = { href: `/${projectSlug}/support`, label: c.addInSupport }
  const socialFix = { href: `/${projectSlug}/settings/social-profiles`, label: c.addInSettings }
  const personFix = snapshot.person ? { href: `/${projectSlug}/people/${snapshot.person.id}`, label: c.addInPeople } : null
  const fixFor = isPerson ? personFix : supportFix
  const sw = (key: string, available: boolean) => (available ? { on: flag(key), onChange: (on: boolean) => onSwitch(key, on) } : { fix: fixFor })
  const valueOr = (v: string) => v || c.notAdded

  // ── About ──
  const about: Row[] = isPerson
    ? [
        { key: 'photo', label: e.photo, value: av.photo ? formatDigitalCardsMessage(c.photoValue, { name: firstName }) : c.notAdded, ...sw('photo', av.photo) },
        { key: 'name', label: e.name, value: personName, on: flag('name'), onChange: (on) => onSwitch('name', on), extra: nameMode },
        { key: 'role', label: e.role, value: valueOr(av.values.role), ...sw('role', av.role) },
        {
          key: 'description',
          label: e.description,
          value: descriptionText || formatDigitalCardsMessage(c.descriptionFromBio, { name: firstName }),
          on: flag('description'),
          onChange: (on) => onSwitch('description', on),
          extra: descriptionField,
        },
        {
          key: 'businessName',
          label: e.businessName,
          value: av.siteName ? formatDigitalCardsMessage(c.businessNameLinked, { name: av.siteName }) : c.notAdded,
          ...(av.businessName ? { on: flag('businessName'), onChange: (on: boolean) => onSwitch('businessName', on) } : { fix: supportFix }),
        },
        {
          key: 'profileLink',
          label: formatDigitalCardsMessage(e.profileLink, { name: firstName }),
          value: av.profilePage ? c.profileValue : formatDigitalCardsMessage(e.personMissingProfile, { name: firstName }),
          ...sw('profileLink', av.profilePage),
        },
      ]
    : [
        { key: 'logo', label: e.logo, value: av.logo ? c.logoValue : c.notAdded, ...sw('logo', av.logo) },
        {
          key: 'businessName',
          label: e.businessName,
          value: valueOr(av.siteName),
          ...sw('businessName', av.businessName),
          // The logo image already contains the name: keep the switch, say it is not printed (live with the Logo switch).
          extra: av.logoIncludesName === true && av.logo && flag('logo') ? <p className="text-sm leading-5 text-muted-foreground">{c.nameInLogoNote}</p> : undefined,
        },
        { key: 'description', label: e.description, value: descriptionText || c.descriptionEmpty, on: flag('description'), onChange: (on) => onSwitch('description', on), extra: descriptionField },
      ]

  // ── Contact ──
  const contact: Row[] = [
    { key: 'phone', label: e.phone, value: valueOr(av.values.phone), ...sw('phone', av.phone) },
    { key: 'email', label: e.email, value: valueOr(av.values.email), ...sw('email', av.email) },
    { key: 'whatsapp', label: e.whatsapp, value: valueOr(av.values.whatsapp), ...sw('whatsapp', av.whatsapp) },
    { key: 'saveContact', label: e.saveContact, value: c.saveContactValue, on: flag('saveContact'), onChange: (on) => onSwitch('saveContact', on) },
  ]

  // ── Social profiles (on by default — Amendment A) ──
  const shownSocials = new Set(show.socials)
  const socials: Row[] = av.socials.map((s) => ({
    key: `social-${s.key}`,
    label: isPerson ? (PERSON_SOCIAL_NAMES[s.label] ?? s.label) : socialPlatformLabel(s.key),
    value: s.detail ? shortUrl(s.detail) : '',
    on: shownSocials.has(s.key),
    onChange: (on: boolean) => onSocial(s.key, on),
  }))

  // ── Locations (site card) ──
  const shownLocations = new Set((show as { locations?: string[] }).locations ?? [])
  const locations: Row[] = av.locations.map((l) => ({
    key: `location-${l.key}`,
    label: l.label,
    value: l.detail ?? '',
    on: shownLocations.has(l.key),
    onChange: (on: boolean) => onLocation(l.key, on),
  }))

  // ── Buttons (the links, in order) ──
  const target = (l: DigitalCardLinkValue): string => {
    switch (l.kind) {
      case 'url':
        return shortUrl(l.url)
      case 'page':
      case 'form':
      case 'booking':
        return snapshot.pages.find((p) => p.id === l.page)?.title ?? ''
      case 'file':
        return (l.file && snapshot.files[l.file]?.title) || ''
      default:
        return l.value.trim()
    }
  }
  const buttons: Row[] = links.map((l) => {
    const kind = linkKindLabel(m, l.kind)
    // The label visitors see: typed, else the page's / file's title, else the standard one (as the website).
    const label = linkDisplay(l, lang, defaultLocale, { pages: snapshot.pages, files: snapshot.files }, getDigitalCardSiteMessages(lang)).label
    const t = target(l)
    return {
      key: `button-${l.key}`,
      label: l.primary ? `${label} · ${e.linkPrimaryNote}` : label,
      value: linkComplete(l) && t ? formatDigitalCardsMessage(c.buttonTarget, { kind, target: t }) : formatDigitalCardsMessage(c.buttonUnfinished, { kind }),
      on: !l.hidden,
      onChange: (on: boolean) => onLinkShown(l.key, on),
    }
  })

  return (
    <Panel as="section" aria-labelledby="card-contents" className="space-y-5" id="card-shown-section">
      <div>
        <h2 id="card-contents" className={H2}>
          {c.contentsTitle}
        </h2>
        <p className="text-sm leading-5 text-muted-foreground">{c.contentsHint}</p>
      </div>
      <Group title={c.groupAbout} rows={about} editable={editable} turnOn={c.turnOn} />
      <Group title={c.groupContact} rows={contact} editable={editable} turnOn={c.turnOn} />
      <Group
        title={c.groupSocials}
        rows={socials}
        editable={editable}
        turnOn={c.turnOn}
        hint={socials.length ? c.socialsOnHint : undefined}
        empty={
          <EmptyLine text={isPerson ? formatDigitalCardsMessage(e.personMissingSocials, { name: firstName }) : e.siteMissingSocials} fix={isPerson ? personFix : socialFix} />
        }
      />
      {!isPerson && av.socialsPendingInStudio ? <EmptyLine text={c.socialsPendingStudio} fix={socialFix} /> : null}
      {!isPerson ? (
        <Group
          title={c.groupLocations}
          rows={locations}
          editable={editable}
          turnOn={c.turnOn}
          hint={locations.length ? e.locationsHint : undefined}
          empty={<EmptyLine text={e.siteMissingLocations} fix={supportFix} />}
        />
      ) : null}
      <Group
        title={c.groupButtons}
        rows={buttons}
        editable={editable}
        turnOn={c.turnOn}
        empty={<p className="text-sm leading-5 text-muted-foreground">{c.buttonsNone}</p>}
        action={
          <Button variant="link" className="text-sm" onClick={onEditButtons}>
            {c.buttonsEdit}
          </Button>
        }
      />
    </Panel>
  )
}

function EmptyLine({ text, fix }: { text: string; fix: { href: string; label: string } | null }) {
  return (
    <p className="text-sm leading-5 text-muted-foreground">
      {text}{' '}
      {fix ? (
        <ButtonLink variant="link" className="text-sm" href={fix.href}>
          {fix.label}
        </ButtonLink>
      ) : null}
    </p>
  )
}

function Group({
  title,
  rows,
  editable,
  turnOn,
  hint,
  empty,
  action,
}: {
  title: string
  rows: Row[]
  editable: boolean
  turnOn: string
  hint?: string
  empty?: ReactNode
  action?: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="space-y-1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={id} className={H3}>
          {title}
        </h3>
        {action}
      </div>
      {hint ? <p className="text-sm leading-5 text-muted-foreground">{hint}</p> : null}
      {rows.length === 0 ? (
        empty
      ) : (
        <ul className="divide-y divide-border-subtle">
          {rows.map((r) => (
            <ContentRow key={r.key} row={r} editable={editable} turnOn={turnOn} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ContentRow({ row, editable, turnOn }: { row: Row; editable: boolean; turnOn: string }) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.9375rem] leading-6 text-foreground">
            {row.label}
          </p>
          {row.value ? (
            <p className="text-sm leading-5 break-words text-muted-foreground" translate="no">
              {row.value}
            </p>
          ) : null}
          {row.fix ? (
            <ButtonLink variant="link" className="text-sm" href={row.fix.href}>
              {row.fix.label}
            </ButtonLink>
          ) : null}
        </div>
        {row.on !== undefined && row.onChange ? (
          <Switch checked={row.on} disabled={!editable} label={formatDigitalCardsMessage(turnOn, { name: row.label })} onChange={row.onChange} />
        ) : null}
      </div>
      {row.extra ? <div className="mt-3">{row.extra}</div> : null}
    </li>
  )
}
