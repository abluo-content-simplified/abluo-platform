import { SlideUp } from '@/components/animation/SlideUp'
import type { TeamSectionMessages } from '@/lib/i18n/team-section-messages'
import { PersonCard, type PersonCardData } from './PersonCard'

/** The team grid — 1 col → 2 col (sm) → 3 col (lg) → 4 col (xl). Motion values come from the design system. */
export function PeopleGrid({
  cards,
  msg,
  profileLabel,
  duration,
  ease,
}: {
  cards: PersonCardData[]
  msg: TeamSectionMessages
  profileLabel: string
  duration: number
  ease: unknown
}) {
  if (cards.length === 0) return null
  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card, index) => (
        <SlideUp key={card.key} duration={duration} ease={ease} delay={index * 0.07}>
          <PersonCard card={card} msg={msg} profileLabel={profileLabel} />
        </SlideUp>
      ))}
    </div>
  )
}
