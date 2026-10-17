'use client'

import { LinkCard } from '@/components/app/ui/LinkCard'
import { DemoBlock, DemoStack } from '../demo-kit'

const GLOBE = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
  </svg>
)
const HELP = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
  </svg>
)

export default function LinkCardDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Internal and external" note="Props shown: href, external (new tab), icon, title, badge, subline.">
        <div className="flex w-full max-w-md flex-col gap-3">
          <LinkCard href="https://example.com" external icon={GLOBE} title="View your site" subline="example.com" />
          <LinkCard
            href="/dashboard"
            icon={HELP}
            title="Help"
            badge={<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">New</span>}
            subline="Guides and answers"
          />
        </div>
      </DemoBlock>
      <DemoBlock title="Not a link" note="No href: a plain block with no arrow.">
        <div className="w-full max-w-md">
          <LinkCard icon={GLOBE} title="Plan" subline="Included with your site" />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
