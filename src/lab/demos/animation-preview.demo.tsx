'use client'

import { AnimationPreview } from '@/components/app/ui/AnimationPreview'
import { platformAnimation } from '@/lib/animations/platform'
import { DemoBlock, DemoStack } from '../demo-kit'

const checkmark = platformAnimation('checkmark')!

export default function AnimationPreviewDemo() {
  // On a site this comes from the design system: hexToLottieColor(colour). RGBA 0–1 here (no raw colours in dashboard code).
  const brand = [1, 0.47, 0.3, 1]
  return (
    <DemoStack>
      <DemoBlock title="Hover to play" note="play=&quot;hover&quot; (default): a still frame until the pointer is over it — the Media Library tiles and table.">
        <AnimationPreview data={checkmark.data} label="Checkmark" still="last" className="size-24 rounded-xl bg-muted p-3" />
      </DemoBlock>
      <DemoBlock title="Looping" note="play=&quot;loop&quot;: plays on its own (the photo panel). With reduced motion switched on it stays on its still frame.">
        <AnimationPreview data={checkmark.data} label="Checkmark" play="loop" className="size-24 rounded-xl bg-muted p-3" />
      </DemoBlock>
      <DemoBlock title="Recoloured" note="colors={{ accent: hexToLottieColor(designSystemColour) }} — the platform checkmark in another brand colour, same file.">
        <AnimationPreview data={checkmark.data} label="Checkmark" play="loop" colors={{ accent: brand }} className="size-24 rounded-xl bg-muted p-3" />
      </DemoBlock>
    </DemoStack>
  )
}
