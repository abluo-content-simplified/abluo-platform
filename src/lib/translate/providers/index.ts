import type { TranslationProviderId } from '../types'
import { createClaudeProvider } from './claude'
import { createDeepLProvider } from './deepl'
import { createGoogleProvider } from './google'
import type { TranslationProvider } from './types'

export type { TranslationProvider } from './types'

/** Server-side only: adapters read their API keys from process.env. */
export function getTranslationProvider(id: TranslationProviderId): TranslationProvider {
  switch (id) {
    case 'google':
      return createGoogleProvider()
    case 'deepl':
      return createDeepLProvider()
    case 'claude':
      return createClaudeProvider()
  }
}
