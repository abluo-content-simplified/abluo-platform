import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { SOCIAL_PLATFORMS, cleanSocialUrl, shortUrl, socialRowsFromStored, toStoredSocialLinks } from '../social-links'
import { parseSettingsSet } from '../paths'

describe('social profiles (Settings → Social Profiles)', () => {
  it('the platforms are exactly the socialLink options of the schema', () => {
    const schema = readFileSync(path.join(process.cwd(), 'src/lib/sanity/schema.ts'), 'utf8')
    const block = schema.slice(schema.indexOf("name: 'socialLink'"))
    const list = block.match(/options: \{ list: \[([^\]]+)\]/)![1]
    expect(list.split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...SOCIAL_PLATFORMS])
  })

  it('accepts https addresses on the platform, adds https:// to a bare address', () => {
    expect(cleanSocialUrl('instagram', 'https://www.instagram.com/studio/')).toEqual({ ok: true, url: 'https://www.instagram.com/studio/' })
    expect(cleanSocialUrl('linkedin', 'linkedin.com/in/anna')).toEqual({ ok: true, url: 'https://linkedin.com/in/anna' })
    expect(cleanSocialUrl('youtube', 'https://youtu.be/abc').ok).toBe(true)
  })

  it('refuses http, other schemes, credentials, other platforms and empty values', () => {
    expect(cleanSocialUrl('instagram', 'http://instagram.com/a')).toEqual({ ok: false, problem: 'not_https' })
    expect(cleanSocialUrl('instagram', 'javascript:alert(1)')).toEqual({ ok: false, problem: 'not_https' })
    expect(cleanSocialUrl('instagram', 'https://u:p@instagram.com/a')).toEqual({ ok: false, problem: 'not_https' })
    expect(cleanSocialUrl('instagram', 'https://evil-instagram.com/a')).toEqual({ ok: false, problem: 'wrong_platform' })
    expect(cleanSocialUrl('facebook', 'https://instagram.com/a')).toEqual({ ok: false, problem: 'wrong_platform' })
    expect(cleanSocialUrl('x', '  ')).toEqual({ ok: false, problem: 'empty' })
  })

  it('stores a whole list in order with _type; one bad row refuses the list', () => {
    const r = toStoredSocialLinks([
      { _key: 'a', platform: 'x', url: 'x.com/studio' },
      { _key: 'b', platform: 'instagram', url: 'https://instagram.com/studio' },
    ])
    expect(r).toEqual({
      ok: true,
      value: [
        { _type: 'socialLink', _key: 'a', platform: 'x', url: 'https://x.com/studio' },
        { _type: 'socialLink', _key: 'b', platform: 'instagram', url: 'https://instagram.com/studio' },
      ],
    })
    expect(toStoredSocialLinks([{ _key: 'a', platform: 'myspace', url: 'https://myspace.com' }]).ok).toBe(false)
    expect(toStoredSocialLinks([{ _key: 'a', platform: 'x', url: 'https://x.com' }, { _key: 'a', platform: 'x', url: 'https://x.com' }]).ok).toBe(false)
    expect(toStoredSocialLinks('nope').ok).toBe(false)
    expect(toStoredSocialLinks(Array.from({ length: 21 }, (_, i) => ({ _key: `k${i}`, platform: 'x', url: 'https://x.com' })))).toEqual({ ok: false, error: 'too_many' })
  })

  it('is an allow-listed Settings path; [] clears the list', () => {
    expect(parseSettingsSet({ socialLinks: [] })).toEqual({ ok: true, socialLinks: [], disclosure: {} })
    expect(parseSettingsSet({ socialLinks: [{ _key: 'a', platform: 'x', url: 'ftp://x.com' }] })).toMatchObject({ ok: false, error: 'invalid_value', path: 'socialLinks' })
    expect(parseSettingsSet({ 'socialLinks.0.url': 'https://x.com' })).toMatchObject({ ok: false, error: 'invalid_field' })
  })

  it('reads stored rows for the page (unknown platforms left to Studio) and shortens addresses for showing', () => {
    expect(socialRowsFromStored([{ _key: 'a', platform: 'x', url: 'https://x.com/s' }, { _key: 'b', platform: 'myspace', url: 'u' }, null])).toEqual([{ _key: 'a', platform: 'x', url: 'https://x.com/s' }])
    expect(shortUrl('https://www.linkedin.com/in/anna/')).toBe('linkedin.com/in/anna')
  })
})
