import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { LabIndex, type LabIndexItem } from '@/components/admin/lab/LabIndex'
import { LAB_GROUPS, LAB_REGISTRY } from '@/lab/registry'
import usage from '@/lab/usage.generated.json'
import baseline from '@/lab/handmade-baseline.json'
import { ButtonLink } from '@/components/app/ui/Button'

/**
 * Component Lab index (super admin only): every shared Abluo App component in
 * the registry, grouped by what it is for, with one search. Reads no tenant
 * data — the (admin) layout and proxy gate it; `requireAbluoAdmin()` is the
 * same defence in depth as the other admin pages.
 */
export default async function LabIndexPage() {
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()
  const t = await getTranslations('admin.lab')
  const used = usage.usage as Record<string, string[]>
  const items: LabIndexItem[] = LAB_REGISTRY.map((e) => ({
    id: e.id,
    name: e.name,
    group: e.group,
    status: e.status,
    summary: e.summary,
    exports: e.exports,
    used: used[e.id]?.length ?? 0,
  }))

  return (
    <PageShell>
      <PageHeader
        title={t('title')}
        actions={<ButtonLink href="/lab/todo">{t('todo.link', { files: Object.keys(baseline.files).length })}</ButtonLink>}
      />
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
      <LabIndex items={items} groups={LAB_GROUPS} />
    </PageShell>
  )
}
