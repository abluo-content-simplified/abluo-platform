'use client'

import { useState } from 'react'
import { AttachmentPicker } from '@/components/app/ui/AttachmentPicker'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function AttachmentPickerDemo() {
  const [files, setFiles] = useState<File[]>([])
  return (
    <DemoStack>
      <DemoBlock title="Up to 3 images, 5 MB each" note="max, maxBytes, optional totalBytesMax. PNG / JPG / WebP only; what does not fit is named under the thumbnails. Files stay in the browser in this demo.">
        <AttachmentPicker
          files={files}
          onChange={setFiles}
          max={3}
          maxBytes={5 * 1024 * 1024}
          labels={{
            add: 'Add screenshots',
            hint: 'Up to 3 images, 5 MB each',
            remove: (n) => `Remove ${n}`,
            problem: (p) => `${p.name}: ${p.kind === 'type' ? 'not a PNG, JPG or WebP image' : p.kind === 'size' ? 'too large' : p.kind === 'count' ? 'too many images' : 'too much in total'}`,
          }}
        />
      </DemoBlock>
    </DemoStack>
  )
}
