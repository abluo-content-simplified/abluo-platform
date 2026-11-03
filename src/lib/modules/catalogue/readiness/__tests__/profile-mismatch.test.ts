/**
 * C6 row 31 / C1.12.4 (D-22) — `profileMismatch`: required, publish gate, active in every project,
 * NOT in the D-15 re-exposure subset; the editor and the gate facts builders agree (R-30); the editor
 * lists one issue per incompatible assignment; the list badge shows in every project.
 */
import { describe, expect, it } from 'vitest'
import { itemStateFromDoc } from '../../dashboard-form'
import { itemIssues } from '../../item-issues'
import { profilesWith } from '../../profiles'
import { buildTree } from '../../taxonomy/tree'
import type { CategoryNode } from '../../taxonomy/types'
import { readChannels } from '../../commerce/channels'
import { WEBSITE, evaluateItem } from '../engine'
import { itemReadinessInputFromDoc } from '../facts-doc'
import { itemReadinessInputFromState } from '../facts-client'
import { readinessGaps } from '../chips'
import { DEFAULT_RULES, REEXPOSE_SAFETY_SUBSET } from '../rules'

const FOOD = profilesWith('foodInformation')[0]
const cat = (key: string, parentKey: string | null, label: string, useFor?: string[]): CategoryNode => ({ key, label: { it: label }, parentKey, order: 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null, ...(useFor && { useFor: useFor as never }) })
const tree = buildTree([cat('books', null, 'Libri', ['book']), cat('design', 'books', 'Design'), cat('food', null, 'Cibo', [FOOD]), cat('pizza', 'food', 'Pizza')])
const channels = readChannels([]).channels
const tags = [{ key: 'signed', label: { it: 'Autografato' }, useFor: ['book'] as never }]
const lists = [{ id: 'salse', name: 'Salse', useFor: ['book'] as never }]

const doc = { itemProfile: FOOD, name: { it: 'Margherita' }, primaryCategory: 'design', additionalCategories: ['pizza'], tags: ['signed'], optionLists: [{ _key: 'a', list: { _ref: 'salse' }, min: 0 }] }

describe('profileMismatch rule', () => {
  it('is required, publish-gated, always active and not re-run on re-exposure', () => {
    const rule = DEFAULT_RULES.find((r) => r.code === 'profileMismatch')!
    expect(rule).toMatchObject({ activation: 'always', gate: 'publish', family: 'standard' })
    expect(rule.levelIn(WEBSITE, {} as never)).toBe('required')
    expect(REEXPOSE_SAFETY_SUBSET).not.toContain('profileMismatch')
  })

  it('R-30: editor facts and gate facts produce the same findings, in order, with names', () => {
    const fromDoc = itemReadinessInputFromDoc(doc, {
      id: 'p1',
      defaultLocale: 'it',
      locales: ['it'],
      channels,
      tree,
      timeZone: null,
      migrations: {},
      applicability: { tags, optionLists: new Map(lists.map((l) => [l.id, l])), listName: (id) => lists.find((l) => l.id === id)?.name },
    })
    const state = itemStateFromDoc(doc, null, channels, tree)
    const fromState = itemReadinessInputFromState({ ...state, id: 'p1' }, { defaultLocale: 'it', locales: ['it'], channels: [], optionCounts: new Map([['salse', 2]]), channelSet: channels, tree, applicability: { tags, optionLists: lists } })
    const pick = (i: typeof fromDoc) => evaluateItem(i, WEBSITE).required.filter((f) => f.code === 'profileMismatch').map((f) => f.values)
    expect(pick(fromState)).toEqual(pick(fromDoc))
    expect(pick(fromDoc)).toEqual([
      { kind: 'primary', key: 'design', name: 'Design', profile: FOOD },
      { kind: 'tag', key: 'signed', name: 'Autografato', profile: FOOD },
      { kind: 'option', key: 'salse', name: 'Salse', profile: FOOD },
    ])
  })

  it('the editor lists one blocker per assignment with stable ids and fix targets', () => {
    const state = itemStateFromDoc(doc, null, channels, tree)
    const issues = itemIssues(state, { defaultLocale: 'it', locales: ['it'], channels: [], optionCounts: new Map([['salse', 2]]), channelSet: channels, tree, applicability: { tags, optionLists: lists } }).filter((i) => i.id.startsWith('profileMismatch'))
    expect(issues.map((i) => [i.id, i.severity, i.tab, i.messageKey])).toEqual([
      ['profileMismatch:primary:design', 'blocksPublish', 'content', 'profileMismatchCategory'],
      ['profileMismatch:tag:signed', 'blocksPublish', 'content', 'profileMismatchTag'],
      ['profileMismatch:option:salse', 'blocksPublish', 'options', 'profileMismatchOption'],
    ])
  })

  it('list badge in every project (markers or not); silent without "Use for"', () => {
    const facts = { id: 'p1', defaultLocale: 'it', locales: ['it'], channels, tree, timeZone: null, migrations: {}, applicability: { tags, optionLists: new Map() } }
    expect(readinessGaps({}, () => itemReadinessInputFromDoc(doc, facts), { imageCount: 1, offerCount: 1 })).toContain('profileMismatch')
    const plain = buildTree([cat('design', null, 'Design')])
    expect(readinessGaps({}, () => itemReadinessInputFromDoc(doc, { ...facts, tree: plain, applicability: { tags: [], optionLists: new Map() } }), { imageCount: 1, offerCount: 1 })).not.toContain('profileMismatch')
  })
})
