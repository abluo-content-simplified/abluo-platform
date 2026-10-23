'use client'

import { Button } from '@/components/app/ui/Button'
import { ScreenshotGrid, type ScreenshotGridLabels } from '@/components/app/ui/ScreenshotGrid'
import { DemoBlock, DemoStack } from '../demo-kit'

const pic = (fill: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="${fill}"/><text x="300" y="120" font-size="48" text-anchor="middle" fill="white">${label}</text></svg>`)}`

const IMAGES = [
  { id: 'a', url: pic('slategray', 'Screenshot 1'), deleted: null },
  { id: 'b', url: pic('teal', 'Screenshot 2'), deleted: null },
  { id: 'c', url: null, deleted: 'redacted' },
  { id: 'd', url: null, deleted: 'removed_by_client' },
]

const LABELS: ScreenshotGridLabels = {
  open: (n) => `Open screenshot ${n}`,
  deleted: (reason) => (reason === 'redacted' ? 'Removed by Abluo Support' : reason === 'removed_by_client' ? 'Removed by the client' : 'Deleted'),
  viewer: { dialog: 'Screenshot', close: 'Close', previous: 'Previous screenshot', next: 'Next screenshot', counter: (n, total) => `${n} of ${total}` },
}

export default function ScreenshotGridDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Thumbnails, viewer and placeholders" note="Props: images ({ id, url, deleted }), labels (open, deleted(reason), viewer), actions? (per-image slot in the viewer, e.g. Delete). Thumbnails are top-aligned and show the top of the picture; a click opens the shared ImageViewer; pictures that are gone stay as small placeholders that say why.">
        <div className="max-w-xs">
          <ScreenshotGrid images={IMAGES} labels={LABELS} actions={() => <Button variant="destructive">Delete screenshot</Button>} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
