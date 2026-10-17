'use client'

import { PageShell } from '@/components/app/ui/PageShell'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function PageShellDemo() {
  return (
    <DemoStack>
      <DemoBlock title="The page frame" note="Props shown: children, className. Max width 6xl, left-aligned, space-y-5, bottom room for the floating bar and Fab.">
        <PageShell className="rounded-xl border border-dashed border-border p-4">
          <div className="rounded-lg bg-muted p-4 text-sm text-foreground">Page header</div>
          <div className="rounded-lg bg-muted p-4 text-sm text-foreground">Toolbar</div>
          <div className="rounded-lg bg-muted p-4 text-sm text-foreground">List or content</div>
        </PageShell>
      </DemoBlock>
    </DemoStack>
  )
}
