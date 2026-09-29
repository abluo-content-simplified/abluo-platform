'use client'

/**
 * TranslateBar — the Translate button of ADR-023, rendered above the language
 * inputs of `localizedString` and `localizedText`.
 *
 * One click fills the site's other languages from the source text, stores the
 * result, and records a `translationStatus` entry per written locale. It only
 * writes targets that are EMPTY or still an untouched MACHINE translation —
 * text a person wrote (original) or checked (reviewed) is never overwritten
 * (ADR-023 §5).
 *
 * Renders nothing unless the Translate module is enabled for the document's
 * project (GET /api/translate/status), so sites without the module see no
 * change at all. All wording comes from getTranslateMessages() — Studio uses
 * `en` today; the API returns codes only.
 */

import { useEffect, useRef, useState } from 'react'
import { set, setIfMissing, useFormValue, type FormPatch, type ObjectInputProps } from 'sanity'
import type { SupportedLocale } from '@/lib/i18n/locales'
import {
  formatTranslateMessage,
  getTranslateMessages,
} from '@/lib/i18n/translate-messages'
import {
  effectiveStatus,
  isWritableTarget,
  localesToMarkReviewed,
  machineMeta,
  type TranslationStatusMap,
} from '@/lib/translate/status'
import type {
  TranslateResponseBody,
  TranslateStatusBody,
  TranslationProviderId,
} from '@/lib/translate/types'

const STUDIO_UI_LOCALE = 'en'

type StatusOk = Extract<TranslateStatusBody, { ok: true }>

// Per-session cache: one status request per project, shared by every field.
const statusCache = new Map<string, Promise<StatusOk | null>>()

function fetchStatus(projectSlug: string): Promise<StatusOk | null> {
  if (!statusCache.has(projectSlug)) {
    statusCache.set(
      projectSlug,
      fetch(`/api/translate/status?projectSlug=${encodeURIComponent(projectSlug)}`, {
        credentials: 'same-origin',
      })
        .then((r) => r.json() as Promise<TranslateStatusBody>)
        .then((b) => (b.ok ? b : null))
        .catch(() => null)
        .then((s) => {
          // Never cache a failure: one network blip (or enabling the module
          // afterwards) must not hide the button until a Studio reload.
          if (!s) statusCache.delete(projectSlug)
          return s
        })
    )
  }
  return statusCache.get(projectSlug)!
}

function useTranslateStatus(projectSlug: string | undefined) {
  // Keyed by slug, so a stale answer for another project is never shown.
  const [state, setState] = useState<{ slug: string; status: StatusOk | null } | null>(null)
  const status = projectSlug && state?.slug === projectSlug ? state.status : null
  useEffect(() => {
    if (!projectSlug) return
    let alive = true
    fetchStatus(projectSlug).then((s) => {
      if (alive) setState({ slug: projectSlug, status: s })
    })
    return () => {
      alive = false
    }
  }, [projectSlug])

  /** After a translation, fold the new month-to-date into the shared cache. */
  const update = (monthToDate: number, quota: number | null) => {
    if (!projectSlug || !status) return
    const next: StatusOk = {
      ...status,
      monthToDate,
      quota,
      quotaReached: quota !== null && monthToDate >= quota,
    }
    statusCache.set(projectSlug, Promise.resolve(next))
    setState({ slug: projectSlug, status: next })
  }
  return { status, update }
}

function hasText(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

const styles = {
  bar: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    fontSize: 12,
  },
  button: (disabled: boolean) => ({
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 4,
    border: '1px solid #c9ced6',
    background: disabled ? '#f4f5f7' : '#fff',
    color: disabled ? '#9aa1ab' : '#1f2937',
    cursor: disabled ? 'not-allowed' : 'pointer',
  }),
  select: { fontSize: 12, padding: '3px 4px', borderRadius: 4, border: '1px solid #c9ced6' },
  chip: (tone: 'machine' | 'reviewed') => ({
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    padding: '2px 6px',
    borderRadius: 3,
    background: tone === 'machine' ? '#fff4e0' : '#e6f4ea',
    color: tone === 'machine' ? '#8a5a00' : '#1e6b34',
  }),
  link: {
    fontSize: 11,
    background: 'none',
    border: 'none',
    padding: 0,
    color: '#2563eb',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  note: (tone: 'info' | 'error') => ({
    flexBasis: '100%',
    fontSize: 11,
    color: tone === 'error' ? '#b42318' : '#5b6472',
  }),
}

export function TranslateBar({
  props,
  locales: studioLocales,
}: {
  props: ObjectInputProps
  /** The site's languages, default first (useProjectLocales order). */
  locales: SupportedLocale[]
}) {
  const t = getTranslateMessages(STUDIO_UI_LOCALE)
  const projectSlug = useFormValue(['projectSlug']) as string | undefined
  const documentId = useFormValue(['_id']) as string | undefined
  const { status, update } = useTranslateStatus(projectSlug)
  // Only the languages the site really offers (server-confirmed), in the
  // Studio's order. Never the all-platform fallback useProjectLocales uses
  // when siteConfig is missing — that would translate into seven languages.
  const offered = status?.supportedLocales ?? []
  const locales = studioLocales.filter((code) => offered.includes(code))

  const value = (props.value ?? {}) as Record<string, unknown>
  const statusMap = (value.translationStatus ?? {}) as TranslationStatusMap

  const withText = locales.filter((code) => hasText(value[code]))
  const [chosenSource, setChosenSource] = useState<SupportedLocale | null>(null)
  const source: SupportedLocale | undefined =
    chosenSource && withText.includes(chosenSource) ? chosenSource : withText[0] ?? locales[0]

  const targets = locales.filter(
    (code) => code !== source && isWritableTarget(value[code], statusMap[code])
  )

  // The latest value, for re-checking targets after the request returns: an
  // editor may have typed into a target language while it was in flight.
  const latestValue = useRef(value)
  useEffect(() => {
    latestValue.current = value
  })

  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  // ── machine → reviewed on hand edit (ADR-023 decision 5) ──────────────────
  // Only for edits made during this session: opening a document must never
  // create a draft by itself.
  const initialValue = useRef(props.value)
  useEffect(() => {
    if (props.readOnly || props.value === initialValue.current) return
    const edited = localesToMarkReviewed(value, statusMap)
    if (edited.length === 0) return
    props.onChange(edited.map((code) => set('reviewed', ['translationStatus', code, 'status'])))
  }, [props.value]) // eslint-disable-line react-hooks/exhaustive-deps

  const chips = locales
    .map((code) => ({ code, st: effectiveStatus(value[code], statusMap[code]) }))
    .filter((c): c is { code: SupportedLocale; st: 'machine' | 'reviewed' } => c.st !== 'original')

  // Module not enabled for this project (or status unknown): render nothing.
  if (!status || !status.enabled || locales.length < 2) return null

  const blockedReason = !status.providerConfigured
    ? t.errors.provider_not_configured
    : status.quotaReached
      ? t.errors.quota_reached
      : null
  const disabled = busy || props.readOnly === true || blockedReason !== null || !source

  async function onTranslate() {
    if (!source) return
    const sourceText = value[source]
    if (!hasText(sourceText)) {
      setNote({ tone: 'info', text: formatTranslateMessage(t.nothingToTranslate, { source: source.toUpperCase() }) })
      return
    }
    if (targets.length === 0) {
      setNote({ tone: 'info', text: t.allTargetsProtected })
      return
    }
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectSlug,
          sourceLocale: source,
          targetLocales: targets,
          texts: [sourceText],
          format: 'text',
          documentId,
        }),
      })
      const body = (await res.json()) as TranslateResponseBody
      if (!body.ok) {
        setNote({ tone: 'error', text: t.errors[body.error] ?? t.errors.provider_error })
        if (body.error === 'quota_reached' && status) update(status.quota ?? 0, status.quota)
        return
      }
      const provider: TranslationProviderId = body.provider
      const written: SupportedLocale[] = []
      const patches: FormPatch[] = [
        setIfMissing({ _type: props.schemaType.name }),
        setIfMissing({ _type: 'translationStatus' }, ['translationStatus']),
      ]
      const now = latestValue.current
      const nowStatus = (now.translationStatus ?? {}) as TranslationStatusMap
      for (const target of targets) {
        const text = body.translations[target]?.[0]
        if (typeof text !== 'string') continue
        // Typed into while we waited? Then it is a person's text now — keep it.
        if (!isWritableTarget(now[target], nowStatus[target])) continue
        written.push(target)
        patches.push(set(text, [target]))
        patches.push(
          set(machineMeta({ text, source: sourceText, sourceLocale: source, provider }), [
            'translationStatus',
            target,
          ])
        )
      }
      update(body.usage.monthToDate, body.usage.quota)
      if (written.length === 0) {
        setNote({ tone: 'info', text: t.allTargetsProtected })
        return
      }
      props.onChange(patches)
      setNote({
        tone: 'info',
        text: formatTranslateMessage(t.translated, {
          targets: written.map((c) => c.toUpperCase()).join(', '),
        }),
      })
    } catch {
      setNote({ tone: 'error', text: t.errors.network_error })
    } finally {
      setBusy(false)
    }
  }

  function markReviewed(code: SupportedLocale) {
    props.onChange(set('reviewed', ['translationStatus', code, 'status']))
  }

  const usage =
    status.monthToDate === null
      ? null
      : status.quota !== null
        ? formatTranslateMessage(t.usageWithQuota, {
            used: status.monthToDate.toLocaleString('en'),
            quota: status.quota.toLocaleString('en'),
          })
        : formatTranslateMessage(t.usageNoQuota, { used: status.monthToDate.toLocaleString('en') })

  return (
    <div style={styles.bar}>
      {withText.length > 1 && (
        <select
          aria-label={t.sourceLabel}
          style={styles.select}
          value={source}
          disabled={busy}
          onChange={(e) => setChosenSource(e.target.value as SupportedLocale)}
        >
          {withText.map((code) => (
            <option key={code} value={code}>
              {code.toUpperCase()}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        style={styles.button(disabled)}
        disabled={disabled}
        onClick={onTranslate}
        title={usage ?? undefined}
      >
        {busy
          ? t.translating
          : formatTranslateMessage(t.translateFrom, { source: (source ?? '').toUpperCase() })}
      </button>
      {chips.map(({ code, st }) => (
        <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={styles.chip(st)}>
            {code.toUpperCase()} · {st === 'machine' ? t.statusMachine : t.statusReviewed}
          </span>
          {st === 'machine' && !props.readOnly && (
            <button type="button" style={styles.link} onClick={() => markReviewed(code)}>
              {t.markReviewed}
            </button>
          )}
        </span>
      ))}
      {blockedReason && <div style={styles.note('error')}>{blockedReason}</div>}
      {note && <div style={styles.note(note.tone)}>{note.text}</div>}
    </div>
  )
}
