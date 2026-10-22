import { describe, expect, it, vi } from 'vitest'
vi.mock('../notifications', () => ({ sweepTicketOutbox: vi.fn(async () => ({ processed: 0, outcomes: {} })) }))
import { scheduleTicketNotifications } from '../notify'

describe('scheduleTicketNotifications', () => {
  it('never throws outside a request scope', () => {
    expect(() => scheduleTicketNotifications()).not.toThrow()
  })
})
