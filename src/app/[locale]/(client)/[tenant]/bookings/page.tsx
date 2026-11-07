import { redirect } from 'next/navigation'

/**
 * `/bookings` redirects to Booking rules until the bookings list exists
 * (ADR-044 D16.15: one Bookings area, Booking rules a tab of it). The rules
 * page does its own sign-in, module and permission checks.
 */
export const dynamic = 'force-dynamic'

export default async function BookingsIndexPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  redirect(`/${projectSlug}/bookings/rules`)
}
