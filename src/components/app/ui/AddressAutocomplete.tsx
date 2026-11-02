'use client'

import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { TextInput } from './TextInput'
import { ADDRESS_MIN_QUERY, parsePlaceDetails, parseSuggestions, type AddressSuggestion, type ParsedAddress } from './address-model'

/**
 * Where suggestions come from. The default asks Google Places API (New) from
 * the browser with NEXT_PUBLIC_GOOGLE_MAPS_DASHBOARD_KEY (else NEXT_PUBLIC_GOOGLE_MAPS_KEY);
 * demos and tests pass their own.
 * Both calls may throw or return empty — the field then is a plain text input.
 */
export type AddressProvider = {
  search: (input: string, sessionToken: string, languageCode: string) => Promise<AddressSuggestion[]>
  details: (placeId: string, sessionToken: string, languageCode: string) => Promise<ParsedAddress | null>
}

// The dashboard key (ADR-038: Places API (New), referrer-restricted) when set; else the website key.
// Each env var is read literally so Next inlines it into the client bundle.
const GOOGLE_KEY = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_DASHBOARD_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '').trim()
const PLACES = 'https://places.googleapis.com/v1'

function googlePlaces(key: string): AddressProvider {
  return {
    async search(input, sessionToken, languageCode) {
      const res = await fetch(`${PLACES}/places:autocomplete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
        body: JSON.stringify({ input, sessionToken, languageCode }),
      })
      return res.ok ? parseSuggestions(await res.json()) : []
    },
    async details(placeId, sessionToken, languageCode) {
      const qs = new URLSearchParams({ sessionToken, languageCode })
      const res = await fetch(`${PLACES}/places/${encodeURIComponent(placeId)}?${qs}`, {
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'addressComponents' },
      })
      return res.ok ? parsePlaceDetails(await res.json()) : null
    },
  }
}

const DEFAULT_PROVIDER: AddressProvider | null = GOOGLE_KEY ? googlePlaces(GOOGLE_KEY) : null
const DEBOUNCE_MS = 300

function newSessionToken(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/**
 * A street-address text field with suggestions (combobox). Typing ≥ 3
 * characters asks for suggestions (debounced); picking one fills the field
 * with the street line and calls `onSelect` with the parsed address
 * (line 1, postal code, city, region, ISO country) so the form can fill the
 * other fields. Without a key, or when a request fails, it is a plain input.
 * Arrow keys move, Enter picks, Escape closes.
 *
 *   <Field label="Address">{(p) => <AddressAutocomplete {...p} value={line1} onChange={setLine1} onSelect={fill} />}</Field>
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  provider = DEFAULT_PROVIDER,
  ...rest
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'onSelect' | 'role'> & {
  value: string
  onChange: (value: string) => void
  /** The picked place, parsed. `addressLine1` falls back to the suggestion's main line. */
  onSelect?: (address: ParsedAddress) => void
  /** Suggestion source; defaults to Google Places when a Maps key is set, else none. */
  provider?: AddressProvider | null
}) {
  const t = useTranslations('app.ui.addressAutocomplete')
  const locale = useLocale()
  const listId = useId()
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [active, setActive] = useState(-1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const session = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const open = suggestions.length > 0
  const close = () => {
    seq.current += 1
    setSuggestions([])
    setActive(-1)
  }

  function schedule(input: string) {
    if (timer.current) clearTimeout(timer.current)
    if (!provider || input.trim().length < ADDRESS_MIN_QUERY) {
      close()
      return
    }
    timer.current = setTimeout(() => {
      const mine = ++seq.current
      session.current ??= newSessionToken()
      provider
        .search(input.trim(), session.current, locale)
        .then((list) => {
          if (mine !== seq.current) return
          setSuggestions(list)
          setActive(-1)
        })
        .catch(() => {
          if (mine === seq.current) setSuggestions([])
        })
    }, DEBOUNCE_MS)
  }

  function pick(s: AddressSuggestion) {
    if (timer.current) clearTimeout(timer.current)
    close()
    onChange(s.primary)
    const token = session.current ?? newSessionToken()
    session.current = null // the session ends with the details request
    if (!provider || !onSelect) return
    provider
      .details(s.placeId, token, locale)
      .then((place) => {
        if (place) onSelect({ ...place, addressLine1: place.addressLine1 ?? s.primary })
      })
      .catch(() => {})
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(suggestions[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const optionId = (i: number) => `${listId}-option-${i}`
  return (
    <div className="relative">
      <TextInput
        {...rest}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        autoComplete={rest.autoComplete ?? 'off'}
        onChange={(e) => {
          onChange(e.target.value)
          schedule(e.target.value)
        }}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          close()
          rest.onBlur?.(e)
        }}
      />
      <div
        hidden={!open}
        className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[var(--shadow-raise)]"
      >
        <ul id={listId} role="listbox" aria-label={t('suggestions')} className="max-h-72 overflow-y-auto py-1">
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // mousedown keeps focus in the input (no blur before the pick)
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2.5 ${i === active ? 'bg-hover' : ''}`}
            >
              <span className="block truncate text-[0.9375rem] font-medium text-foreground">{s.primary}</span>
              {s.secondary ? <span className="block truncate text-xs text-muted-foreground">{s.secondary}</span> : null}
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-3 py-1.5 text-right text-xs text-muted-foreground">{t('attribution')}</p>
      </div>
    </div>
  )
}
