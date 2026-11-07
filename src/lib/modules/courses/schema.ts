import { defineArrayMember, defineType, defineField } from 'sanity'
import { anchorIdField, BACKGROUND_SURFACE_OPTIONS, projectSlugField, scopedRef } from '@/lib/sanity/fields/shared'
import { validateUniquePublicId } from '@/lib/sanity/fields/public-id'
import { PUBLISHING_GROUP, archivedFields } from '@/lib/sanity/fields/publishing'
import { bodyLinkAnnotation } from '@/lib/sanity/fields/body-link'
import { LocalizedPortableTextInput } from '@/lib/sanity/fields/LocalizedInput'
import { PLATFORM_LOCALES, LOCALE_CODES } from '@/lib/i18n/locales'
import { COURSE_COLORS, DEFAULT_COURSE_COLOR } from './model'

// ── Courses module — Sanity schema types (ADR-045, timetable build spec §3) ──
//
// Owned by: courses module (MODULE_REGISTRY id: 'courses')
//   course — collection document: one course of one website ("Iyengar Yoga").
//
// A course is only its words. Everything about WHEN it happens (weekly classes,
// teachers, places, languages, exceptions, terms, closures) lives in Supabase
// scheduling and is keyed by this document's `publicId`; teachers are stored on
// the classes, never here.
//
// Routable (ADR-045 D5): a published course with a slug in a language has its
// own page at /{courseSegment}/{slug} — the segment is the Courses module config
// `courseSegment`, never hardcoded. Five-requirement checklist (CLAUDE.md):
// localizedSlug + redirectFrom here; lookups in queries.ts (COURSE_BY_SLUG_QUERY,
// COURSE_BY_OLD_SLUG_QUERY, SITEMAP_COURSES_QUERY); the dispatch in the tenant
// catch-all; src/lib/seo/sitemap-courses.ts. No migration: courses never had a
// flat slug. The dashboard writes both fields (old slugs go to redirectFrom on
// publish).
//
// Clients edit courses in the dashboard only; Studio shows them READ-ONLY
// (same stance as People, ADR-043 D8).

const COURSE_GROUPS = [
  { name: 'content', title: 'Content', default: true },
  { name: 'meta', title: 'Details' },
  PUBLISHING_GROUP,
]

// Mirrors publicIdField in src/lib/modules/events/schema.ts (a module may not
// depend on another module's schema file).
const publicIdField = defineField({
  name: 'publicId',
  title: 'Public ID',
  type: 'string',
  readOnly: true,
  group: 'meta',
  initialValue: () => globalThis.crypto.randomUUID(),
  description: 'Permanent id that class schedules are keyed on. Set automatically; never changes.',
  validation: (Rule) => Rule.custom((value, context) => validateUniquePublicId(value, context)),
})

const courseType = defineType({
  name: 'course',
  title: 'Course',
  type: 'document',
  readOnly: true,
  groups: COURSE_GROUPS,
  fields: [
    projectSlugField,
    publicIdField,
    defineField({ name: 'title', title: 'Title', type: 'localizedString', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({ name: 'shortDescription', title: 'Short description', type: 'localizedText', group: 'content' }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'localizedSlug',
      group: 'meta',
      description: 'The last part of the course page address, per language. Set in the dashboard; filled from the title on publish when empty.',
    }),
    defineField({ name: 'redirectFrom', title: 'Redirect From', type: 'redirectFrom', group: 'meta' }),
    defineField({
      name: 'color',
      title: 'Colour',
      type: 'string',
      group: 'meta',
      initialValue: DEFAULT_COURSE_COLOR,
      options: { list: COURSE_COLORS.map((c) => ({ title: c === 'none' ? 'None' : c === 'accent' ? 'Accent' : 'Muted', value: c })), layout: 'radio' },
      description: 'How the course is marked in the timetable. Only design-system colours.',
    }),
    defineField({
      name: 'image',
      title: 'Image',
      type: 'reference',
      to: [{ type: 'mediaAsset' }],
      group: 'content',
      description: 'Optional. A Media Library image shown in the class details on the website. Its focal point is set there, once.',
    }),
    // ADR-032 D1 — archive only, no publication window. Written by the dashboard's Archive / Restore.
    ...archivedFields(),
  ],
  preview: {
    select: { en: 'title.en', it: 'title.it', de: 'title.de', fr: 'title.fr', archivedAt: 'archivedAt' },
    prepare: ({ en, it, de, fr, archivedAt }: Record<string, string | undefined>) => ({
      title: en ?? it ?? de ?? fr ?? 'Untitled course',
      subtitle: archivedAt ? 'Archived' : undefined,
    }),
  },
})

// ── timetableNotesText — restricted rich text for the notes under the timetable ──
// Same restrictions as FAQ answers (ADR-037 D12): paragraphs, bold, italic, two list kinds and the shared
// body link (stable internal references, plain text when the target is gone). No headings, images or colours.
// One value per platform language; a language left empty falls back like other localized text.
const timetableNotesBlock = defineArrayMember({
  type: 'block',
  styles: [{ title: 'Paragraph', value: 'normal' }],
  lists: [
    { title: 'Bullet list', value: 'bullet' },
    { title: 'Numbered list', value: 'number' },
  ],
  marks: {
    decorators: [
      { title: 'Bold', value: 'strong' },
      { title: 'Italic', value: 'em' },
    ],
    annotations: [bodyLinkAnnotation],
  },
})

const timetableNotesTextType = defineType({
  name: 'timetableNotesText',
  title: 'Notes',
  type: 'object',
  components: { input: LocalizedPortableTextInput },
  fields: [
    ...LOCALE_CODES.map((code) => defineField({ name: code, title: PLATFORM_LOCALES[code].nativeName, type: 'array', of: [timetableNotesBlock] })),
    defineField({ name: 'translationStatus', title: 'Translation status', type: 'translationStatus', hidden: true }),
  ],
})

// ── timetableSection — the website's week / month timetable (build spec §5) ──
//
// Presentation only (CLAUDE.md: Sections vs Modules): it owns no classes. It
// shows the weekly classes of the site's courses, read per request from
// scheduling (Supabase) and laid over the course titles (Sanity). Module-gated
// by `courses`.
//
// "Show online meeting details" is a REQUEST, not a switch: the join links and
// passcodes appear only when this page is also protected by Access and the
// visitor has signed in — decided on the server, never from this flag alone.

const timetableSectionType = defineType({
  name: 'timetableSection',
  title: 'Timetable Section',
  type: 'object',
  fields: [
    anchorIdField(),
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: { list: BACKGROUND_SURFACE_OPTIONS },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'intro', title: 'Intro', type: 'localizedText', description: 'Optional. A short line above the timetable.' }),
    defineField({
      name: 'defaultView',
      title: 'Opens as',
      type: 'string',
      options: {
        list: [
          { title: 'Week', value: 'week' },
          { title: 'Month', value: 'month' },
        ],
        layout: 'radio',
      },
      initialValue: 'week',
    }),
    defineField({
      name: 'allowViewSwitch',
      title: 'Let visitors switch between week and month',
      type: 'boolean',
      initialValue: true,
    }),
    defineField({
      name: 'courseScope',
      title: 'Which courses',
      type: 'string',
      description: 'Courses are managed in the dashboard (Courses).',
      options: {
        list: [
          { title: 'All courses', value: 'all' },
          { title: 'Pick courses', value: 'pick' },
        ],
        layout: 'radio',
      },
      initialValue: 'all',
    }),
    defineField({
      name: 'courses',
      title: 'Courses',
      type: 'array',
      // Weak: a course removed later never makes a published page invalid; the website shows only
      // published, non-archived courses of THIS website whatever the reference says.
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'course' }], weak: true, options: { filter: scopedRef } })],
      description: 'The courses to show, only when "Pick courses" is chosen.',
      hidden: ({ parent }) => (parent as { courseScope?: string } | undefined)?.courseScope !== 'pick',
      validation: (Rule) => Rule.unique(),
    }),
    defineField({
      name: 'showOnlineDetails',
      title: 'Show online meeting details',
      type: 'boolean',
      initialValue: false,
      description:
        'Shows the join link, meeting number and passcode of online classes. Only works on a page that is protected by Access and only for signed-in members; on a public page nothing is shown, whatever this says.',
    }),
    defineField({
      name: 'showCourseDescriptions',
      title: 'Add an "About the courses" page to the printout',
      type: 'boolean',
      initialValue: false,
      description: 'A second printed page with each course shown in the month and its description.',
      hidden: ({ parent }) => (parent as { showPrintButton?: boolean } | undefined)?.showPrintButton === false,
    }),
    defineField({
      name: 'includeEvents',
      title: 'Also show events (workshops)',
      type: 'boolean',
      initialValue: false,
      description:
        'Adds the website\'s published events (Events module) that fall in the shown week or month to the calendar and the printout, marked "Workshop", each linking to its event page. Needs the Events module; without it nothing is added.',
    }),
    defineField({
      name: 'notes',
      title: 'Notes',
      type: 'timetableNotesText',
      description: 'Shown to everyone under the timetable and at the bottom of the printout: e.g. "Please bring your own mat", holiday dates, a contact. Bold, italic, lists and links only.',
    }),
    defineField({
      name: 'membersNotes',
      title: 'Notes for members',
      type: 'timetableNotesText',
      description:
        'Shown ONLY to signed-in members, and only when this page is protected by Access (e.g. door codes, the teachers\' room). On a public page, or for anyone not signed in, these notes are never sent to the browser.',
    }),
    defineField({
      name: 'showPrintButton',
      title: 'Show a "Print month" button',
      type: 'boolean',
      initialValue: true,
      description: 'Prints the month as a one-page sheet: places down, weekdays across.',
    }),
  ],
  preview: {
    select: { title_en: 'title.en', title_it: 'title.it', title_fr: 'title.fr', title_de: 'title.de', view: 'defaultView', scope: 'courseScope', courses: 'courses' },
    prepare: ({ title_en, title_it, title_fr, title_de, view, scope, courses }: { title_en?: string; title_it?: string; title_fr?: string; title_de?: string; view?: string; scope?: string; courses?: unknown[] }) => ({
      title: title_en ?? title_fr ?? title_it ?? title_de ?? 'Timetable',
      subtitle: `Timetable Section — ${scope === 'pick' ? `${courses?.length ?? 0} courses` : 'all courses'} · opens as ${view === 'month' ? 'month' : 'week'}`,
    }),
  },
})

// ── courseListSection — course cards that lead to the course pages (ADR-045 D5) ──
//
// Presentation only (Sections vs Modules): it owns no courses. It shows the
// site's published courses — hand-picked here, else all of them in title order —
// as cards (image, title, short description) linking to each course's own page.
// A card links only where the course has a page in that language (a slug and the
// module's course segment); otherwise it shows without a link. Module-gated by
// `courses`.

const courseListSectionType = defineType({
  name: 'courseListSection',
  title: 'Course List Section',
  type: 'object',
  fields: [
    anchorIdField(),
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: { list: BACKGROUND_SURFACE_OPTIONS },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'intro', title: 'Intro', type: 'localizedText', description: 'Optional. A short line above the courses.' }),
    defineField({
      name: 'courses',
      title: 'Courses',
      type: 'array',
      // Weak: a course removed later never makes a published page invalid; the website shows only
      // published, non-archived courses of THIS website whatever the reference says.
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'course' }], weak: true, options: { filter: scopedRef } })],
      description: 'Optional. Pick courses to show them in this order. Leave empty to show every published course, by title. Courses are managed in the dashboard (Courses).',
      validation: (Rule) => Rule.unique(),
    }),
  ],
  preview: {
    select: { title_en: 'title.en', title_it: 'title.it', title_fr: 'title.fr', title_de: 'title.de', courses: 'courses' },
    prepare: ({ title_en, title_it, title_fr, title_de, courses }: { title_en?: string; title_it?: string; title_fr?: string; title_de?: string; courses?: unknown[] }) => ({
      title: title_en ?? title_fr ?? title_it ?? title_de ?? 'Courses',
      subtitle: `Course List Section — ${courses?.length ? `${courses.length} picked courses` : 'all published courses'}`,
    }),
  },
})

export const coursesSchemaTypes = [courseType, timetableNotesTextType, timetableSectionType, courseListSectionType]
