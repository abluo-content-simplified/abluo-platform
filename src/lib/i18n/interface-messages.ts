/**
 * The interface message bundles, imported statically so a server page can
 * read them on Vercel without file tracing. One entry per INTERFACE_LOCALES
 * code — the Record type makes a forgotten language a type error, and
 * interface-locales.test.ts keeps INTERFACE_LOCALES equal to messages/*.json.
 */
import en from '../../../messages/en.json'
import it from '../../../messages/it.json'
import de from '../../../messages/de.json'
import statusFile from './interface-translation-status.json'
import { INTERFACE_LOCALES, type InterfaceLocale } from './locales'
import type { TranslationStatusFile } from './translation-report'

const BUNDLES: Record<InterfaceLocale, Record<string, unknown>> = { en, it, de }

/** Bundles in INTERFACE_LOCALES order (English first). */
export function interfaceBundles(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(INTERFACE_LOCALES.map((l) => [l, BUNDLES[l]]))
}

export function interfaceTranslationStatus(): TranslationStatusFile {
  return statusFile as TranslationStatusFile
}
