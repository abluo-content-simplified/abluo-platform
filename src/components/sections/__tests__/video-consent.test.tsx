import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VideoSection } from '@/components/sections/VideoSection'
import { ConsentProvider } from '@/components/consent/ConsentProvider'
import { allowVendor, applyChoice, deriveConsentPolicy, type ConsentRecord } from '@/lib/consent'
import type { VideoSection as VideoSectionType } from '@/lib/sanity/types'

// ADR-021 amendment 2026-10-05 — third-party players are click-to-load until
// the visitor accepts External content (or always-allows the vendor). Before
// that the server HTML has the placeholder only: no iframe, no embed URL.

const section = (extra: Partial<VideoSectionType>) =>
  ({ _type: 'videoSection', _key: 'v', title: 'Our studio', ...extra }) as VideoSectionType

const bare = (s: VideoSectionType, locale = 'en') =>
  renderToStaticMarkup(<VideoSection section={s} surface={'usePagePattern' as never} designSystem={null} locale={locale} />)

const policy = deriveConsentPolicy(undefined, [
  { id: 'youtube', name: 'YouTube' },
  { id: 'vimeo', name: 'Vimeo' },
  { id: 'cloudflare-stream', name: 'Cloudflare Stream' },
])

const withRecord = (s: VideoSectionType, record: ConsentRecord | null) =>
  renderToStaticMarkup(
    <ConsentProvider cookieName="abluo_consent_t" policy={policy} record={record} showBanner={false} requiresConsent locale="en">
      <VideoSection section={s} surface={'usePagePattern' as never} designSystem={null} locale="en" />
    </ConsentProvider>,
  )

const cases: [string, Partial<VideoSectionType>, string, string][] = [
  ['youtube', { provider: 'youtube', videoId: 'dQw4w9WgXcQ' }, 'dQw4w9WgXcQ', 'YouTube'],
  ['vimeo', { provider: 'vimeo', videoId: '76979871' }, '76979871', 'Vimeo'],
  ['cloudflare', { provider: 'cloudflare', videoId: 'cfuid123' }, 'cfuid123', 'Cloudflare Stream'],
  ['generic url', { provider: 'url', videoUrl: 'https://player.twitch.tv/?video=42' }, 'video=42', 'player.twitch.tv'],
]

describe('VideoSection — behind consent', () => {
  for (const [name, s, needle, vendor] of cases) {
    it(`${name}: placeholder, no iframe and no embed URL before consent`, () => {
      const out = bare(section(s))
      expect(out).toContain('>Show video<')
      expect(out).toContain(`Always allow ${vendor}`)
      expect(out).not.toContain('<iframe')
      expect(out).not.toContain(needle)
    })
  }

  it('placeholder text is localized', () => {
    const out = bare(section({ provider: 'vimeo', videoId: '1' }), 'fr')
    expect(out).toContain('Afficher la vidéo')
    expect(out).toContain('Toujours autoriser Vimeo')
  })

  it('External content accepted → every listed vendor renders its iframe, privacy-enhanced', () => {
    const rec = applyChoice(null, policy, { externalContent: true })
    const yt = withRecord(section({ provider: 'youtube', videoId: 'dQw4w9WgXcQ' }), rec)
    expect(yt).toContain('<iframe')
    expect(yt).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(yt).not.toContain('Show video')
    const vm = withRecord(section({ provider: 'vimeo', videoId: '76979871' }), rec)
    expect(vm).toContain('https://player.vimeo.com/video/76979871?dnt=1')
    const cf = withRecord(section({ provider: 'cloudflare', videoId: 'cfuid123' }), rec)
    expect(cf).toContain('cloudflarestream.com/cfuid123/iframe')
  })

  it('a host the banner did not list stays behind its placeholder even with the purpose granted', () => {
    const rec = applyChoice(null, policy, { externalContent: true })
    const out = withRecord(section({ provider: 'url', videoUrl: 'https://player.twitch.tv/?video=42' }), rec)
    expect(out).not.toContain('<iframe')
  })

  it('per-vendor "always allow" loads only that vendor', () => {
    const rec = allowVendor(applyChoice(null, policy, {}), 'vimeo')
    expect(withRecord(section({ provider: 'vimeo', videoId: '1' }), rec)).toContain('<iframe')
    expect(withRecord(section({ provider: 'youtube', videoId: 'dQw4w9WgXcQ' }), rec)).not.toContain('<iframe')
  })

  it('direct video files need no consent', () => {
    const out = bare(section({ provider: 'url', videoUrl: 'https://cdn.sanity.io/files/p/d/clip.mp4' }))
    expect(out).toContain('<video')
    expect(out).not.toContain('Show video')
  })
})
