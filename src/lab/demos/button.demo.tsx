'use client'

import { Button, ButtonLink, IconButton } from '@/components/app/ui/Button'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function ButtonDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Variants" note="variant: primary | secondary (default) | quiet | destructive">
        <Button variant="primary">Save</Button>
        <Button>Cancel</Button>
        <Button variant="quiet">Skip</Button>
        <Button variant="destructive">Delete</Button>
      </DemoBlock>
      <DemoBlock title="Sizes" note="size: md (44px, default) | lg (48px)">
        <Button variant="primary">Medium</Button>
        <Button variant="primary" size="lg">Large</Button>
      </DemoBlock>
      <DemoBlock title="Full width" note="fullWidth — sheet and phone footer actions">
        <div className="w-full max-w-sm space-y-2">
          <Button variant="primary" size="lg" fullWidth>Publish</Button>
          <Button size="lg" fullWidth>Save as draft</Button>
        </div>
      </DemoBlock>
      <DemoBlock title="Disabled" note="Always explain why next to it.">
        <div className="space-y-1.5">
          <Button variant="primary" disabled>Publish</Button>
          <p className="text-sm text-muted-foreground">Add a title to publish.</p>
        </div>
      </DemoBlock>
      <DemoBlock title="With icon">
        <Button variant="primary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New post
        </Button>
      </DemoBlock>
      <DemoBlock title="IconButton" note="Icon-only: move, remove, dismiss, drag. 44px square; aria-label required.">
        <IconButton aria-label="Move up">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="m6 15 6-6 6 6" />
          </svg>
        </IconButton>
        <IconButton aria-label="Move down" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </IconButton>
        <IconButton aria-label="Remove">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </IconButton>
      </DemoBlock>
      <DemoBlock title="ButtonLink" note="Navigation styled as a button (locale-aware Link).">
        <ButtonLink href="/lab" variant="secondary">Back to all components</ButtonLink>
      </DemoBlock>
    </DemoStack>
  )
}
