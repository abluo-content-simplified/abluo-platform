'use client'

import { AbluoLogo } from '@/components/app/shell/AbluoLogo'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function AbluoLogoDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Wordmark" note="variant=&quot;wordmark&quot; (default) — the expanded sidebar uses h-6.">
        <AbluoLogo className="h-6 text-foreground" />
        <AbluoLogo className="h-10 text-foreground" />
      </DemoBlock>
      <DemoBlock title="Sigil" note="variant=&quot;sigil&quot; — the collapsed icon rail uses h-5.">
        <AbluoLogo variant="sigil" className="h-5 text-foreground" />
        <AbluoLogo variant="sigil" className="h-10 text-foreground" />
      </DemoBlock>
      <DemoBlock title="Decorative" note="label={null} when visible text already names Abluo — the logo is hidden from screen readers.">
        <AbluoLogo label={null} className="h-6 text-muted-foreground" />
      </DemoBlock>
    </DemoStack>
  )
}
