'use client'

import { Avatar } from '@/components/app/ui/Avatar'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function AvatarDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Sizes" note="Props shown: name, email, size (sm, md, lg). No src, so initials show.">
        <Avatar name="Claudia Hoffmann" email="claudia@example.com" size="sm" />
        <Avatar name="Claudia Hoffmann" email="claudia@example.com" size="md" />
        <Avatar name="Claudia Hoffmann" email="claudia@example.com" size="lg" />
      </DemoBlock>
      <DemoBlock title="Fallbacks and muted" note="One word gives two letters, no name uses the email; muted is for archived or not yet joined people.">
        <Avatar name="Paolo" email="paolo@example.com" />
        <Avatar name="" email="mario@example.com" />
        <Avatar name="Anna Maria Rossi" email="anna@example.com" muted />
      </DemoBlock>
    </DemoStack>
  )
}
