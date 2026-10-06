import { LOCALE_CODES } from '@/lib/i18n/locales'

/**
 * The platform languages a localized array field (e.g. `body`) has content in,
 * as an array with a code where it is non-empty and null elsewhere — callers
 * drop the nulls. GROQ has no "keys of an object", so the static platform
 * registry is spelled out (no tenant identity is interpolated).
 */
export const presentLocales = (field: string) =>
  `[${LOCALE_CODES.map((c) => `select(count(${field}.${c}) > 0 => "${c}")`).join(', ')}]`

/**
 * The plain text of a localized Portable Text field (e.g. `body`) per platform
 * language: `{ "en": "…", "it": null, … }` (null where that language is empty).
 * Used for the dashboard's posts search; the caller caps the length.
 */
export const localePlainTexts = (field: string) =>
  `{${LOCALE_CODES.map((c) => `"${c}": select(count(${field}.${c}) > 0 => pt::text(${field}.${c}))`).join(', ')}}`
