'use client'

import { CellFileInfo } from '@/components/app/ui/list/file-cells'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function FileCellsDemo() {
  return (
    <DemoStack>
      <DemoBlock title="CellFileInfo" note="width + height + bytes; bytes only; neither (shows the empty dash); custom empty text.">
        <CellFileInfo width={1920} height={1080} bytes={240_000} />
        <CellFileInfo bytes={1_850_000} />
        <CellFileInfo />
        <CellFileInfo empty="Unknown" />
      </DemoBlock>
    </DemoStack>
  )
}
