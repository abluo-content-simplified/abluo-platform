// @vitest-environment jsdom
/**
 * The person's Activity sheet (ADR-043 · ADR-032 D9): loads through the server
 * action only while open, shows who did what and when, an empty state, and a
 * retry after a failure.
 */
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { click, mount, type Mounted } from '@/components/app/ui/__tests__/intl-dom'

vi.mock('next-intl', async () => {
  const u = await import('use-intl')
  return { ...u, NextIntlClientProvider: u.IntlProvider }
})
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
const a = vi.hoisted(() => ({ getPersonActivityAction: vi.fn() }))
vi.mock('@/app/[locale]/(client)/[tenant]/people/actions', () => a)

import { PersonActivitySheet } from '../PersonActivitySheet'

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as { showModal: () => void; close: () => void }
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  a.getPersonActivityAction.mockReset()
})
const flush = () => act(async () => void (await Promise.resolve()))
const ui = (open: boolean) => <PersonActivitySheet open={open} onClose={() => {}} projectSlug="cyce" personId="anna" />

describe('PersonActivitySheet', () => {
  it('does not load while closed, then lists what happened', async () => {
    a.getPersonActivityAction.mockResolvedValue({
      ok: true,
      items: [
        { id: '1', action: 'published', at: '2026-11-03T09:30:00Z', actor: { kind: 'person', name: 'Tom' } },
        { id: '2', action: 'created', at: '2026-11-02T08:00:00Z', actor: { kind: 'system' } },
      ],
    })
    m = mount(ui(false))
    expect(a.getPersonActivityAction).not.toHaveBeenCalled()
    m.rerender(ui(true))
    await flush()
    await flush()
    expect(a.getPersonActivityAction).toHaveBeenCalledWith({ projectSlug: 'cyce', id: 'anna' })
    const text = document.body.textContent ?? ''
    expect(text).toContain('Published')
    expect(text).toContain('by Tom')
    expect(text).toContain('Created')
  })

  it('says so when nothing happened yet, and offers a retry after a failure', async () => {
    a.getPersonActivityAction.mockResolvedValueOnce({ ok: false, error: 'failed' }).mockResolvedValueOnce({ ok: true, items: [] })
    m = mount(ui(true))
    await flush()
    await flush()
    expect(document.body.textContent).toContain("Couldn't load the activity.")
    click(Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Try again') ?? null)
    await flush()
    await flush()
    expect(a.getPersonActivityAction).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('No activity yet.')
  })
})
