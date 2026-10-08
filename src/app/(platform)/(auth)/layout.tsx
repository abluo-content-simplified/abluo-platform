import type { ReactNode } from 'react'
import { AppRoot } from '@/components/app/AppRoot'

/**
 * The signed-out pages — sign in, two-factor, forgot / reset password and
 * "no access" — render inside the same Abluo App root as both dashboards
 * (ADR-025 D7, ADR-030), so they use the App tokens, Inter, the person's
 * theme (`abluo-app-theme`, or the device when unset) and text size.
 *
 * A route group only: the URLs stay `/login`, `/mfa`, `/forgot-password`,
 * `/reset-password` and `/unauthorized`. Presentation lives in
 * `src/components/auth/`; every page keeps its own behaviour.
 */
export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return <AppRoot surface="auth">{children}</AppRoot>
}
