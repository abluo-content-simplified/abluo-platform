import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { ButtonLink } from '@/components/app/ui/Button'
import { FactRow } from '@/components/app/ui/FactRow'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Pill } from '@/components/app/ui/list/cells'
import { LabDemo } from '@/components/admin/lab/LabDemo'
import { labEntry } from '@/lab/registry'
import usage from '@/lab/usage.generated.json'

/** One Lab entry: what it is for, its rules, a live demo and where it is used. */
export default async function LabEntryPage({ params }: { params: Promise<{ entry: string }> }) {
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()
  const { entry: id } = await params
  const entry = labEntry(id)
  if (!entry) notFound()

  const t = await getTranslations('admin.lab')
  const users = (usage.usage as Record<string, string[]>)[entry.id] ?? []
  const scanned = new Date(usage.generatedAt)

  return (
    <PageShell>
      <div>
        <ButtonLink href="/lab" variant="quiet" className="-ml-4">
          ← {t('back')}
        </ButtonLink>
      </div>
      <PageHeader title={entry.name} actions={<Pill tone={entry.status === 'canonical' ? 'success' : 'outline'}>{t(`status.${entry.status}`)}</Pill>} />
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{entry.summary}</p>

      <dl>
        <FactRow label={t('source')}>
          <code className="text-sm">{entry.source}</code>
        </FactRow>
        <FactRow label={t('usedIn')}>{t('usedInCount', { count: users.length })}</FactRow>
        {entry.replaces?.length ? <FactRow label={t('replaces')}>{entry.replaces.join(' · ')}</FactRow> : null}
      </dl>

      {entry.rules?.length ? (
        <section aria-labelledby="lab-rules" className="space-y-2">
          <SectionHeading id="lab-rules" title={t('rules')} />
          <ul className="list-disc space-y-1 pl-5 text-[0.9375rem] leading-6">
            {entry.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="lab-demos" className="space-y-3">
        <SectionHeading id="lab-demos" title={t('demos')} />
        <LabDemo id={entry.id} />
      </section>

      <section aria-labelledby="lab-used" className="space-y-2">
        <SectionHeading id="lab-used" title={t('usedIn')} />
        {users.length ? (
          <ul className="space-y-1 text-sm">
            {users.map((u) => (
              <li key={u}>
                <code>{u}</code>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-sm text-muted-foreground">{t('usageAsOf', { date: scanned.toISOString().slice(0, 10) })}</p>
      </section>
    </PageShell>
  )
}
