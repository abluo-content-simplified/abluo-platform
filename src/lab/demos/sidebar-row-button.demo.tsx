'use client'

import { SidebarRowButton } from '@/components/app/ui/SidebarRowButton'
import { CountBadge } from '@/components/app/ui/CountBadge'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SidebarRowButtonDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Sidebar footer row" note="icon, badge, children. Opens something (a sheet), it is not navigation.">
        <div className="w-full max-w-60">
          <SidebarRowButton
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
              </svg>
            }
            badge={<CountBadge count={2} srLabel="2 unread" />}
          >
            What&apos;s new
          </SidebarRowButton>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
