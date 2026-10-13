#!/usr/bin/env node
/**
 * Horizontal-overflow audit — every page, every language, at phone widths.
 *
 * A word longer than its column does not wrap by default: it overflows, and the
 * whole page scrolls sideways. German compounds make this routine, but it is
 * not language-specific — the first run of this script (2026-10-13, before the
 * Worttrennung rule in globals.css) found all seven languages failing.
 *
 *   node scripts/audit-overflow.mjs                 # every live domain
 *   node scripts/audit-overflow.mjs https://host    # one origin
 *
 * URLs come from each origin's own sitemap.xml, so the audit grows with the
 * sites. Exit code 1 when any page overflows, so this can gate a release.
 *
 * ── Reading the output ──────────────────────────────────────────────────────
 * Two kinds of element show up and only one is a cause:
 *   - a real offender: visible text wider than the viewport (an <h1>, a <span>
 *     inside one, a <strong> in body copy);
 *   - a victim: anything `fixed inset-x-0` (the header, the cookie banner).
 *     Those stretch to the ALREADY-overflowed width, so they appear in the
 *     report without causing anything. Fix the offenders; the victims go away.
 * Elements inside a closed off-canvas panel are filtered out — a drawer parked
 * off-screen is not a defect.
 *
 * ── Why a browser ───────────────────────────────────────────────────────────
 * This is layout, and jsdom has none. NOTE: headless Chromium ships no
 * hyphenation dictionaries — `hyphens: auto` is inert here, verified with a
 * control. So this script measures whether a page OVERFLOWS, which is exactly
 * what it is for, and it cannot tell you whether a break is hyphenated. Judge
 * that in a real browser.
 */
import { chromium } from 'playwright'

const DOMAINS = [
  'nologo.cloud', 'studiomartegani.com', 'ch-psicoterapeuta.com',
  'tmz.it', 'ameliez.com', 'cyce.info', 'abluo.app',
]
const WIDTHS = [320, 390]
const CONCURRENCY = 6
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const origins = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DOMAINS.map((d) => `https://www.${d}`)

const urls = []
for (const origin of origins) {
  try {
    const xml = await fetch(`${origin}/sitemap.xml`).then((r) => r.text())
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    urls.push(...locs)
    console.log(`${origin}: ${locs.length} urls`)
  } catch {
    console.log(`${origin}: sitemap unreachable, skipped`)
  }
}

/** Runs in the page. Returns null when the page does not overflow. */
const probe = () => {
  const docW = document.documentElement.clientWidth
  const scrollW = document.documentElement.scrollWidth
  if (scrollW <= docW + 1) return null
  const parked = (el) => {
    for (let p = el; p; p = p.parentElement) {
      if (p.getAttribute?.('aria-hidden') === 'true' || p.hasAttribute?.('inert')) return true
      const cs = getComputedStyle(p)
      if (cs.visibility === 'hidden' || cs.display === 'none') return true
      const m = cs.transform && cs.transform !== 'none' && cs.transform.match(/matrix\(([^)]+)\)/)
      if (m && Math.abs(Number(m[1].split(',')[4])) > 50) return true
    }
    return false
  }
  const bad = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if (r.right <= docW + 1 && r.left >= -1) continue
    if (parked(el)) continue
    let childOverflows = false
    for (const c of el.children) {
      const cr = c.getBoundingClientRect()
      if (cr.width && cr.height && (cr.right > docW + 1 || cr.left < -1) && !parked(c)) { childOverflows = true; break }
    }
    if (childOverflows) continue
    const cs = getComputedStyle(el)
    bad.push({
      tag: el.tagName.toLowerCase(), width: Math.round(r.width), right: Math.round(r.right),
      fontSize: cs.fontSize, hyphens: cs.hyphens, overflowWrap: cs.overflowWrap,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    })
  }
  bad.sort((a, b) => b.right - a.right)
  return { docW, scrollW, over: scrollW - docW, lang: document.documentElement.lang, bad: bad.slice(0, 5) }
}

const browser = await chromium.launch()
const failures = []
let next = 0
const worker = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE })
  const page = await ctx.newPage()
  for (let i = next++; i < urls.length; i = next++) {
    for (const w of WIDTHS) {
      try {
        await page.setViewportSize({ width: w, height: 844 })
        await page.goto(urls[i], { waitUntil: 'load', timeout: 45000 })
        await page.waitForTimeout(900)
        const r = await page.evaluate(probe)
        if (r) failures.push({ url: urls[i], w, ...r })
      } catch (e) {
        failures.push({ url: urls[i], w, error: String(e).split('\n')[0].slice(0, 120) })
      }
    }
  }
  await ctx.close()
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
await browser.close()

failures.sort((a, b) => a.url.localeCompare(b.url) || a.w - b.w)
for (const f of failures) {
  if (f.error) { console.log(`\nERROR ${f.url} @${f.w}  ${f.error}`); continue }
  console.log(`\n${f.url} @${f.w}px  lang=${f.lang}  overflows by ${f.over}px`)
  for (const b of f.bad) console.log(`   <${b.tag}> ${b.width}px right=${b.right} ${b.fontSize} hyphens=${b.hyphens} :: ${JSON.stringify(b.text)}`)
}
console.log(`\n${urls.length} urls x ${WIDTHS.length} widths — ${failures.length} failing`)
process.exit(failures.length ? 1 : 0)
