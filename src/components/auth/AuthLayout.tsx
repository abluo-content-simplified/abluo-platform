import type { ReactNode } from 'react'

/**
 * AuthLayout — the shared frame of every signed-out page (sign in, two-factor,
 * forgot / reset password, no access).
 *
 * It renders inside the `.abluo-app` root that `src/app/(platform)/(auth)/layout.tsx`
 * provides, so it is drawn with the Abluo App tokens only and follows the
 * person's light / dark choice and text size like both dashboards (ADR-025 D7,
 * ADR-030): a calm card, centred on the page, the same wordmark as the
 * App sidebar above it. No side panel, no raw colours.
 *
 * Text sizes are rem so the App text-size preference scales them.
 */

/** The product name, as the App sidebar writes it. Never translated. */
const BRAND = 'Abluo'

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 sm:px-6">
      <div className="w-full max-w-[26rem]">
        <p className="mb-6 text-center text-base font-semibold tracking-tight text-foreground">{BRAND}</p>
        <div className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-[var(--shadow-raise)] sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">{subtitle}</p> : null}
          {/* Without a subtitle the first line of the body reads as one (e.g. the MFA intro). */}
          <div className={subtitle ? 'mt-6' : 'mt-2'}>{children}</div>
        </div>
      </div>
    </main>
  )
}
