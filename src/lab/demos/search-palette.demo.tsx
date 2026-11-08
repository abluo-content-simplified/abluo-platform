'use client'

import { useState } from 'react'
import { SearchPalette, type SearchPaletteGroup } from '@/components/app/ui/SearchPalette'
import { Button } from '@/components/app/ui/Button'
import { DemoBlock, DemoStack } from '../demo-kit'

const ICON_DOC = 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5'

const LABELS = {
  title: 'Search',
  placeholder: 'Search or jump to…',
  close: 'Cancel',
  loading: 'Searching…',
  noResults: 'Nothing found for “zzz”',
  minChars: 'Type at least 2 characters to search your content.',
  error: 'Search didn’t work. Please try again.',
  retry: 'Try Again',
  showArchived: 'Show archived',
  hintNavigate: 'Navigate',
  hintOpen: 'Open',
  hintClose: 'Close',
  viewOnWebsite: 'View on website',
}

const CHIPS = [
  { key: 'goto', token: '/', label: 'Go To', onSelect: () => {} },
  { key: 'create', token: '+', label: 'Create', onSelect: () => {} },
]

const noop = () => {}
const ICON_ARROW = 'M5 12h14M13 6l6 6-6 6'
const ICON_LIST = 'M4 6h16M4 12h16M4 18h16'

const POSTS: SearchPaletteGroup = {
  key: 'blog',
  heading: 'Posts',
  items: [
    { id: '1', title: 'Spring offers at the clinic', subtitle: 'What to expect when you book in March', badge: { label: 'Draft', tone: 'outline' }, date: { label: '2d', title: '6 Nov 2026, 09:30' }, highlight: true, icon: ICON_DOC, onSelect: noop },
    { id: '2', title: 'Our new opening hours', subtitle: 'From March we open on Saturdays', snippet: { before: '…from next month we ', match: 'open', after: ' on Saturdays too, 9:00–13:00…' }, badge: { label: 'Archived' }, date: { label: '3mo', title: '12 Aug 2026, 17:05' }, highlight: true, icon: ICON_DOC, onSelect: noop },
    { id: '3', title: 'Opening the studio on Sundays', subtitle: 'A trial run through the summer', date: { label: '1w', title: '1 Nov 2026, 11:00' }, siteUrl: 'https://example.com/blog/sundays', highlight: true, icon: ICON_DOC, onOpenNewTab: noop, onSelect: noop },
  ],
  seeAll: { label: 'See all in Posts', onSelect: noop },
}

/** Empty state: Recent (max 4), Quick Actions (max 4), Browse All. */
const EMPTY_GROUPS: SearchPaletteGroup[] = [
  { key: 'recent', heading: 'Recent', items: [{ id: 'r1', title: 'Spring offers at the clinic', subtitle: 'Posts', icon: ICON_DOC, onSelect: noop }, { id: 'r2', title: 'Media', icon: ICON_DOC, onSelect: noop }] },
  { key: 'quick', heading: 'Quick Actions', items: [{ id: 'q1', title: 'Contact Requests · 3 new', icon: ICON_DOC, onSelect: noop }, { id: 'q2', title: 'Blog post', icon: ICON_DOC, onSelect: noop }, { id: 'q3', title: 'Event', icon: ICON_DOC, onSelect: noop }] },
  { key: 'browse', heading: 'More', items: [{ id: 'all', title: 'Browse All', icon: ICON_LIST, onSelect: noop }] },
]

/** A strong navigation match leads as the single Top Hit; content follows, the rest of Go To after it. */
const TOP_HIT_GROUPS: SearchPaletteGroup[] = [
  { key: 'top', heading: 'Top Hit', items: [{ id: 'go:events', title: 'Events', icon: ICON_DOC, highlight: true, onSelect: noop }] },
  { ...POSTS, items: POSTS.items.slice(0, 1), seeAll: undefined },
  { key: 'goto', heading: 'Go To', items: [{ id: 'sub:legal', title: 'Legal Documents', subtitle: 'Settings', icon: ICON_DOC, highlight: true, onSelect: noop }] },
]

const GOTO_GROUPS: SearchPaletteGroup[] = [
  { key: 'goto', heading: 'Go To', items: [{ id: 'media', title: 'Media', icon: ICON_DOC, highlight: true, onSelect: noop }, { id: 'settings', title: 'Settings', icon: ICON_ARROW, highlight: true, onSelect: noop }] },
]

type Mode = 'results' | 'empty-state' | 'top-hit' | 'goto' | 'loading' | 'empty' | 'error' | 'short'

const QUERY: Record<Mode, string | undefined> = {
  results: undefined,
  'empty-state': '',
  'top-hit': 'event',
  goto: '/me',
  loading: undefined,
  empty: 'zzz',
  error: undefined,
  short: 'm',
}

export default function SearchPaletteDemo() {
  const [mode, setMode] = useState<Mode | null>(null)
  const [query, setQuery] = useState('mar')
  const [archived, setArchived] = useState(false)
  const modes: [Mode, string][] = [
    ['empty-state', 'Empty (Recent · Quick Actions)'],
    ['top-hit', 'Top Hit'],
    ['goto', '/ Go To mode'],
    ['results', 'Results'],
    ['loading', 'Loading'],
    ['empty', 'No results'],
    ['error', 'Error'],
    ['short', 'Too short'],
  ]
  return (
    <DemoStack>
      <DemoBlock title="States" note="Fixture data only. Empty state: Recent, Quick Actions, Browse All; Top Hit leads when a Go To / Create match is strong; dates are right-aligned; the active row with a public page shows View on website (md+; ⌘/Ctrl+Enter opens a new tab, + Shift the public page); the / and + chips sit in the footer, under the input on phones. state: ready · loading (previous groups stay visible; skeleton when none) · error. Arrow keys, Enter and Escape work; on a phone it fills the screen.">
        <div className="flex flex-wrap gap-2">
          {modes.map(([m, label]) => (
            <Button key={m} variant="secondary" onClick={() => setMode(m)}>
              {label}
            </Button>
          ))}
        </div>
        <SearchPalette
          open={mode !== null}
          onClose={() => setMode(null)}
          query={mode && QUERY[mode] !== undefined ? (QUERY[mode] as string) : query}
          onQueryChange={setQuery}
          groups={mode === 'results' ? [POSTS] : mode === 'empty-state' ? EMPTY_GROUPS : mode === 'top-hit' ? TOP_HIT_GROUPS : mode === 'goto' ? GOTO_GROUPS : []}
          highlightTerms={mode === 'top-hit' ? ['event'] : mode === 'goto' ? ['me'] : ['mar']}
          chips={CHIPS}
          tip={mode === 'empty-state' ? { text: 'Type / to jump anywhere' } : undefined}
          state={mode === 'loading' ? 'loading' : mode === 'error' ? 'error' : 'ready'}
          onRetry={() => setMode('results')}
          archived={{ value: archived, onChange: setArchived }}
          tooShort={mode === 'short'}
          labels={LABELS}
        />
      </DemoBlock>
    </DemoStack>
  )
}
