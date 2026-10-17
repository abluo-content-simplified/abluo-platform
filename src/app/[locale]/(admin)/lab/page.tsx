import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { LinkCard } from '@/components/app/ui/LinkCard'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Pill } from '@/components/app/ui/list/cells'
import { LAB_REGISTRY, type LabCategory } from '@/lab/registry'
import usage from '@/lab/usage.generated.json'

/**
 * Component Lab index (super admin only): every shared Abluo App component in
 * the registry, grouped by category. Reads no tenant data — the (admin) layout
 * and proxy gate it; `requireAbluoAdmin()` is the same defence in depth as the
 * other admin pages.
 */
const CATEGORIES: LabCategory[] = ['primitive', 'composite']

const GLYPH = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M9 12h6" />
  </svg>
)

export default async function LabIndexPage() {
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()
  const t = await getTranslations('admin.lab')
  const used = usage.usage as Record<string, string[]>

  return (
    <PageShell>
      <PageHeader title={t('title')} />
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
      {CATEGORIES.map((cat) => {
        const entries = LAB_REGISTRY.filter((e) => e.category === cat).sort((a, b) => a.name.localeCompare(b.name))
        if (entries.length === 0) return null
        return (
          <section key={cat} aria-labelledby={`lab-${cat}`} className="space-y-3">
            <SectionHeading id={`lab-${cat}`} title={t(`categories.${cat}`)} />
            <div className="grid gap-3 md:grid-cols-2">
              {entries.map((e) => (
                <LinkCard
                  key={e.id}
                  href={`/lab/${e.id}`}
                  icon={GLYPH}
                  title={e.name}
                  badge={<Pill tone={e.status === 'canonical' ? 'success' : 'outline'}>{t(`status.${e.status}`)}</Pill>}
                  subline={`${t('usedInCount', { count: used[e.id]?.length ?? 0 })} · ${e.summary}`}
                />
              ))}
            </div>
          </section>
        )
      })}
    </PageShell>
  )
}
