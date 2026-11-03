import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TeamSection } from '@/components/sections/TeamSection'
import type { TeamSection as TeamSectionType } from '@/lib/sanity/types'
import type { PersonPublic } from '@/lib/modules/people/projection'

// ADR-043 — the team section reads People-module refs first, a group filter
// second, inline members last (CONTRACTS 6.3), and an inline member and a
// person must render with the SAME card markup.

const person = (over: Partial<PersonPublic> & { publicId: string }): PersonPublic => ({
  firstName: 'Ref', lastName: 'Person', visibility: 'listed', archived: false, hasPage: false, slug: {}, ...over,
})

const inline = { _type: 'teamMemberObject' as const, _key: 'm1', name: 'Inline Member', honorific: 'Dr.', role: 'Hygienist', bio: 'Inline bio.' }
const MODULES_ON = ['people', 'blog']
const moduleConfig = [{ moduleId: 'people', config: { profileSegment: { en: 'team', it: 'insegnanti' } } }]

function render(section: Partial<TeamSectionType>, opts: { modules?: string[] | null; locale?: string } = {}) {
  return renderToStaticMarkup(
    <TeamSection
      section={{ _type: 'teamSection', _key: 's', title: 'Team', ...section } as TeamSectionType}
      surface={'transparent' as never}
      designSystem={null}
      locale={opts.locale ?? 'en'}
      enabledModuleIds={opts.modules === undefined ? MODULES_ON : opts.modules}
      moduleConfig={moduleConfig}
      tenantSlug="studio"
    />,
  )
}

describe('TeamSection — People refs, group, inline', () => {
  it('hand-picked people (peopleCount > 0) replace the inline members', () => {
    const html = render({
      members: [inline],
      peopleCount: 1,
      people: [person({ publicId: 'a', firstName: 'Anna', lastName: 'Rossi', jobTitle: 'Dentist', shortBio: 'Anna bio.' })],
    })
    expect(html).toContain('Anna Rossi')
    expect(html).toContain('Dentist')
    expect(html).toContain('Anna bio.')
    expect(html).not.toContain('Inline Member')
  })

  it('peopleCount > 0 with nobody listable renders no cards and never the inline members', () => {
    const html = render({ members: [inline], peopleCount: 2, people: [] })
    expect(html).not.toContain('Inline Member')
    expect(html).not.toContain('group flex')
  })

  it('a group filter shows the group when nothing is hand-picked', () => {
    const html = render({
      members: [inline],
      peopleCount: 0,
      groupFilter: 'dentist',
      groupPeople: [person({ publicId: 'g1', firstName: 'Gina', lastName: 'Verdi' }), person({ publicId: 'g2', firstName: 'Gino', lastName: 'Blu' })],
    })
    expect(html.indexOf('Gina Verdi')).toBeGreaterThan(-1)
    expect(html.indexOf('Gina Verdi')).toBeLessThan(html.indexOf('Gino Blu'))
    expect(html).not.toContain('Inline Member')
  })

  it('hand-picked wins over the group', () => {
    const html = render({
      peopleCount: 1,
      people: [person({ publicId: 'a', firstName: 'Anna', lastName: 'Rossi' })],
      groupFilter: 'dentist',
      groupPeople: [person({ publicId: 'g1', firstName: 'Gina', lastName: 'Verdi' })],
    })
    expect(html).toContain('Anna Rossi')
    expect(html).not.toContain('Gina Verdi')
  })

  it('no refs and no group: the inline members, as before', () => {
    const html = render({ members: [inline], peopleCount: 0 })
    expect(html).toContain('Dr. Inline Member')
    expect(html).toContain('Hygienist')
  })

  it('People module not installed: inline members, whatever the refs say', () => {
    const html = render(
      { members: [inline], peopleCount: 1, people: [person({ publicId: 'a', firstName: 'Anna', lastName: 'Rossi' })] },
      { modules: ['blog'] },
    )
    expect(html).toContain('Inline Member')
    expect(html).not.toContain('Anna Rossi')
  })

  it('module list unresolved (null) fails open like module sections', () => {
    const html = render({ members: [inline], peopleCount: 1, people: [person({ publicId: 'a', firstName: 'Anna', lastName: 'Rossi' })] }, { modules: null })
    expect(html).toContain('Anna Rossi')
  })
})

describe('TeamSection — visual parity of refs and inline members', () => {
  it('a person and an inline member with the same data render identical card markup', () => {
    const a = render({ members: [{ _type: 'teamMemberObject' as const, _key: 'x', name: 'Same Name', honorific: 'Dr.', role: 'Role', bio: 'Same bio.' }] })
    const b = render({
      peopleCount: 1,
      people: [person({ publicId: 'x', firstName: 'Same', lastName: 'Name', honorific: 'Dr.', jobTitle: 'Role', shortBio: 'Same bio.' })],
    })
    expect(b).toBe(a)
  })

  it('a person with an own page links name and card; a person without does not', () => {
    const html = render(
      {
        peopleCount: 2,
        people: [
          person({ publicId: 'a', firstName: 'Anna', lastName: 'Rossi', hasPage: true, visibility: 'page', slug: { current: 'anna-rossi' } }),
          person({ publicId: 'b', firstName: 'Bruno', lastName: 'Neri' }),
        ],
      },
      { locale: 'it' },
    )
    expect(html).toContain('href="/it/studio/insegnanti/anna-rossi"')
    expect(html).toContain('Vedi il profilo')
    expect(html.match(/insegnanti/g)).toHaveLength(2) // name + "view profile"
  })

  it('no profile segment configured: no links even when the person has a page', () => {
    const html = render({
      peopleCount: 1,
      people: [person({ publicId: 'a', firstName: 'Anna', lastName: 'Rossi', hasPage: true, slug: { current: 'anna-rossi' } })],
    }, { locale: 'de' })
    expect(html).not.toContain('anna-rossi')
  })

  it('legacy anchors stay element ids so /teachers#florian-parra still lands', () => {
    const html = render({
      peopleCount: 1,
      people: [person({ publicId: 'a', firstName: 'Florian', lastName: 'Parra', legacyAnchors: ['florian-parra', 'florian'] })],
    })
    expect(html).toContain('id="florian-parra"')
    expect(html).toContain('id="florian"')
  })

  it('inline anchorId is unchanged', () => {
    expect(render({ members: [{ ...inline, anchorId: 'inline-anchor' }] })).toContain('id="inline-anchor"')
  })
})
