/**
 * Digital Cards — permissions, error class and the ADR-032 lifecycle
 * descriptor (ADR-049 D6).
 *
 *   PUBLISH   a person card needs its person and a valid URL name; at most
 *             one shown Primary Action (digital-cards.ts → `publish_blocked`,
 *             `detail.missing` names what to fix).
 *   ARCHIVE   always allowed: nothing references a card (D6 — an offline card
 *             redirects, it never dead-ends).
 *   DELETE    a never-published draft is the WRITE permission; PERMANENT delete
 *             (archived cards) additionally needs digital-cards.delete (owner).
 *             Statistics rows age out with the 13-month sweep (D11).
 *
 * The error class lives here (not in digital-cards.ts) so the descriptor can
 * build it without a circular import.
 */
import type { LifecycleDescriptor, LifecycleErrorCode } from '@/lib/lifecycle/service'
import { DIGITAL_CARD_PERMISSIONS, DIGITAL_CARD_TYPE } from '@/lib/modules/digital-cards/model'

export const DIGITAL_CARD_READ_PERMISSION = DIGITAL_CARD_PERMISSIONS.read
export const DIGITAL_CARD_WRITE_PERMISSION = DIGITAL_CARD_PERMISSIONS.write
export const DIGITAL_CARD_DELETE_PERMISSION = DIGITAL_CARD_PERMISSIONS.delete
export const DIGITAL_CARD_STATS_PERMISSION = DIGITAL_CARD_PERMISSIONS.statsRead

/** What a publish can be blocked by (the editor links each one to its section). */
export type DigitalCardMissing = 'person' | 'urlName' | 'primary' | 'links'

export type DigitalCardErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_field'
  | 'invalid_value'
  | 'too_large'
  | 'conflict'
  | 'in_use'
  | 'archive_first'
  | 'archived'
  /** The project already has a site card (D2: one per project). */
  | 'site_exists'
  /** The person already has a card. */
  | 'person_has_card'
  /** The person is not this project's, or is off / anonymised / archived. */
  | 'person_not_found'
  /** The URL name is used (now or before) by another card of this project. */
  | 'url_name_taken'
  /** Publish refused; `detail.missing` lists what is missing. */
  | 'publish_blocked'
  | 'failed'

export class DigitalCardError extends Error {
  constructor(
    readonly code: DigitalCardErrorCode,
    message: string,
    readonly detail?: { missing?: DigitalCardMissing[]; field?: string }
  ) {
    super(message)
    this.name = 'DigitalCardError'
  }
}

const DIGITAL_CARD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function isDigitalCardId(id: unknown): id is string {
  return typeof id === 'string' && DIGITAL_CARD_ID.test(id)
}

const CODE: Record<LifecycleErrorCode, DigitalCardErrorCode> = {
  forbidden: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  invalid_value: 'invalid_value',
  archived: 'archived',
  archive_first: 'archive_first',
  in_use: 'in_use',
  unpublished_dependencies: 'failed',
  failed: 'failed',
}

const fail = (code: LifecycleErrorCode, message: string) => new DigitalCardError(CODE[code], message)

export const DIGITAL_CARD_LIFECYCLE: LifecycleDescriptor = {
  type: DIGITAL_CARD_TYPE,
  rule: 'optional',
  permissions: {
    write: DIGITAL_CARD_WRITE_PERMISSION,
    delete: DIGITAL_CARD_WRITE_PERMISSION,
    deletePublished: DIGITAL_CARD_DELETE_PERMISSION,
  },
  isId: isDigitalCardId,
  fail,
  label: (doc) => (doc.kind === 'site' ? 'Site card' : typeof doc.urlName === 'string' && doc.urlName ? `/card/${doc.urlName}` : 'Person card'),
}
