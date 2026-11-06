import { VersionIndicator } from '@/sanity/components/VersionIndicator'
import { adminIcons } from '@/lib/app-install'

// Studio is admin-facing: the dark icon.
export const metadata = { title: 'Abluo Studio', icons: adminIcons }

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <VersionIndicator />
    </>
  )
}
