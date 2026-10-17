'use client'

import type { ReactNode } from 'react'
import { DashboardArea, DashboardColumn, DashboardGrid } from '@/components/app/ui/DashboardGrid'
import { DemoBlock, DemoStack } from '../demo-kit'

function Box({ children, tall = false }: { children: ReactNode; tall?: boolean }) {
  return <div className={`rounded-xl border border-border bg-muted p-4 text-sm text-foreground ${tall ? 'h-40' : ''}`}>{children}</div>
}

export default function DashboardGridDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Spans" note="DashboardArea span={4 | 6 | 8 | 12}. One column on phones, 12 tracks from lg. Resize the window to see it.">
        <div className="w-full">
          <DashboardGrid>
            <DashboardArea span={8}>
              <Box>span 8</Box>
            </DashboardArea>
            <DashboardArea span={4}>
              <Box>span 4</Box>
            </DashboardArea>
            <DashboardArea span={6}>
              <Box>span 6</Box>
            </DashboardArea>
            <DashboardArea span={6}>
              <Box>span 6</Box>
            </DashboardArea>
            <DashboardArea span={12}>
              <Box>span 12</Box>
            </DashboardArea>
          </DashboardGrid>
        </div>
      </DemoBlock>
      <DemoBlock
        title="Column and orders"
        note="DashboardColumn stacks areas on desktop and dissolves on phones; phoneOrder and desktopOrder reorder areas. Phone order here: Summary, Attention, Latest, Shortcuts."
      >
        <div className="w-full">
          <DashboardGrid>
            <DashboardColumn span={8} desktopOrder={1}>
              <DashboardArea phoneOrder={2}>
                <Box>Needs your attention (phone 2)</Box>
              </DashboardArea>
              <DashboardArea phoneOrder={3}>
                <Box>Latest posts (phone 3)</Box>
              </DashboardArea>
            </DashboardColumn>
            <DashboardArea span={4} desktopOrder={2} phoneOrder={1}>
              <Box tall>Summary (phone 1)</Box>
            </DashboardArea>
            <DashboardArea span={12} desktopOrder={3} phoneOrder={4}>
              <Box>Shortcuts (phone 4)</Box>
            </DashboardArea>
          </DashboardGrid>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
