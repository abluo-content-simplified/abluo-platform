'use client'

import { useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { PortableTextBlock } from '@portabletext/editor'
import { shortenPersonBioAction } from '@/app/[locale]/(client)/[tenant]/people/actions'
import type { PersonTranslatableField } from '@/lib/api/persons'
import { formatTranslateMessage, getTranslateMessages } from '@/lib/i18n/translate-messages'
import { effectiveStatus } from '@/lib/translate/status'
import { normalizeFaqAnswer } from '@/lib/faq/answer-blocks'
import { COMMON_LANGUAGES, CONTACT_KINDS, contactProblem, suggestSlug, type ContactKind, type ContactRow } from '@/lib/client/person-editor'
import { BodyEditor } from '@/components/client/editor/BodyEditor'
import { PhotoSource } from '@/components/client/media/PhotoSource'
import { TermPicker } from '@/components/client/taxonomy/TermPicker'
import { AssistButton } from '@/components/app/ui/AssistButton'
import { Button, IconButton } from '@/components/app/ui/Button'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { DateInput } from '@/components/app/ui/DateInput'
import { Field } from '@/components/app/ui/Field'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { MediaFrame } from '@/components/app/ui/list/cells'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { RadioList } from '@/components/app/ui/RadioList'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { Select } from '@/components/app/ui/Select'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import type { FocalPoint } from '@/components/app/ui/FocalPointPicker'
import { PersonEditorPhotoFocus } from './PersonEditorPhotoFocus'
import { PERSON_ICONS, PERSON_UI_LIMITS } from './person-bits'
import type { EditorApi } from './person-editor-types'

/** A fresh, valid `_key` (the server keeps it: /^[A-Za-z0-9_-]{1,64}$/). */
function newKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  } catch {
    return Math.random().toString(36).slice(2, 14)
  }
}

/** Language switch for the localized fields of a tab (only on sites with more than one language). */
export function LanguageSwitch({ api }: { api: EditorApi & { setLang: (l: string) => void } }) {
  const t = useTranslations('clientDashboard.persons.editor')
  if (api.languages.length < 2) return null
  return (
    <SegmentedControl
      label={t('language')}
      appearance="soft"
      value={api.lang}
      onChange={api.setLang}
      options={api.languages.map((l) => ({ value: l, label: l.toUpperCase() }))}
    />
  )
}

/**
 * "Translate from EN" (ADR-023) for a group of fields, plus the status of the
 * language being edited ("Machine translation" until a person edits it).
 * Absent when the Translate module is off or the person cannot be edited.
 */
function TranslateRow({ api, fields }: { api: EditorApi & { setLang: (l: string) => void }; fields: PersonTranslatableField[] }) {
  const tm = getTranslateMessages(useLocale())
  const { translate, values: v, d, lang, languageName } = api
  if (!translate) return null
  const filled = fields.some((f) => (v[f][d] ?? '').trim())
  const machine = lang !== d && fields.some((f) => effectiveStatus(v[f][lang], v.translations[f][lang]) === 'machine')
  return (
    <div className="flex flex-col items-start gap-1.5">
      <AssistButton tone="outline" busy={translate.running} disabled={translate.running || !filled} onClick={() => translate.run(fields)}>
        {translate.running ? tm.translating : formatTranslateMessage(tm.translateFrom, { source: languageName(d) })}
      </AssistButton>
      {!filled ? <p className="text-sm leading-5 text-muted-foreground">{formatTranslateMessage(tm.nothingToTranslate, { source: languageName(d) })}</p> : null}
      {machine ? <p className="text-sm leading-5 text-muted-foreground">{tm.statusMachine}</p> : null}
    </div>
  )
}

const H2 = 'text-[1.0625rem] leading-7 font-semibold text-foreground'

// ── Profile ──────────────────────────────────────────────────────────────────

export function ProfileTab({ api }: { api: EditorApi & { setLang: (l: string) => void } }) {
  const t = useTranslations('clientDashboard.persons.editor.profile')
  const { values: v, lang, d, editable, languageName } = api
  const translating = lang !== d
  const [picking, setPicking] = useState(false)
  /** The photo asset's focus point (Media Library hotspot): read and saved by PersonEditorPhotoFocus, shown in both previews. */
  const [focal, setFocal] = useState<FocalPoint | null>(null)
  const [focusing, setFocusing] = useState(false)
  const [suggestion, setSuggestion] = useState<{ locale: string; text: string } | null>(null)
  const [shortening, setShortening] = useState(false)
  const [shortenError, setShortenError] = useState<string | null>(null)
  const hasBio = (v.bio[lang]?.length ?? 0) > 0 && v.bio[lang].some((b) => ((b as { children?: { text?: string }[] }).children ?? []).some((c) => (c.text ?? '').trim()))
  const photo = v.photo
  const shortBio = v.shortBio[lang] ?? ''

  async function shorten() {
    if (shortening || !hasBio) return
    setShortening(true)
    setShortenError(null)
    setSuggestion(null)
    try {
      const r = await shortenPersonBioAction({ projectSlug: api.projectSlug, locale: lang, blocks: v.bio[lang] as unknown[] })
      if (!r.ok) setShortenError(r.error === 'ai_unavailable' ? t('shortenUnavailable') : r.error === 'too_large' ? t('shortenTooLong') : t('shortenFailed'))
      else setSuggestion({ locale: lang, text: r.text })
    } catch {
      setShortenError(t('shortenFailed'))
    } finally {
      setShortening(false)
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="person-photo" className="space-y-3">
        <h2 id="person-photo" className={H2}>
          {t('photoTitle')}
        </h2>
        <div className="flex items-start gap-4">
          <div className="size-28 shrink-0 overflow-hidden rounded-2xl bg-muted">
            {photo?.url ? <MediaFrame src={photo.url} alt="" focal={focal} className="size-full" /> : <span className="grid size-full place-items-center px-2 text-center text-sm text-muted-foreground">{t('noPhoto')}</span>}
          </div>
          <div className="flex min-w-0 flex-col items-start gap-2">
            <p className="text-sm leading-5 text-muted-foreground">{photo ? t('photoHelper') : t('photoHelperEmpty')}</p>
            {editable ? (
              <div className="flex flex-wrap items-start gap-2">
                <Button onClick={() => setPicking((x) => !x)} aria-expanded={picking}>
                  {photo ? t('changePhoto') : t('addPhoto')}
                </Button>
                {photo && api.canSetFocus ? (
                  <Button onClick={() => setFocusing((x) => !x)} aria-expanded={focusing}>
                    {t('focal.toggle')}
                  </Button>
                ) : null}
                {photo ? <Button onClick={() => api.change({ photo: null }, { photo: null })}>{t('removePhoto')}</Button> : null}
              </div>
            ) : null}
          </div>
          {photo?.url ? (
            <div className="flex shrink-0 flex-col items-start gap-1">
              <MediaFrame src={photo.url} alt="" focal={focal} className="size-16 rounded-full" />
              <span className="text-xs leading-4 text-muted-foreground">{t('focal.avatar')}</span>
            </div>
          ) : null}
        </div>
        {photo && api.canSetFocus ? (
          <PersonEditorPhotoFocus
            key={photo.assetId}
            projectSlug={api.projectSlug}
            assetId={photo.assetId}
            name={[v.firstName, v.lastName].filter(Boolean).join(' ')}
            focal={focal}
            onFocal={setFocal}
            editable={editable}
            show={focusing}
          />
        ) : null}
        {editable && picking ? (
          <Panel>
            <PhotoSource
              projectSlug={api.projectSlug}
              scope="media"
              defaultLocale={d}
              exclude={photo ? [photo.assetId] : []}
              room={1}
              onAdd={(photos) => {
                const first = photos[0]
                if (!first) return
                setPicking(false)
                api.change({ photo: { assetId: first.assetId, url: first.thumbUrl ?? first.url } }, { photo: first.assetId })
              }}
            />
          </Panel>
        ) : null}
      </section>

      <Panel as="section" aria-labelledby="person-names" className="space-y-4">
        <h2 id="person-names" className={H2}>
          {t('namesTitle')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('firstName')} error={editable && !v.firstName.trim() ? t('nameRequired') : undefined}>
            {(p) => (
              <TextInput
                {...p}
                value={v.firstName}
                readOnly={!editable}
                maxLength={PERSON_UI_LIMITS.name}
                autoComplete="off"
                onChange={(e) => api.change({ firstName: e.target.value }, e.target.value.trim() ? { firstName: e.target.value } : undefined)}
              />
            )}
          </Field>
          <Field label={t('lastName')}>
            {(p) => (
              <TextInput
                {...p}
                value={v.lastName}
                readOnly={!editable}
                maxLength={PERSON_UI_LIMITS.name}
                autoComplete="off"
                onChange={(e) => api.change({ lastName: e.target.value }, { lastName: e.target.value.trim() ? e.target.value : null })}
              />
            )}
          </Field>
        </div>
        <Field label={t('displayName')} hint={t('displayNameHint', { name: `${v.firstName} ${v.lastName}`.trim() })}>
          {(p) => (
            <TextInput
              {...p}
              value={v.displayName}
              readOnly={!editable}
              maxLength={PERSON_UI_LIMITS.displayName}
              autoComplete="off"
              onChange={(e) => api.change({ displayName: e.target.value }, { displayName: e.target.value.trim() ? e.target.value : null })}
            />
          )}
        </Field>
      </Panel>

      <Panel as="section" aria-labelledby="person-title" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="person-title" className={H2}>
            {t('titleSection')}
          </h2>
          <LanguageSwitch api={api} />
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <Field label={t('honorific', { language: languageName(lang) })} hint={t('honorificHint')}>
            {(p) => (
              <TextInput
                {...p}
                value={v.honorific[lang] ?? ''}
                readOnly={!editable}
                maxLength={PERSON_UI_LIMITS.short}
                placeholder={translating ? v.honorific[d] || undefined : undefined}
                onChange={(e) => api.change({ honorific: { ...v.honorific, [lang]: e.target.value } }, { [`honorific.${lang}`]: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('jobTitle', { language: languageName(lang) })} hint={t('jobTitleHint')}>
            {(p) => (
              <TextInput
                {...p}
                value={v.jobTitle[lang] ?? ''}
                readOnly={!editable}
                maxLength={PERSON_UI_LIMITS.short}
                placeholder={translating ? v.jobTitle[d] || undefined : undefined}
                onChange={(e) => api.change({ jobTitle: { ...v.jobTitle, [lang]: e.target.value } }, { [`jobTitle.${lang}`]: e.target.value })}
              />
            )}
          </Field>
        </div>
        <TranslateRow api={api} fields={['honorific', 'jobTitle']} />
      </Panel>

      <Panel as="section" aria-labelledby="person-groups" className="space-y-3">
        <h2 id="person-groups" className={H2}>
          {t('groupsTitle')}
        </h2>
        <TermPicker
          projectSlug={api.projectSlug}
          module="people"
          kind="category"
          label={t('groupsTitle')}
          terms={api.groupTerms}
          value={v.groups}
          onChange={(groups) => api.change({ groups }, { groups })}
          defaultLocale={d}
          canAdd={api.canAddGroup && editable}
          disabled={!editable}
        />
        <p className="text-sm leading-5 text-muted-foreground">{t('groupsHelper')}</p>
      </Panel>

      <Panel as="section" aria-labelledby="person-short" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="person-short" className={H2}>
            {t('shortBioTitle')}
          </h2>
          <LanguageSwitch api={api} />
        </div>
        <Field label={t('shortBio', { language: languageName(lang) })} hint={t('shortBioHint', { count: shortBio.length, max: PERSON_UI_LIMITS.shortBio })}>
          {(p) => (
            <TextArea
              {...p}
              rows={4}
              value={shortBio}
              readOnly={!editable}
              maxLength={PERSON_UI_LIMITS.shortBio}
              placeholder={translating ? v.shortBio[d] || undefined : undefined}
              onChange={(e) => api.change({ shortBio: { ...v.shortBio, [lang]: e.target.value } }, { [`shortBio.${lang}`]: e.target.value })}
            />
          )}
        </Field>
        <TranslateRow api={api} fields={['shortBio']} />
        {editable ? (
          <div className="flex flex-col items-start gap-1.5">
            <AssistButton busy={shortening} disabled={shortening || !hasBio} onClick={() => void shorten()} aria-describedby="person-shorten-why">
              {shortening ? t('shortening') : t('shorten')}
            </AssistButton>
            <p id="person-shorten-why" className="text-sm leading-5 text-muted-foreground">
              {hasBio ? t('shortenHelper') : t('shortenNeedsBio', { language: languageName(lang) })}
            </p>
          </div>
        ) : null}
        {shortenError ? (
          <Notice tone="error" onDismiss={() => setShortenError(null)} dismissLabel={t('dismiss')}>
            {shortenError}
          </Notice>
        ) : null}
        {suggestion && suggestion.locale === lang ? (
          <Notice
            tone="info"
            title={t('suggestionTitle')}
            action={
              <span className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={() => {
                    api.change({ shortBio: { ...v.shortBio, [lang]: suggestion.text } }, { [`shortBio.${lang}`]: suggestion.text })
                    setSuggestion(null)
                    api.showToast(t('suggestionUsed'))
                  }}
                >
                  {t('useSuggestion')}
                </Button>
                <Button onClick={() => setSuggestion(null)}>{t('dismissSuggestion')}</Button>
              </span>
            }
          >
            {suggestion.text}
          </Notice>
        ) : null}
      </Panel>
    </div>
  )
}

// ── About ────────────────────────────────────────────────────────────────────

export function AboutTab({ api }: { api: EditorApi & { setLang: (l: string) => void } }) {
  const t = useTranslations('clientDashboard.persons.editor.about')
  const { values: v, lang, d, editable, languageName } = api
  const translating = lang !== d
  /** The editor may normalise its value on mount; only changes made after the person reaches the field count. */
  const touched = useRef('')
  const mount = `${lang}:${api.generation}`
  const uid = useId()

  const languageOptions = [...new Set([...v.languages, ...api.languages, ...COMMON_LANGUAGES])].map((code) => ({ value: code, label: languageName(code) }))
  const setQualification = (key: string, patch: Partial<(typeof v.qualifications)[number]>) => {
    const next = v.qualifications.map((q) => (q._key === key ? { ...q, ...patch } : q))
    api.change({ qualifications: next }, { qualifications: next })
  }

  return (
    <div className="space-y-6">
      <Panel as="section" aria-labelledby="person-bio" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="person-bio" className={H2}>
            {t('bioTitle')}
          </h2>
          <LanguageSwitch api={api} />
        </div>
        <FieldLabel as="p" id={`${uid}-bio`} hint={translating && v.bio[d]?.length ? t('bioReference', { language: languageName(d) }) : editable ? t('bioHint') : undefined}>
          {t('bio', { language: languageName(lang) })}
        </FieldLabel>
        <div
          className="rounded-xl border border-border px-3"
          onFocusCapture={() => {
            touched.current = mount
          }}
          onPointerDownCapture={() => {
            touched.current = mount
          }}
        >
          <BodyEditor
            key={`${lang}:${api.generation}:${editable ? 'rw' : 'ro'}`}
            variant="faqAnswer"
            label={t('bioLabel', { language: languageName(lang) })}
            initialValue={v.bio[lang]}
            placeholder={t('bioPlaceholder')}
            links={editable ? api.links : undefined}
            onChange={(value) => {
              if (!editable || touched.current !== mount) return
              const blocks = normalizeFaqAnswer(value ?? []) as unknown as PortableTextBlock[]
              api.change({ bio: { ...v.bio, [lang]: blocks } }, { [`bio.${lang}`]: blocks })
            }}
          />
        </div>
      </Panel>

      <Panel as="section" aria-labelledby="person-languages" className="space-y-3">
        <h2 id="person-languages" className={H2}>
          {t('languagesTitle')}
        </h2>
        <ToggleChips
          label={t('languagesTitle')}
          options={languageOptions}
          value={v.languages}
          onChange={(languages) => editable && api.change({ languages }, { languages })}
          size="compact"
        />
        <p className="text-sm leading-5 text-muted-foreground">{t('languagesHelper')}</p>
      </Panel>

      <section aria-labelledby="person-quals" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="person-quals" className={H2}>
              {t('qualificationsTitle')} <span className="font-normal text-muted-foreground tabular-nums">· {v.qualifications.length}</span>
            </h2>
            <p className="text-sm leading-5 text-muted-foreground">{t('qualificationsHint')}</p>
          </div>
          <LanguageSwitch api={api} />
        </div>
        {v.qualifications.length === 0 && !editable ? <p className="text-[0.9375rem] text-muted-foreground">{t('qualificationsNone')}</p> : null}
        <ul className="flex flex-col gap-3">
          {v.qualifications.map((q, n) => (
            <Panel as="li" key={q._key} className="space-y-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Field
                    label={t('qualificationTitle', { language: languageName(lang), n: n + 1 })}
                    error={editable && Object.values(q.title).every((x) => !x.trim()) ? t('qualificationTitleNeeded') : undefined}
                  >
                    {(p) => (
                      <TextInput
                        {...p}
                        value={q.title[lang] ?? ''}
                        readOnly={!editable}
                        maxLength={PERSON_UI_LIMITS.short}
                        placeholder={translating ? q.title[d] || undefined : undefined}
                        onChange={(e) => setQualification(q._key, { title: { ...q.title, [lang]: e.target.value } })}
                      />
                    )}
                  </Field>
                </div>
                {editable ? (
                  <IconButton
                    aria-label={t('removeQualification', { n: n + 1 })}
                    className="mt-7 text-muted-foreground"
                    onClick={() => {
                      const next = v.qualifications.filter((x) => x._key !== q._key)
                      api.change({ qualifications: next }, { qualifications: next })
                    }}
                  >
                    {PERSON_ICONS.trash}
                  </IconButton>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label={t('issuer')}>
                  {(p) => <TextInput {...p} value={q.issuer} readOnly={!editable} maxLength={PERSON_UI_LIMITS.issuer} onChange={(e) => setQualification(q._key, { issuer: e.target.value })} />}
                </Field>
                <Field label={t('issuedOn')}>
                  {(p) => <DateInput {...p} value={q.issuedOn ?? ''} readOnly={!editable} onChange={(e) => setQualification(q._key, { issuedOn: e.target.value || null })} />}
                </Field>
                <Field
                  label={t('expiresOn')}
                  error={q.issuedOn && q.expiresOn && q.expiresOn < q.issuedOn ? t('expiresBeforeIssued') : undefined}
                >
                  {(p) => <DateInput {...p} value={q.expiresOn ?? ''} readOnly={!editable} onChange={(e) => setQualification(q._key, { expiresOn: e.target.value || null })} />}
                </Field>
              </div>
            </Panel>
          ))}
        </ul>
        {editable ? (
          <div className="flex flex-col items-start gap-1">
            <Button
              disabled={v.qualifications.length >= PERSON_UI_LIMITS.qualifications}
              aria-describedby={v.qualifications.length >= PERSON_UI_LIMITS.qualifications ? 'person-qual-full' : undefined}
              onClick={() => {
                const next = [...v.qualifications, { _key: newKey(), title: {}, issuer: '', issuedOn: null, expiresOn: null }]
                api.change({ qualifications: next }, { qualifications: next })
              }}
            >
              {PERSON_ICONS.plus}
              {t('addQualification')}
            </Button>
            {v.qualifications.length >= PERSON_UI_LIMITS.qualifications ? (
              <p id="person-qual-full" className="text-sm leading-5 text-muted-foreground">
                {t('qualificationsFull', { max: PERSON_UI_LIMITS.qualifications })}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}

// ── Contact ──────────────────────────────────────────────────────────────────

export function ContactTab({ api }: { api: EditorApi }) {
  const t = useTranslations('clientDashboard.persons.editor.contact')
  const { values: v, editable, priv } = api
  const full = v.contacts.length >= PERSON_UI_LIMITS.contacts
  const patchRow = (key: string, patch: Partial<ContactRow>) => api.changeContacts(v.contacts.map((c) => (c._key === key ? { ...c, ...patch } : c)))

  return (
    <div className="space-y-6">
      {!priv.available ? (
        <Notice tone="info" title={t('privateUnavailableTitle')}>
          {t('privateUnavailable')}
        </Notice>
      ) : null}

      <section aria-labelledby="person-contacts" className="space-y-3">
        <div>
          <h2 id="person-contacts" className={H2}>
            {t('title')} <span className="font-normal text-muted-foreground tabular-nums">· {v.contacts.length}</span>
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">{t('hint')}</p>
        </div>
        {v.contacts.length === 0 ? <p className="text-[0.9375rem] text-muted-foreground">{t('none')}</p> : null}
        <ul className="flex flex-col gap-3">
          {v.contacts.map((c, n) => {
            const problem = contactProblem(c.kind, c.value)
            const shownProblem = problem && problem !== 'empty' ? problem : null
            return (
              <Panel as="li" key={c._key} className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
                  <Field label={t('kind')}>
                    {(p) => (
                      <Select {...p} value={c.kind} disabled={!editable} onChange={(e) => patchRow(c._key, { kind: e.target.value as ContactKind })}>
                        {CONTACT_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t(`kinds.${k}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field
                    label={t('value')}
                    error={editable && shownProblem ? t(`problems.${shownProblem}`) : undefined}
                    hint={editable && problem === 'empty' ? t('valueNeeded') : undefined}
                  >
                    {(p) => (
                      <TextInput
                        {...p}
                        value={c.value}
                        readOnly={!editable}
                        maxLength={PERSON_UI_LIMITS.contactValue}
                        inputMode={c.kind === 'email' ? 'email' : c.kind === 'phone' || c.kind === 'whatsapp' ? 'tel' : 'text'}
                        autoComplete="off"
                        placeholder={t(`placeholders.${c.kind}`)}
                        onChange={(e) => patchRow(c._key, { value: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                  <Field label={t('label')}>
                    {(p) => <TextInput {...p} value={c.label} readOnly={!editable} maxLength={PERSON_UI_LIMITS.contactLabel} placeholder={t('labelPlaceholder')} onChange={(e) => patchRow(c._key, { label: e.target.value })} />}
                  </Field>
                  <label className="flex cursor-pointer items-start gap-1 pt-0 text-[0.9375rem] leading-6 text-foreground md:pt-7">
                    <Checkbox checked={c.preferred} aria-label={t('preferred')} disabled={!editable} onChange={(on) => patchRow(c._key, { preferred: on })} />
                    <span className="pt-2.5">{t('preferred')}</span>
                  </label>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <SegmentedControl
                      label={t('whoSees', { n: n + 1 })}
                      appearance="soft"
                      value={c.visibility}
                      onChange={(to) => {
                        if (to === c.visibility) return
                        if (problem) patchRow(c._key, { visibility: to })
                        else api.moveContact(c._key, to)
                      }}
                      options={[
                        { value: 'public', label: t('public'), disabled: !editable || api.moving },
                        { value: 'private', label: t('private'), disabled: !editable || api.moving || !priv.available },
                      ]}
                    />
                    <p className="flex items-start gap-1.5 text-sm leading-5 text-muted-foreground">
                      <span className="mt-0.5 shrink-0">{c.visibility === 'public' ? PERSON_ICONS.globe : PERSON_ICONS.lock}</span>
                      <span>{c.visibility === 'public' ? t('publicHelp') : t('privateHelp')}</span>
                    </p>
                  </div>
                  {editable ? (
                    <Button variant="quiet" onClick={() => api.changeContacts(v.contacts.filter((x) => x._key !== c._key))}>
                      {PERSON_ICONS.trash}
                      {t('remove')}
                    </Button>
                  ) : null}
                </div>
              </Panel>
            )
          })}
        </ul>
        {editable ? (
          <div className="flex flex-col items-start gap-1">
            <Button
              disabled={full}
              aria-describedby={full ? 'person-contact-full' : undefined}
              onClick={() => api.changeContacts([...v.contacts, { _key: newKey(), kind: 'email', value: '', label: '', preferred: false, visibility: priv.available ? 'private' : 'public' }])}
            >
              {PERSON_ICONS.plus}
              {t('add')}
            </Button>
            {full ? (
              <p id="person-contact-full" className="text-sm leading-5 text-muted-foreground">
                {t('full', { max: PERSON_UI_LIMITS.contacts })}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <Panel as="section" aria-labelledby="person-website" className="space-y-3">
        <h2 id="person-website" className={H2}>
          {t('websiteTitle')}
        </h2>
        <Field label={t('website')} hint={t('websiteHint')}>
          {(p) => (
            <TextInput
              {...p}
              type="url"
              inputMode="url"
              value={v.website}
              readOnly={!editable}
              maxLength={PERSON_UI_LIMITS.website}
              placeholder="https://"
              onChange={(e) => api.change({ website: e.target.value }, /^(https?:\/\/\S+)?$/i.test(e.target.value.trim()) ? { website: e.target.value.trim() } : undefined)}
            />
          )}
        </Field>
      </Panel>

      <Panel as="section" aria-labelledby="person-private" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="person-private" className={`${H2} flex items-start gap-2`}>
            <span className="mt-1 text-muted-foreground">{PERSON_ICONS.lock}</span>
            {t('privateTitle')}
          </h2>
          {priv.available && priv.state !== 'idle' ? (
            <span role="status" className="text-sm leading-5 text-muted-foreground">
              {t(`privateState.${priv.state}`)}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{t('privateHint')}</p>
        <Field label={t('birthday')} hint={priv.available ? t('birthdayHint') : t('privateDisabledWhy')}>
          {(p) => <DateInput {...p} value={priv.birthday} disabled={!priv.available || !editable} readOnly={!editable} onChange={(e) => api.setBirthday(e.target.value)} />}
        </Field>
        <Field label={t('notes')} hint={priv.available ? t('notesHint') : t('privateDisabledWhy')}>
          {(p) => <TextArea {...p} rows={4} value={priv.notes} disabled={!priv.available || !editable} readOnly={!editable} maxLength={PERSON_UI_LIMITS.notes} onChange={(e) => api.setNotes(e.target.value)} />}
        </Field>
      </Panel>
    </div>
  )
}

// ── On the website ───────────────────────────────────────────────────────────

export function WebsiteTab({ api }: { api: EditorApi & { setLang: (l: string) => void } }) {
  const t = useTranslations('clientDashboard.persons.editor.website')
  const { values: v, lang, d, editable, languageName } = api
  const suggestion = suggestSlug(v.firstName, v.lastName)
  const page = v.visibility === 'page'
  return (
    <div className="space-y-6">
      <Panel as="section" aria-labelledby="person-visibility" className="space-y-3">
        <h2 id="person-visibility" className={H2}>
          {t('title')}
        </h2>
        <RadioList
          legend={<span className="sr-only">{t('title')}</span>}
          name="person-visibility"
          value={v.visibility}
          onChange={(visibility) => editable && api.change({ visibility }, { visibility })}
          options={(['listed', 'page', 'off'] as const).map((o) => ({ value: o, label: t(`options.${o}`), description: t(`options.${o}Help`), disabled: !editable }))}
        />
      </Panel>

      {page ? (
        <Panel as="section" aria-labelledby="person-slug" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 id="person-slug" className={H2}>
              {t('addressTitle')}
            </h2>
            <LanguageSwitch api={api} />
          </div>
          <Field
            label={t('address', { language: languageName(lang) })}
            hint={lang === d ? t('addressHint') : t('addressHintOther', { language: languageName(d) })}
            error={editable && lang === d && !v.slug[d]?.trim() ? t('addressNeeded') : undefined}
          >
            {(p) => (
              <TextInput
                {...p}
                id="person-slug"
                value={v.slug[lang] ?? ''}
                readOnly={!editable}
                maxLength={80}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={suggestion || undefined}
                onChange={(e) => api.change({ slug: { ...v.slug, [lang]: e.target.value } }, { [`slug.${lang}`]: e.target.value })}
              />
            )}
          </Field>
          {editable && suggestion && !v.slug[lang]?.trim() ? (
            <div>
              <Button onClick={() => api.change({ slug: { ...v.slug, [lang]: suggestion } }, { [`slug.${lang}`]: suggestion })}>{t('useSuggestion', { slug: suggestion })}</Button>
            </div>
          ) : null}
          <p className="text-sm leading-5 text-muted-foreground">{t('redirectNote')}</p>
        </Panel>
      ) : (
        <Notice tone="info">{t(`explain.${v.visibility}`)}</Notice>
      )}
    </div>
  )
}
