/**
 * ADR-040 §9 — what a visitor without access sees instead of a restricted
 * page, inside the normal site layout (nav, footer, design-system tokens).
 *
 * It receives NO page data and must not: the locale, the site's home href,
 * the two form actions, the path to return to (the visitor's own URL) and a
 * notice about the VISITOR's attempt or session. The same placeholder renders
 * whatever the reason the page is closed, so it never hints at the page's
 * title, groups or state. A test enforces that it imports nothing from Sanity
 * and takes no page prop.
 *
 * B2.3: the password prompt (AccessPrompt) below the text; when the visitor
 * is signed in with a password that does not open this page, a sign-out link.
 */
import { SectionContainer } from '@/components/layout/SectionContainer'
import { getAccessMessages } from '@/lib/i18n/access-messages'
import { AccessPrompt } from './AccessPrompt'

export type RestrictedPageProps = {
  locale: string
  homeHref: string
  actions: { unlock: string; signOut: string }
  /** The visitor's own path on this site (safe, relative), to come back to. */
  returnTo: string
  fields: { password: string; returnTo: string }
  notice: { tone: 'error' | 'info'; text: string; invalid?: boolean } | null
  /** The visitor holds a session here (it just does not open this page). */
  signedIn: boolean
}

export function RestrictedPage({ locale, homeHref, actions, returnTo, fields, notice, signedIn }: RestrictedPageProps) {
  const m = getAccessMessages(locale)
  return (
    <SectionContainer>
      <div className="mx-auto flex min-h-[40vh] max-w-[640px] flex-col items-center justify-center py-8 text-center" data-access="restricted">
        <h1
          className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
          style={{
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-heading)',
            fontSize: 'var(--font-size-h2, var(--fs-h2))',
            fontWeight: 'var(--font-weight-h2, 600)',
            lineHeight: 'var(--line-height-h2, 1.375)',
            letterSpacing: 'var(--letter-spacing-h2, -0.025em)',
          }}
        >
          {m.restrictedHeading}
        </h1>
        <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
          {m.restrictedBody} {m.promptIntro}
        </p>

        <AccessPrompt
          action={actions.unlock}
          returnTo={returnTo}
          fields={fields}
          notice={notice}
          labels={{ password: m.passwordLabel, show: m.showPassword, hide: m.hidePassword, submit: m.submit, submitting: m.submitting }}
        />

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm" style={{ fontFamily: 'var(--font-body)' }}>
          <a href={homeHref} className="underline underline-offset-4 hover:opacity-80" style={{ color: 'var(--color-text-secondary)' }}>
            {m.goHome}
          </a>
          {signedIn && (
            <form method="post" action={actions.signOut}>
              <input type="hidden" name={fields.returnTo} value={returnTo} />
              <button type="submit" className="underline underline-offset-4 hover:opacity-80" style={{ color: 'var(--color-text-secondary)' }}>
                {m.signOut}
              </button>
            </form>
          )}
        </div>
      </div>
    </SectionContainer>
  )
}

/**
 * A quiet strip at the end of a members page the visitor may see: says it is
 * the members area and offers "Sign out". Same no-page-data rule.
 */
export function MembersBar({ locale, signOutAction, returnTo, fields }: { locale: string; signOutAction: string; returnTo: string; fields: { returnTo: string } }) {
  const m = getAccessMessages(locale)
  return (
    <div className="mx-auto w-full px-6 md:px-10 lg:px-16" style={{ maxWidth: 'var(--layout-max-content-width, 1120px)' }}>
      <form
        method="post"
        action={signOutAction}
        data-access="members-bar"
        className="mx-auto flex max-w-[640px] flex-wrap items-center justify-center gap-x-4 gap-y-2 py-6 text-sm"
        style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' }}
      >
        <span>{m.membersArea}</span>
        <span aria-hidden="true">·</span>
        <input type="hidden" name={fields.returnTo} value={returnTo} />
        <button type="submit" className="underline underline-offset-4 hover:opacity-80" style={{ color: 'var(--color-text-secondary)' }}>
          {m.signOut}
        </button>
      </form>
    </div>
  )
}
