// Shared fixtures for the timetable tests: CYCE-like December 2026.
import type { ClassOccurrence, ClassSeries, MeetingRoom, ScheduleClosure } from '@/lib/scheduling/types'

export const COURSE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // Iyengar Yoga
export const COURSE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // Méditation
export const P1 = '11111111-1111-4111-8111-111111111111'
export const P2 = '22222222-2222-4222-8222-222222222222'
export const P_OFF = '99999999-9999-4999-8999-999999999999'
export const ROOM = '66666666-6666-4666-8666-666666666666'
export const S1 = '33333333-3333-4333-8333-333333333331'
export const S2 = '33333333-3333-4333-8333-333333333332'

export const series = (over: Partial<ClassSeries> & Pick<ClassSeries, 'id' | 'ownerPublicId'>): ClassSeries => ({
  ownerType: 'course',
  editionId: null,
  timeZone: 'Europe/Brussels',
  startLocal: '2026-09-07T12:30',
  endLocal: '2026-09-07T13:30',
  rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
  weekday: 1,
  interval: 1,
  startsOn: null,
  endsOn: null,
  place: { kind: 'location', key: 'brey' },
  attendanceMode: 'mixed',
  instructorPublicIds: [P1],
  languages: ['fr', 'en'],
  meetingRoomId: ROOM,
  status: 'active',
  version: 1,
  ...over,
})

export const SERIES: ClassSeries[] = [
  series({ id: S1, ownerPublicId: COURSE_A }),
  series({
    id: S2,
    ownerPublicId: COURSE_B,
    startLocal: '2026-09-03T18:00',
    endLocal: '2026-09-03T19:00',
    rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TH',
    weekday: 4,
    place: null,
    attendanceMode: 'online',
    instructorPublicIds: [P2],
    languages: ['en'],
  }),
]

export const occ = (id: string, s: ClassSeries, date: string, over: Partial<ClassOccurrence> = {}): ClassOccurrence => ({
  id,
  seriesId: s.id,
  ownerType: 'course',
  ownerPublicId: s.ownerPublicId,
  originalStartLocal: `${date}T${s.startLocal.slice(11)}`,
  isModified: false,
  startLocal: `${date}T${s.startLocal.slice(11)}`,
  endLocal: s.endLocal ? `${date}T${s.endLocal.slice(11)}` : null,
  timeZone: s.timeZone,
  startsAt: `${date}T10:00:00.000Z`,
  endsAt: null,
  status: 'scheduled',
  place: s.place,
  attendanceMode: s.attendanceMode,
  instructorPublicIds: s.instructorPublicIds,
  note: null,
  version: 1,
  languages: s.languages,
  meetingRoomId: s.meetingRoomId,
  ...over,
})

const [s1, s2] = SERIES

export const OCCURRENCES: ClassOccurrence[] = [
  occ('o1', s2, '2026-12-03'),
  occ('o2', s1, '2026-12-07', { instructorPublicIds: [P2], isModified: true }), // sub
  occ('o3', s2, '2026-12-10', { status: 'cancelled', note: { fr: 'Professeure malade', en: 'Teacher ill' } }),
  occ('o4', s1, '2026-12-14'),
  occ('o5', s2, '2026-12-17', { startLocal: '2026-12-17T19:00', endLocal: '2026-12-17T20:00', isModified: true }), // time change
  occ('o6', s1, '2026-12-08', { attendanceMode: 'inPerson', isModified: true }), // "no hybrid" (odd weekday, fine for the test)
]

export const CLOSURES: ScheduleClosure[] = [
  { id: 'c1', editionId: null, startsOn: '2026-12-18', endsOn: '2027-01-06', label: { en: 'Winter break', fr: 'Vacances d’hiver' } },
]

export const ROOMS: MeetingRoom[] = [
  { id: ROOM, label: 'Room 1', joinUrl: 'https://zoom.example/j/123', meetingId: '123 456 789', passcode: 'SECRET-PASS', note: null, version: 1 },
]

export const PEOPLE = [
  { publicId: P1, firstName: 'Anna', lastName: 'Rossi', displayName: null, hasPage: true, slug: { current: 'anna-rossi' } },
  { publicId: P2, firstName: 'Sabrina', lastName: 'Martin', displayName: 'Sabrina', hasPage: false, slug: { current: null } },
]

export const COURSES = [
  { publicId: COURSE_A, title: 'Iyengar Yoga', color: 'accent' },
  { publicId: COURSE_B, title: 'Méditation', color: 'none' },
]

export const LOCATIONS = [
  { key: 'brey', name: 'BREY', address: { street: 'Avenue d’Auderghem 45', postalCode: '1040', city: 'Etterbeek' }, accessNote: 'Room 04, 4th floor' },
  { key: 'l51', name: 'L51', address: { street: 'Rue de la Loi 51', postalCode: '1049', city: 'Brussels' }, accessNote: undefined },
]

export const WINDOW = { from: '2026-12-01', to: '2026-12-31' }
