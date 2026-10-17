'use client'

import { AppVersion } from '@/components/app/shell/AppVersion'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function AppVersionDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Version line" note="No props. Shows the release, the commit outside production, and the build time in your own time zone after mount.">
        <AppVersion />
      </DemoBlock>
    </DemoStack>
  )
}
