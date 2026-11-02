/**
 * ADR-042 shared sidebar components: accessible names, disclosure semantics,
 * aggregated badges, and the shell's per-layout CSS contract.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarCollapseToggle } from '../SidebarCollapseToggle'
import { SidebarGroup } from '../SidebarGroup'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')

describe('SidebarGroup', () => {
  it('open: a disclosure button with aria-expanded=true controlling a visible group', () => {
    const html = renderToStaticMarkup(
      <SidebarGroup id="g" label="Catalogue" open onOpenChange={() => undefined}>
        <a href="#x">Items</a>
      </SidebarGroup>,
    )
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-controls="g-items"/)
    expect(html).not.toMatch(/hidden=""/)
  })

  it('closed: destinations are hidden (out of tab order and screen readers) and the aggregated badge stays on the heading', () => {
    const html = renderToStaticMarkup(
      <SidebarGroup id="g" label="Visitors" open={false} onOpenChange={() => undefined} badge={{ count: 4, label: '4 unanswered requests' }}>
        <a href="#x">Contact Requests</a>
      </SidebarGroup>,
    )
    expect(html).toMatch(/aria-expanded="false"/)
    expect(html).toMatch(/id="g-items"[^>]*hidden=""/)
    expect(html).toContain('4 unanswered requests')
  })

  it('open: no badge on the heading (the destinations carry their own)', () => {
    const html = renderToStaticMarkup(
      <SidebarGroup id="g" label="Visitors" open onOpenChange={() => undefined} badge={{ count: 4, label: '4 unanswered requests' }}>
        <a href="#x">Contact Requests</a>
      </SidebarGroup>,
    )
    expect(html).not.toContain('4 unanswered requests')
  })
})

describe('SidebarCollapseToggle', () => {
  it('its label is the accessible name, whichever way it points', () => {
    expect(renderToStaticMarkup(<SidebarCollapseToggle collapsed={false} label="Collapse Sidebar" onToggle={() => undefined} />)).toMatch(/aria-label="Collapse Sidebar"/)
    expect(renderToStaticMarkup(<SidebarCollapseToggle collapsed label="Expand Sidebar" onToggle={() => undefined} />)).toMatch(/aria-label="Expand Sidebar"/)
  })
})

describe('rail and frame contract', () => {
  it('RailItem names its control by the label (plus the badge text) and shows the tooltip on hover and focus, Escape hides it', () => {
    const src = read('src/components/app/ui/RailItem.tsx')
    expect(src).toMatch(/aria-label=\{name\}/)
    expect(src).toMatch(/onMouseEnter: show/)
    expect(src).toMatch(/onFocus: show/)
    expect(src).toMatch(/e\.key === 'Escape'/)
    expect(src).toMatch(/aria-current=\{active \? 'page'/)
  })

  it('RailFlyout closes on Escape (focus back to the icon), outside press, and a chosen destination', () => {
    const src = read('src/components/app/ui/RailFlyout.tsx')
    expect(src).toMatch(/e\.key === 'Escape'/)
    expect(src).toMatch(/dismiss\(true\)/)
    expect(src).toMatch(/pointerdown/)
    expect(src).toMatch(/closest\('a'\)/)
  })

  it('the layout follows each layout preference separately: tablet (md to lg) and desktop (lg+)', () => {
    const layout = read('src/app/[locale]/(client)/[tenant]/layout.tsx')
    expect(layout).toMatch(/md:group-data-\[nav-t=rail\]\/nav:max-lg:ml-14/)
    expect(layout).toMatch(/lg:group-data-\[nav-d=rail\]\/nav:ml-14/)
    const frame = read('src/components/app/shell/AppSidebar.tsx')
    expect(frame).toMatch(/md:group-data-\[nav-t=rail\]\/nav:max-lg:w-14/)
    expect(frame).toMatch(/lg:group-data-\[nav-d=rail\]\/nav:w-14/)
  })

  it('the admin frame is unchanged: it passes no `collapsible`, so it never renders a rail', () => {
    expect(read('src/components/admin/AdminSidebar.tsx')).not.toMatch(/collapsible/)
  })

  it('the server reads the remembered state, so the first paint matches (no flash)', () => {
    const layout = read('src/app/[locale]/(client)/[tenant]/layout.tsx')
    expect(layout).toMatch(/parseNavPreferences\(jar\.get\(APP_NAV_COOKIE\)/)
    expect(layout).toMatch(/<SidebarStateProvider initial=\{navPrefs\}/)
  })
})
