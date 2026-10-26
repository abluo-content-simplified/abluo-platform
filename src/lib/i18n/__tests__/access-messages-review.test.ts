/**
 * Website Access text awaiting a native-speaker review (Tom, 2026-10-24).
 * Warns on every run, never fails — like interface-translations.test.ts.
 * Fails only if the list names a language that has no text at all.
 */
import { describe, it, expect } from 'vitest'
import { ACCESS_MESSAGES_FOR_TEST, ACCESS_MESSAGES_PENDING_REVIEW } from '@/lib/i18n/access-messages'

describe('Access website text — review status', () => {
  it('lists the languages still awaiting review', () => {
    for (const code of ACCESS_MESSAGES_PENDING_REVIEW) expect(ACCESS_MESSAGES_FOR_TEST[code], code).toBeDefined()
    if (ACCESS_MESSAGES_PENDING_REVIEW.length > 0) {
      console.warn(`[i18n] Access website text awaiting native review: ${ACCESS_MESSAGES_PENDING_REVIEW.join(', ')} (src/lib/i18n/access-messages.ts)`)
    }
  })
})
