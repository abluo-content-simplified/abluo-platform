import { VersionIndicator } from '@/sanity/components/VersionIndicator'

export const metadata = { title: 'Abluo Studio' }

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <VersionIndicator />
    </>
  )
}
