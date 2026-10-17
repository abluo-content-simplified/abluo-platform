import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { ButtonLink } from '@/components/app/ui/Button'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { HANDMADE_RULES, type HandmadeCounts, type HandmadeRule } from '@/lab/handmade'
import baseline from '@/lab/handmade-baseline.json'

/**
 * "Still to do": every dashboard file that still contains hand-made UI, grouped
 * by area, with what to use instead. Read from handmade-baseline.json — the
 * list the guard test only lets shrink.
 */
function area(file: string): string {
  const m = file.match(/^src\/components\/(client|admin|auth)\/([^/]+)\//) ?? file.match(/^src\/app\/\[locale\]\/\((client|admin)\)\/(?:\[tenant\]\/)?([^/]+)\//)
  if (m) return `${m[1]} · ${m[2].replace(/\.tsx$/, '')}`
  const s = file.match(/^src\/components\/(client|admin|auth)\//)
  return s ? `${s[1]} · shared` : 'other'
}

export default async function LabTodoPage() {
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()
  const t = await getTranslations('admin.lab')
  const files = (baseline as { files: HandmadeCounts }).files
  const entries = Object.entries(files)
  const total = entries.reduce((sum, [, c]) => sum + Object.values(c).reduce((a, b) => a + (b ?? 0), 0), 0)
  const byArea = new Map<string, [string, HandmadeCounts[string]][]>()
  for (const e of entries) byArea.set(area(e[0]), [...(byArea.get(area(e[0])) ?? []), e])
  const areas = [...byArea.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <PageShell>
      <div>
        <ButtonLink href="/lab" variant="quiet" className="-ml-4">
          ← {t('back')}
        </ButtonLink>
      </div>
      <PageHeader title={t('todo.title')} />
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('todo.intro', { files: entries.length, items: total })}</p>
      {areas.map(([name, list]) => (
        <section key={name} aria-labelledby={`todo-${name}`} className="space-y-3">
          <SectionHeading id={`todo-${name}`} title={`${name} · ${list.length}`} />
          <div className="space-y-2">
            {list.map(([file, counts]) => (
              <Panel key={file} className="space-y-2">
                <code className="block text-sm break-all">{file}</code>
                <ul className="space-y-0.5 text-sm">
                  {(Object.entries(counts) as [HandmadeRule, number][]).map(([rule, n]) => (
                    <li key={rule}>
                      <span className="font-medium">{t(`todo.rules.${rule}`, { count: n })}</span>
                      <span className="text-muted-foreground"> → {HANDMADE_RULES[rule].use}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  )
}
