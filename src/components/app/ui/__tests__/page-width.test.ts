/**
 * One content width (PAGE_WIDTH): it grows by the space the desktop nav frees
 * when collapsed to its rail (ADR-042), and the notices above the page in the
 * client shell use it, so they line up with the page instead of the monitor.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAGE_WIDTH } from '../PageShell'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')

describe('PAGE_WIDTH', () => {
  it('is 6xl, and on computers with the nav collapsed grows by expanded (w-64) minus rail (w-14) = 12.5rem', () => {
    expect(PAGE_WIDTH).toContain('max-w-6xl')
    expect(PAGE_WIDTH).toContain('lg:group-data-[nav-d=rail]/nav:max-w-[calc(72rem+12.5rem)]')
    // Phones and tablets unchanged: no tablet-rail variant.
    expect(PAGE_WIDTH).not.toContain('nav-t=')
    const layout = read('src/app/[locale]/(client)/[tenant]/layout.tsx')
    expect(layout).toMatch(/md:ml-64[^"]*lg:group-data-\[nav-d=rail\]\/nav:ml-14/)
  })

  it('the client shell notices share the page width', () => {
    const layout = read('src/app/[locale]/(client)/[tenant]/layout.tsx')
    expect(layout).toMatch(/<SupportReplyNotice[^>]*PAGE_WIDTH/)
    expect(layout).toMatch(/<NewVersionNotice[^>]*PAGE_WIDTH/)
    expect(read('src/components/client/support/SupportAccessNotice.tsx')).toContain('PAGE_WIDTH')
    expect(read('src/components/client/whats-new/AnnouncementBanners.tsx')).toContain('PAGE_WIDTH')
  })
})
