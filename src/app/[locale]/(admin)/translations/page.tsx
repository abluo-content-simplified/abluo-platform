import { redirect } from 'next/navigation'
import { PageShell } from '@/components/app/ui/PageShell'
import { TranslationsBrowser } from '@/components/admin/translations/TranslationsBrowser'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { interfaceBundles, interfaceTranslationStatus } from '@/lib/i18n/interface-messages'
import { buildTranslationReport } from '@/lib/i18n/translation-report'

export const dynamic = 'force-dynamic'

/**
 * Admin Translations (Tom, 2026-10-22): the dashboards' own text (messages/*.json)
 * in each interface language — missing, outdated, machine-translated or OK.
 * Read-only: wording changes go through the code; scripts/i18n-translate.mjs
 * fills new text at each release. Website content is not here (ADR-023).
 */
export default async function AdminTranslationsPage() {
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')

  const report = buildTranslationReport(interfaceBundles(), interfaceTranslationStatus())

  return (
    <PageShell>
      <TranslationsBrowser rows={report.rows} locales={report.locales} summary={report.summary} />
    </PageShell>
  )
}
