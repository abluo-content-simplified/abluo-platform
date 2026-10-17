'use client'

import { ThumbStrip } from '@/components/app/ui/list/ThumbStrip'
import { DemoBlock, DemoStack } from '../demo-kit'

// No external images: tiles with a src would need a URL, so the demo uses a
// tiny inline SVG data URI (no network, no colours from the palette).
const px = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3C/svg%3E"

export default function ThumbStripDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Photo counts" note="srcs, total (drives +N) and a fixed size. Left to right: none, one, three, five with 12 in total.">
        <ThumbStrip srcs={[]} size={{ width: '9rem', height: '4.5rem' }} className="rounded-lg" />
        <ThumbStrip srcs={[px]} size={{ width: '9rem', height: '4.5rem' }} className="rounded-lg" />
        <ThumbStrip srcs={[px, px, px]} size={{ width: '9rem', height: '4.5rem' }} className="rounded-lg" />
        <ThumbStrip srcs={[px, px, px, px, px]} total={12} size={{ width: '9rem', height: '4.5rem' }} className="rounded-lg" />
      </DemoBlock>
      <DemoBlock title="Fill a box" note="No size: className fills a sized parent, as in a ContentCard media area.">
        <div className="relative aspect-[16/10] w-56 overflow-hidden rounded-xl">
          <ThumbStrip srcs={[px, px, px, px, px]} total={8} className="absolute inset-0 size-full" />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
