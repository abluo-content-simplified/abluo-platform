'use client'

import { AppIcon, APP_ICONS } from '@/components/app/shell/AppIcon'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function AppIconDemo() {
  return (
    <DemoStack>
      <DemoBlock title="APP_ICONS gallery" note="Every key of APP_ICONS, drawn with AppIcon (d).">
        {Object.entries(APP_ICONS).map(([name, d]) => (
          <div key={name} className="flex w-28 flex-col items-center gap-2 rounded-xl border border-border p-3 text-foreground">
            <AppIcon d={d} />
            <code className="text-xs text-muted-foreground">{name}</code>
          </div>
        ))}
      </DemoBlock>
      <DemoBlock title="Size and stroke" note="size (default 24) and width (default 1.8).">
        <span className="text-foreground"><AppIcon d={APP_ICONS.home} size={16} /></span>
        <span className="text-foreground"><AppIcon d={APP_ICONS.home} /></span>
        <span className="text-foreground"><AppIcon d={APP_ICONS.home} size={40} width={1.2} /></span>
      </DemoBlock>
    </DemoStack>
  )
}
