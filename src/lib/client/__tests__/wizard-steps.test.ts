import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { WIZARD_STEPS } from '@/lib/api/post-drafts'
import {
  canAdvance,
  ctaChoiceShown,
  canPublish,
  coverNeedsAlt,
  firstPassDone,
  hasText,
  languageReady,
  languageStates,
  languageSummaryKey,
  laterStep,
  overviewSections,
  progressSteps,
  resumeStep,
  resumeTarget,
  wizardSteps,
  WIZARD_STEP_ORDER,
} from '../wizard-steps'

it('the client-side step order mirrors the server allowlist', () => {
  expect([...WIZARD_STEP_ORDER]).toEqual([...WIZARD_STEPS])
})

const cats = [{ value: 'a', label: 'A' }]
const block = (text: string) => [{ _type: 'block', _key: 'b', children: [{ _type: 'span', _key: 's', text }] }]

describe('wizard step order', () => {
  it('full flow: categories + several languages', () => {
    expect(wizardSteps({ categories: cats, languages: ['it', 'de'] })).toEqual([
      'category', 'title', 'story', 'cover', 'languages', 'cta', 'preview', 'publish', 'done',
    ])
  })
  it('call to action on every blog; gallery only with the Gallery module', () => {
    expect(wizardSteps({ categories: [], languages: ['it'] })).toContain('cta')
    expect(wizardSteps({ categories: [], languages: ['it'] })).not.toContain('gallery')
    expect(wizardSteps({ categories: [], languages: ['it'], galleries: [] })).toEqual([
      'title', 'story', 'cover', 'cta', 'gallery', 'preview', 'publish', 'done',
    ])
  })
  it('skips category when the site has none', () => {
    expect(wizardSteps({ categories: [], languages: ['it', 'de'] })[0]).toBe('title')
  })
  it('languages only on multilingual sites', () => {
    expect(wizardSteps({ categories: cats, languages: ['en'] })).not.toContain('languages')
  })
  it('progress has no segment for the done screen', () => {
    expect(progressSteps(wizardSteps({ categories: [], languages: ['en'] }))).toEqual(['title', 'story', 'cover', 'cta', 'preview', 'publish'])
  })
})

describe('resume', () => {
  const single = wizardSteps({ categories: [], languages: ['en'] })
  it('resumes at the stored step', () => expect(resumeStep('story', single)).toBe('story'))
  it('"type" (just created) starts at the first step', () => expect(resumeStep('type', single)).toBe('title'))
  it('a stored step this site skips moves to the next one', () => {
    expect(resumeStep('category', single)).toBe('title')
    expect(resumeStep('languages', single)).toBe('cta')
    expect(resumeStep('gallery', single)).toBe('preview')
  })
  it('done / promote resume at publish', () => {
    expect(resumeStep('done', single)).toBe('publish')
    expect(resumeStep('promote', single)).toBe('publish')
  })
})

describe('step minimums', () => {
  it('title step needs a title in the default language', () => {
    expect(canAdvance('title', { title: { de: 'x' }, body: {} }, 'it')).toBe(false)
    expect(canAdvance('title', { title: { it: '  ' }, body: {} }, 'it')).toBe(false)
    expect(canAdvance('title', { title: { it: 'Ciao' }, body: {} }, 'it')).toBe(true)
  })
  it('story step needs one non-empty block', () => {
    expect(canAdvance('story', { title: {}, body: { it: block('  ') } }, 'it')).toBe(false)
    expect(canAdvance('story', { title: {}, body: { it: block('Hi') } }, 'it')).toBe(true)
  })
  it('other steps never block', () => expect(canAdvance('cover', { title: {}, body: {} }, 'it')).toBe(true))
  it('languageReady needs title and text', () => {
    expect(languageReady({ title: { de: 'T' }, body: {} }, 'de')).toBe(false)
    expect(languageReady({ title: { de: 'T' }, body: { de: block('x') } }, 'de')).toBe(true)
    expect(hasText(null)).toBe(false)
  })
})

describe('overview / furthest / resume (round 2)', () => {
  const multi = wizardSteps({ categories: cats, languages: ['it', 'de'] })
  it('laterStep keeps the furthest of two', () => {
    expect(laterStep('story', 'title')).toBe('story')
    expect(laterStep('title', 'publish')).toBe('publish')
    expect(laterStep('publish', 'review')).toBe('review')
  })
  it('the first pass is over once publish was reached', () => {
    expect(firstPassDone('preview')).toBe(false)
    expect(firstPassDone('publish')).toBe(true)
    expect(firstPassDone('review')).toBe(true)
  })
  it('during the first pass, Continue opens the furthest step reached (not an earlier stored one)', () => {
    expect(resumeTarget({ step: 'title', furthest: 'cover' }, multi)).toBe('cover')
    expect(resumeTarget({ step: 'story' }, multi)).toBe('story')
    expect(resumeTarget({ step: 'type', furthest: 'type' }, multi)).toBe('category')
  })
  it('after the first pass, Continue opens the overview', () => {
    expect(resumeTarget({ step: 'title', furthest: 'publish' }, multi)).toBe('review')
    expect(resumeTarget({ step: 'review', furthest: 'publish' }, multi)).toBe('review')
    expect(resumeTarget({ step: 'publish' }, multi)).toBe('review')
  })
  it('a stored "review" without furthest still resumes sensibly', () => {
    expect(resumeStep('review', multi)).toBe('publish')
  })
  it('overview sections follow the site: category and languages only when they apply', () => {
    const draft = { title: { it: 'T' }, body: { it: block('x') }, categories: [], cover: null }
    expect(overviewSections(draft, { categories: [], languages: ['it'], defaultLocale: 'it' })).toEqual([
      { id: 'title', state: 'done' },
      { id: 'story', state: 'done' },
      { id: 'cover', state: 'optional' },
      { id: 'cta', state: 'optional' },
    ])
    expect(
      overviewSections({ title: {}, body: {}, categories: ['a'], cover: { alt: {} } }, { categories: cats, languages: ['it', 'de'], defaultLocale: 'it' })
    ).toEqual([
      { id: 'category', state: 'done' },
      { id: 'title', state: 'missing' },
      { id: 'story', state: 'missing' },
      { id: 'cover', state: 'missing' },
      { id: 'languages', state: 'optional' },
      { id: 'cta', state: 'optional' },
    ])
  })
  it('publishing needs title + text in the main language', () => {
    expect(canPublish({ title: { it: 'T' }, body: {} }, 'it')).toBe(false)
    expect(canPublish({ title: { it: 'T' }, body: { it: block('x') } }, 'it')).toBe(true)
  })
})

describe('cover Next rule (D)', () => {
  it('no cover → Next allowed (Skip)', () => {
    expect(canAdvance('cover', { title: {}, body: {}, cover: null }, 'it')).toBe(true)
  })
  it('a cover without a description in the main language blocks Next', () => {
    const draft = { title: {}, body: {}, cover: { alt: { de: 'Foto' } } }
    expect(coverNeedsAlt(draft, 'it')).toBe(true)
    expect(canAdvance('cover', draft, 'it')).toBe(false)
    expect(canAdvance('cover', { title: {}, body: {}, cover: { alt: { it: '  ' } } }, 'it')).toBe(false)
  })
  it('a described cover lets you continue', () => {
    expect(canAdvance('cover', { title: {}, body: {}, cover: { alt: { it: 'Sala d’attesa' } } }, 'it')).toBe(true)
  })
})

describe('publish language summary per mode (B)', () => {
  const draft = { title: { en: 'T', it: 'T' }, subtitle: { de: 'only a subtitle' }, body: { en: block('x') } }
  const states = languageStates(draft, ['en', 'it', 'de', 'fr'])
  it('ready / partial / empty', () => {
    expect(states).toEqual([
      { locale: 'en', state: 'ready' },
      { locale: 'it', state: 'partial' },
      { locale: 'de', state: 'partial' },
      { locale: 'fr', state: 'empty' },
    ])
  })
  it('publish now and schedule say live / not included', () => {
    for (const mode of ['now', 'schedule'] as const) {
      expect(states.map((s) => languageSummaryKey(s.state, mode))).toEqual(['languageLive', 'languageMissing', 'languageMissing', 'languageMissing'])
    }
  })
  it('every summary key exists in the dashboard copy', async () => {
    const { readFileSync } = await import('node:fs')
    const en = JSON.parse(readFileSync('messages/en.json', 'utf8')).clientDashboard.create.publish
    for (const mode of ['now', 'schedule', 'draft'] as const) {
      for (const state of ['ready', 'partial', 'empty'] as const) expect(en[languageSummaryKey(state, mode)]).toBeTruthy()
    }
  })

  it('keep as draft says saved / started / not started', () => {
    expect(states.map((s) => languageSummaryKey(s.state, 'draft'))).toEqual([
      'languageSaved',
      'languageInProgress',
      'languageInProgress',
      'languageNotStarted',
    ])
  })
})

describe('call to action in the overview', () => {
  const ctas = [{ id: 'cta-book', isDefault: true }, { id: 'cta-call', isDefault: false }]
  const draft = { title: { it: 'T' }, body: { it: block('x') } }
  it('the CTA card is always there; optional until a prepared CTA is shown', () => {
    expect(overviewSections(draft, { categories: [], languages: ['it'], defaultLocale: 'it' }).at(-1)).toEqual({ id: 'cta', state: 'optional' })
    expect(overviewSections(draft, { categories: [], languages: ['it'], defaultLocale: 'it', ctas }).at(-1)).toEqual({ id: 'cta', state: 'done' })
    expect(overviewSections({ ...draft, cta: { mode: 'none' } }, { categories: [], languages: ['it'], defaultLocale: 'it', ctas }).at(-1)).toEqual({
      id: 'cta',
      state: 'optional',
    })
  })
  it('ctaChoiceShown: default needs a default; custom needs an existing key; none never', () => {
    expect(ctaChoiceShown(null, ctas)).toBe(true)
    expect(ctaChoiceShown(null, [{ id: 'cta-call', isDefault: false }])).toBe(false)
    expect(ctaChoiceShown({ mode: 'custom', ref: 'cta-call' }, ctas)).toBe(true)
    expect(ctaChoiceShown({ mode: 'custom', ref: 'gone' }, ctas)).toBe(false)
    expect(ctaChoiceShown({ mode: 'none' }, ctas)).toBe(false)
  })
})

describe('gallery in the overview', () => {
  const draft = { title: { it: 'T' }, body: { it: block('x') } }
  it('only with the Gallery module; done when an existing gallery is chosen', () => {
    expect(overviewSections(draft, { categories: [], languages: ['it'], defaultLocale: 'it' }).map((s) => s.id)).not.toContain('gallery')
    expect(overviewSections(draft, { categories: [], languages: ['it'], defaultLocale: 'it', galleries: [{ id: 'g1' }] }).at(-1)).toEqual({ id: 'gallery', state: 'optional' })
    expect(
      overviewSections({ ...draft, gallery: 'g1' }, { categories: [], languages: ['it'], defaultLocale: 'it', galleries: [{ id: 'g1' }] }).at(-1)
    ).toEqual({ id: 'gallery', state: 'done' })
    expect(
      overviewSections({ ...draft, gallery: 'gone' }, { categories: [], languages: ['it'], defaultLocale: 'it', galleries: [{ id: 'g1' }] }).at(-1)
    ).toEqual({ id: 'gallery', state: 'optional' })
  })
})
