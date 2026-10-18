'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'

export type WizardFooterProps = {
  hint?: string | null
  progress?: { current: number; total: number } | null
  back?: { onPress: () => void; disabled?: boolean } | null
  primary: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }
}

/**
 * The Create flow's bottom bar (WizardShell and WizardFrame): the hint, the
 * segmented progress, Back and the primary button. No divider line — a soft
 * fade above lets the page scroll under it — with air below (safe area on
 * phones). The primary button spans the width on phones and sits on the right
 * on computers.
 */
export function WizardFooter({ wide = false, hint, progress, back, primary }: WizardFooterProps & { wide?: boolean }) {
  const t = useTranslations('clientDashboard.create')
  return (
    <footer className="relative bg-background pb-[max(20px,env(safe-area-inset-bottom))]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" />
      <div className={`mx-auto w-full px-4 pt-4 ${wide ? 'max-w-5xl' : 'max-w-[672px]'}`}>
        {hint ? (
          <p role="status" className="mb-3 text-[0.9375rem] leading-6 text-muted-foreground">
            {hint}
          </p>
        ) : null}
        {progress ? (
          <div
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={progress.total}
            aria-valuenow={progress.current}
            aria-label={t('shell.progress', { current: progress.current, total: progress.total })}
            className="flex gap-1.5"
          >
            {Array.from({ length: progress.total }, (_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i < progress.current ? 'bg-foreground' : 'bg-muted'}`} />
            ))}
          </div>
        ) : null}
        <div className={`flex items-center justify-between gap-4 ${progress ? 'mt-4' : ''}`}>
          {back ? (
            <Button variant="link" onClick={back.onPress} disabled={back.disabled}>
              {t('shell.back')}
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <Button
            variant="primary"
            size="lg"
            className={back ? 'flex-1 sm:min-w-32 sm:flex-none' : 'w-full sm:w-auto sm:min-w-32'}
            onClick={primary.onPress}
            disabled={primary.disabled}
            aria-busy={primary.busy || undefined}
          >
            {primary.label}
          </Button>
        </div>
      </div>
    </footer>
  )
}
