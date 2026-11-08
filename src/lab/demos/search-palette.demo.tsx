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
}

const noop = () => {}
const GROUPS: SearchPaletteGroup[] = [
  { key: 'goto', heading: 'Go To', items: [{ id: 'media', title: 'Media', icon: ICON_DOC, onSelect: noop }] },
  {
    key: 'blog',
    heading: 'Posts',
    items: [
      { id: '1', title: 'Spring offers at the clinic', subtitle: 'What to expect when you book in March', badge: { label: 'Draft', tone: 'outline' }, icon: ICON_DOC, onSelect: noop },
      { id: '2', title: 'Our new opening hours', subtitle: 'From March we open on Saturdays', snippet: { before: '…from next month we ', match: 'open', after: ' on Saturdays too, 9:00–13:00…' }, badge: { label: 'Archived' }, icon: ICON_DOC, onSelect: noop },
    ],
    seeAll: { label: 'See all in Posts', onSelect: noop },
  },
]

type Mode = 'results' | 'loading' | 'empty' | 'error' | 'short'

export default function SearchPaletteDemo() {
  const [mode, setMode] = useState<Mode | null>(null)
  const [query, setQuery] = useState('mar')
  const [archived, setArchived] = useState(false)
  const modes: [Mode, string][] = [
    ['results', 'Results'],
    ['loading', 'Loading'],
    ['empty', 'No results'],
    ['error', 'Error'],
    ['short', 'Too short'],
  ]
  return (
    <DemoStack>
      <DemoBlock title="States" note="Fixture data only. state: ready · loading (previous groups stay visible; skeleton when none) · error. Arrow keys, Enter and Escape work; on a phone it fills the screen.">
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
          query={mode === 'short' ? 'm' : mode === 'empty' ? 'zzz' : query}
          onQueryChange={setQuery}
          groups={mode === 'results' ? GROUPS : []}
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
