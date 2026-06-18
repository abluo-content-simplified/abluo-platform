import { defineType, defineField, defineArrayMember } from 'sanity'
import { TenantLinker } from '@/lib/sanity/fields/TenantLinker'
import { ProjectLinker } from '@/lib/sanity/fields/ProjectLinker'
import { ProjectSlugPicker } from '@/lib/sanity/fields/ProjectSlugPicker'
import { LocalizedStringInput, LocalizedTextInput, LocalizedPortableTextInput, LocalizedSlugInput } from '@/lib/sanity/fields/LocalizedInput'
import { PLATFORM_LOCALES, LOCALE_CODES } from '@/lib/i18n/locales'

// ─── Shared primitive types ───────────────────────────────────────────────────
// Fields are generated from the Platform Locale Registry (src/lib/i18n/locales.ts).
// To add a language, add it to PLATFORM_LOCALES — these types update automatically.

const localizedStringType = defineType({
  name: 'localizedString',
  title: 'Localized String',
  type: 'object',
  components: { input: LocalizedStringInput },
  fields: LOCALE_CODES.map((code) =>
    defineField({ name: code, title: PLATFORM_LOCALES[code].nativeName, type: 'string' })
  ),
})

const localizedTextType = defineType({
  name: 'localizedText',
  title: 'Localized Text',
  type: 'object',
  components: { input: LocalizedTextInput },
  fields: LOCALE_CODES.map((code) =>
    defineField({ name: code, title: PLATFORM_LOCALES[code].nativeName, type: 'text', rows: 3 })
  ),
})

const localizedPortableTextType = defineType({
  name: 'localizedPortableText',
  title: 'Localized Rich Text',
  type: 'object',
  components: { input: LocalizedPortableTextInput },
  fields: LOCALE_CODES.map((code) =>
    defineField({
      name: code,
      title: PLATFORM_LOCALES[code].nativeName,
      type: 'array',
      of: [defineArrayMember({ type: 'block' })],
    })
  ),
})

// Each locale field is a proper Sanity slug — keeps slug generation, validation,
// and uniqueness checks. Source auto-generates from the matching locale's title.
// Tenant-aware: only the project's supportedLocales are shown in Studio (Phase 2).
const localizedSlugType = defineType({
  name: 'localizedSlug',
  title: 'Localized Slug',
  type: 'object',
  components: { input: LocalizedSlugInput },
  fields: LOCALE_CODES.map((code) =>
    defineField({
      name: code,
      title: PLATFORM_LOCALES[code].nativeName,
      type: 'slug',
      options: {
        source: (doc: Record<string, unknown>) => {
          const title = doc.title as Record<string, string> | undefined
          return title?.[code] ?? title?.en ?? ''
        },
        maxLength: 96,
      },
    })
  ),
})

// Per-locale arrays of old slugs that should 301-redirect to the current slug.
// Editors populate these whenever they rename a page slug.
const redirectFromType = defineType({
  name: 'redirectFrom',
  title: 'Redirect From (old URLs)',
  type: 'object',
  fields: LOCALE_CODES.map((code) =>
    defineField({
      name: code,
      title: PLATFORM_LOCALES[code].nativeName,
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      description: `Old ${PLATFORM_LOCALES[code].nativeName} slugs that should redirect to the current slug`,
    })
  ),
})

// ─── Shared object types ──────────────────────────────────────────────────────

const localizedImageType = defineType({
  name: 'localizedImage',
  title: 'Image',
  type: 'image',
  options: { hotspot: true },
  fields: [
    defineField({
      name: 'alt',
      title: 'Alt Text',
      type: 'localizedString',
      description: 'Describe the image for screen readers and SEO',
    }),
    defineField({ name: 'caption', title: 'Caption (optional)', type: 'localizedString' }),
  ],
})

const navigationLinkType = defineType({
  name: 'navigationLink',
  title: 'Navigation Link',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'localizedString' }),
    defineField({
      name: 'linkType',
      title: 'Link Type',
      type: 'string',
      options: {
        list: [
          { title: 'Internal Page', value: 'internal' },
          { title: 'External URL', value: 'external' },
        ],
        layout: 'radio',
      },
      initialValue: 'external',
    }),
    defineField({
      name: 'internalPage',
      title: 'Select Page',
      type: 'string',
      options: {
        list: [
          { title: 'Homepage', value: 'homepage' },
          { title: 'Live Events', value: 'live' },
        ],
      },
      hidden: ({ parent }: { parent?: { linkType?: string } }) => parent?.linkType !== 'internal',
      description: 'Select an internal page to link to',
    }),
    defineField({
      name: 'externalUrl',
      title: 'URL',
      type: 'url',
      hidden: ({ parent }: { parent?: { linkType?: string } }) => parent?.linkType !== 'external',
      validation: (Rule) =>
        Rule.custom((url, context) => {
          const parent = context.parent as any
          if (parent?.linkType === 'external' && !url) {
            return 'URL is required for external links'
          }
          return true
        }),
    }),
    defineField({
      name: 'openInNewTab',
      title: 'Open in New Tab',
      type: 'boolean',
      initialValue: false,
    }),
    // Keep href for backward compatibility — populated by a computed field or hook
    defineField({
      name: 'href',
      title: 'Computed URL (auto-populated)',
      type: 'string',
      readOnly: true,
      description: 'Auto-computed from linkType. Do not edit directly.',
      hidden: true,
    }),
    defineField({
      name: 'external',
      title: 'External (legacy, use openInNewTab instead)',
      type: 'boolean',
      hidden: true,
    }),
    defineField({
      name: 'children',
      title: 'Child Items (for future dropdown support)',
      type: 'array',
      of: [defineArrayMember({ type: 'navigationLink' })],
      description: 'Leave empty for now. Reserved for nested navigation in v2.',
    }),
  ],
  preview: {
    select: { title: 'label.en', linkType: 'linkType', internalPage: 'internalPage', externalUrl: 'externalUrl' },
    prepare: ({ title, linkType, internalPage, externalUrl }) => ({
      title: title ?? '—',
      subtitle: linkType === 'internal' ? `📄 ${internalPage}` : `🔗 ${externalUrl}`,
    }),
  },
})

const socialLinkType = defineType({
  name: 'socialLink',
  title: 'Social Link',
  type: 'object',
  fields: [
    defineField({
      name: 'platform',
      title: 'Platform',
      type: 'string',
      options: { list: ['youtube', 'instagram', 'linkedin', 'facebook', 'x', 'tiktok', 'threads'] },
    }),
    defineField({ name: 'url', title: 'URL', type: 'url' }),
  ],
  preview: {
    select: { title: 'platform', subtitle: 'url' },
    prepare: ({ title, subtitle }) => ({ title: title ?? 'Social', subtitle }),
  },
})

const scheduleItemType = defineType({
  name: 'scheduleItem',
  title: 'Schedule Item',
  type: 'object',
  fields: [
    defineField({ name: 'time', title: 'Time', type: 'string', description: 'e.g. 11:00' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'time', subtitle: 'title.en' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '—', subtitle }),
  },
})

const whatsappSubjectType = defineType({
  name: 'whatsappSubject',
  title: 'WhatsApp Subject',
  type: 'object',
  fields: [
    defineField({ name: 'subject', title: 'Subject', type: 'localizedString' }),
  ],
  preview: {
    select: { title: 'subject.en' },
    prepare: ({ title }) => ({ title: title ?? '—' }),
  },
})

const emailSubjectType = defineType({
  name: 'emailSubject',
  title: 'Email Subject',
  type: 'object',
  fields: [
    defineField({ name: 'subject', title: 'Subject Line', type: 'localizedString' }),
    defineField({ name: 'firstLine', title: 'First Line of Email Body', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'subject.en' },
    prepare: ({ title }) => ({ title: title ?? '—' }),
  },
})

// ─── projectSlug — the shared linking field ───────────────────────────────────
//
// PATTERN FOR PROJECT-SCOPED CONTENT TYPES:
//
// Every project-owned document type (Event, Post, Page, FAQ, Service, etc.) must follow this pattern:
//
// 1. IN SCHEMA (src/lib/sanity/schema.ts):
//    - Add projectSlugField as the first field in fields array
//    - Ensure the type is exported in schemaTypes array
//
//    const myType = defineType({
//      name: 'myType',
//      title: 'My Type',
//      type: 'document',
//      fields: [
//        projectSlugField,  // ← REQUIRED, handles read-only + required validation
//        ... other fields
//      ],
//    })
//
// 2. IN INITIAL VALUE TEMPLATES (src/lib/sanity/schema.ts):
//    - Add template with id matching the schema type name
//    - Declare parameters array with projectSlug parameter
//    - Receive and set projectSlug in value function
//
//    {
//      id: 'myType',  // ← id MUST match schemaType
//      title: 'My Type',
//      schemaType: 'myType',
//      parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
//      value: ({ projectSlug }: { projectSlug: string }) => ({
//        projectSlug,  // ← MUST set projectSlug from parameter
//        ... other initial values
//      }),
//    }
//
// 3. IN STRUCTURE TOOL (sanity.config.ts):
//    - Add .schemaType('myType') to the documentList
//    - Call .initialValueTemplates([S.initialValueTemplateItem('myType', { projectSlug: slug })])
//    - Pass the projectSlug from the structure context
//
//    S.documentList()
//      .title('My Type')
//      .schemaType('myType')  // ← REQUIRED
//      .filter(`_type == "myType" && projectSlug == $slug`)
//      .params({ slug })
//      .initialValueTemplates([
//        S.initialValueTemplateItem('myType', { projectSlug: slug })  // ← REQUIRED
//      ])
//
// How it works:
// - User navigates to Project → My Type
// - User clicks "+" to create new document
// - Sanity calls the template's value() function with { projectSlug: slug }
// - Template sets projectSlug in the initial document value
// - Document is created with projectSlug pre-filled
// - Document automatically appears in correct project folder
// - Document does NOT appear in Unassigned Content
//
// Result:
// - ✓ New documents are automatically assigned to the project they're created in
// - ✓ projectSlug is visible, read-only, and required
// - ✓ No duplicate create menu entries (id matches schemaType)
// - ✓ Unassigned Content is a safety net for orphaned documents
// - ✓ Pattern scales to any future project-scoped type
//
const projectSlugField = defineField({
  name: 'projectSlug',
  title: 'Project',
  type: 'string',
  validation: (Rule) => Rule.required(),
  components: {
    input: ProjectSlugPicker,
  },
})

// ─── Section object types ─────────────────────────────────────────────────────

const heroSectionType = defineType({
  name: 'heroSection',
  title: 'Hero Section',
  type: 'object',
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: {
        list: [
          { title: '⬜ Use Page Pattern', value: 'usePagePattern' },
          { title: '⬜ Surface 1', value: 'surface1' },
          { title: '⬜ Surface 2', value: 'surface2' },
          { title: '🟦 Surface 3', value: 'surface3' },
          { title: '🟢 Brand Surface', value: 'brandSurface' },
          { title: '◻ Transparent', value: 'transparent' },
          { title: '🔲 Glass', value: 'glass' },
        ],
      },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'headline', title: 'Headline', type: 'localizedText' }),
    defineField({ name: 'subheadline', title: 'Subheadline', type: 'localizedText' }),
    defineField({ name: 'ctaLabel', title: 'CTA Button Label', type: 'localizedString' }),
    defineField({ name: 'ctaHref', title: 'CTA Button Link', type: 'string' }),
  ],
  preview: {
    select: { title: 'headline.it' },
    prepare: ({ title }) => ({ title: title ?? 'Hero', subtitle: 'Hero Section' }),
  },
})

const contentSectionType = defineType({
  name: 'contentSection',
  title: 'Content Section',
  type: 'object',
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: {
        list: [
          { title: '⬜ Use Page Pattern', value: 'usePagePattern' },
          { title: '⬜ Surface 1', value: 'surface1' },
          { title: '⬜ Surface 2', value: 'surface2' },
          { title: '🟦 Surface 3', value: 'surface3' },
          { title: '🟢 Brand Surface', value: 'brandSurface' },
          { title: '◻ Transparent', value: 'transparent' },
          { title: '🔲 Glass', value: 'glass' },
        ],
      },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'body', title: 'Body', type: 'localizedPortableText' }),
    defineField({
      name: 'imagePosition',
      title: 'Image Position',
      type: 'string',
      options: { list: ['left', 'right'] },
    }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Content', subtitle: 'Content Section' }),
  },
})

const treatmentCardType = defineType({
  name: 'treatmentCard',
  title: 'Treatment',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'localizedString' }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'localizedString' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'name.it' },
    prepare: ({ title }) => ({ title: title ?? 'Treatment' }),
  },
})

const treatmentsSectionType = defineType({
  name: 'treatmentsSection',
  title: 'Treatments Section',
  type: 'object',
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: {
        list: [
          { title: '⬜ Use Page Pattern', value: 'usePagePattern' },
          { title: '⬜ Surface 1', value: 'surface1' },
          { title: '⬜ Surface 2', value: 'surface2' },
          { title: '🟦 Surface 3', value: 'surface3' },
          { title: '🟢 Brand Surface', value: 'brandSurface' },
          { title: '◻ Transparent', value: 'transparent' },
          { title: '🔲 Glass', value: 'glass' },
        ],
      },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'intro', title: 'Intro Text', type: 'localizedText' }),
    defineField({
      name: 'treatments',
      title: 'Treatments',
      type: 'array',
      of: [defineArrayMember({ type: 'treatmentCard' })],
    }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Treatments', subtitle: 'Treatments Section' }),
  },
})

const teamMemberType = defineType({
  name: 'teamMemberObject',
  title: 'Team Member',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'string' }),
    defineField({ name: 'role', title: 'Role', type: 'localizedString' }),
    defineField({ name: 'bio', title: 'Bio', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'role.it' },
    prepare: ({ title, subtitle }) => ({ title: title ?? 'Team Member', subtitle }),
  },
})

const teamSectionType = defineType({
  name: 'teamSection',
  title: 'Team Section',
  type: 'object',
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: {
        list: [
          { title: '⬜ Use Page Pattern', value: 'usePagePattern' },
          { title: '⬜ Surface 1', value: 'surface1' },
          { title: '⬜ Surface 2', value: 'surface2' },
          { title: '🟦 Surface 3', value: 'surface3' },
          { title: '🟢 Brand Surface', value: 'brandSurface' },
          { title: '◻ Transparent', value: 'transparent' },
          { title: '🔲 Glass', value: 'glass' },
        ],
      },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'subtitle', title: 'Subtitle', type: 'localizedText' }),
    defineField({
      name: 'members',
      title: 'Members',
      type: 'array',
      of: [defineArrayMember({ type: 'teamMemberObject' })],
    }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Team', subtitle: 'Team Section' }),
  },
})

const textSectionType = defineType({
  name: 'textSection',
  title: 'Text Section',
  type: 'object',
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: {
        list: [
          { title: '⬜ Use Page Pattern', value: 'usePagePattern' },
          { title: '⬜ Surface 1', value: 'surface1' },
          { title: '⬜ Surface 2', value: 'surface2' },
          { title: '🟦 Surface 3', value: 'surface3' },
          { title: '🟢 Brand Surface', value: 'brandSurface' },
          { title: '◻ Transparent', value: 'transparent' },
          { title: '🔲 Glass', value: 'glass' },
        ],
      },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'content', title: 'Content', type: 'localizedPortableText' }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Text', subtitle: 'Text Section' }),
  },
})

const contactSectionType = defineType({
  name: 'contactSection',
  title: 'Contact Section',
  type: 'object',
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: {
        list: [
          { title: '⬜ Use Page Pattern', value: 'usePagePattern' },
          { title: '⬜ Surface 1', value: 'surface1' },
          { title: '⬜ Surface 2', value: 'surface2' },
          { title: '🟦 Surface 3', value: 'surface3' },
          { title: '🟢 Brand Surface', value: 'brandSurface' },
          { title: '◻ Transparent', value: 'transparent' },
          { title: '🔲 Glass', value: 'glass' },
        ],
      },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'subtitle', title: 'Subtitle', type: 'localizedText' }),
    defineField({ name: 'mapEmbedUrl', title: 'Google Maps Embed URL', type: 'url' }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Contact', subtitle: 'Contact Section' }),
  },
})

const faqItemType = defineType({
  name: 'faqItem',
  title: 'FAQ Item',
  type: 'object',
  fields: [
    defineField({ name: 'question', title: 'Question', type: 'localizedString' }),
    defineField({ name: 'answer', title: 'Answer', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'question.it' },
    prepare: ({ title }) => ({ title: title ?? 'FAQ Item' }),
  },
})

const faqSectionType = defineType({
  name: 'faqSection',
  title: 'FAQ Section',
  type: 'object',
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: {
        list: [
          { title: '⬜ Use Page Pattern', value: 'usePagePattern' },
          { title: '⬜ Surface 1', value: 'surface1' },
          { title: '⬜ Surface 2', value: 'surface2' },
          { title: '🟦 Surface 3', value: 'surface3' },
          { title: '🟢 Brand Surface', value: 'brandSurface' },
          { title: '◻ Transparent', value: 'transparent' },
          { title: '🔲 Glass', value: 'glass' },
        ],
      },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({
      name: 'items',
      title: 'Questions',
      type: 'array',
      of: [defineArrayMember({ type: 'faqItem' })],
    }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'FAQ', subtitle: 'FAQ Section' }),
  },
})

// ─── Platform document types (admin-only) ─────────────────────────────────────

const clientType = defineType({
  name: 'client',
  title: 'Client',
  type: 'document',
  components: { input: TenantLinker },
  fields: [
    defineField({
      name: 'tenantId',
      title: 'Tenant ID',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'tenantSlug',
      title: 'Tenant Slug',
      type: 'string',
      hidden: true,
    }),
    defineField({
      name: 'displayName',
      title: 'Display Name',
      type: 'string',
      hidden: true,
    }),
  ],
  preview: {
    select: { title: 'displayName', subtitle: 'tenantSlug' },
    prepare: ({ title, subtitle }) => ({
      title: title ?? 'Link Tenant',
      subtitle: subtitle ?? '—',
    }),
  },
})

const projectType = defineType({
  name: 'project',
  title: 'Project',
  type: 'document',
  components: { input: ProjectLinker },
  fields: [
    // ── Auto-populated by ProjectLinker (hidden from default form) ──────────
    defineField({ name: 'clientRef',    title: 'Client',       type: 'reference', to: [{ type: 'client' }], hidden: true }),
    defineField({ name: 'projectId',    title: 'Project ID',   type: 'string',    hidden: true, validation: (Rule) => Rule.required() }),
    defineField({ name: 'projectSlug',  title: 'Project Slug', type: 'string',    hidden: true }),
    defineField({ name: 'projectName',  title: 'Project Name', type: 'string',    hidden: true }),
    defineField({ name: 'tenantId',     title: 'Tenant ID',    type: 'string',    hidden: true }),
    defineField({ name: 'customDomain', title: 'Custom Domain',type: 'string',    hidden: true }),
    // ── Sanity-only fields (visible, editor fills these after linking) ──────
    defineField({
      name: 'defaultLocale',
      title: 'Default Locale',
      type: 'string',
      options: { list: LOCALE_CODES.map((code) => ({ title: PLATFORM_LOCALES[code].nativeName, value: code })), layout: 'radio' },
      initialValue: 'en',
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: { list: ['active', 'inactive', 'archived'] },
      initialValue: 'active',
    }),
    defineField({
      name: 'designSystemRef',
      title: 'Design System',
      type: 'reference',
      to: [{ type: 'designSystem' }],
      description: 'The design system this project uses for colors, typography, and spacing',
      hidden: true, // managed by ProjectLinker UI, not the default form
    }),
  ],
  preview: {
    select: { title: 'projectName', subtitle: 'projectSlug' },
    prepare: ({ title, subtitle }) => ({
      title: title ?? 'Link Project',
      subtitle: subtitle ?? '—',
    }),
  },
})

// ─── Design System ────────────────────────────────────────────────────────────

const colorThemeType = defineType({
  name: 'colorTheme',
  title: 'Color Theme',
  type: 'object',
  fields: [
    defineField({ name: 'background', title: 'Background', type: 'string' }),
    defineField({ name: 'backgroundAlt', title: 'Background Alt', type: 'string' }),
    defineField({ name: 'surface', title: 'Surface', type: 'string' }),
    defineField({ name: 'primary', title: 'Primary', type: 'string' }),
    defineField({ name: 'secondary', title: 'Secondary', type: 'string' }),
    defineField({ name: 'accent', title: 'Accent', type: 'string' }),
    defineField({ name: 'textPrimary', title: 'Text Primary', type: 'string' }),
    defineField({ name: 'textSecondary', title: 'Text Secondary', type: 'string' }),
    defineField({ name: 'textMuted', title: 'Text Muted', type: 'string' }),
    defineField({ name: 'border', title: 'Border', type: 'string' }),
    defineField({ name: 'success', title: 'Success', type: 'string' }),
    defineField({ name: 'warning', title: 'Warning', type: 'string' }),
    defineField({ name: 'danger', title: 'Danger', type: 'string' }),
  ],
})

const LIBRARY_FONTS = [
  { title: 'Geist', value: 'Geist' },
  { title: 'Inter', value: 'Inter' },
  { title: 'Poppins', value: 'Poppins' },
  { title: 'Manrope', value: 'Manrope' },
  { title: 'Barlow Condensed', value: 'Barlow Condensed' },
  { title: 'Roboto', value: 'Roboto' },
  { title: 'Montserrat', value: 'Montserrat' },
  { title: 'Open Sans', value: 'Open Sans' },
  { title: 'Playfair Display', value: 'Playfair Display' },
  { title: 'Lora', value: 'Lora' },
]

const fontDefinitionType = defineType({
  name: 'fontDefinition',
  title: 'Font',
  type: 'object',
  fields: [
    defineField({
      name: 'source',
      title: 'Font Source',
      type: 'string',
      options: { list: [{ title: 'Library Font', value: 'library' }, { title: 'Google Font', value: 'google' }], layout: 'radio' },
      initialValue: 'library',
    }),
    defineField({
      name: 'libraryFont',
      title: 'Library Font',
      type: 'string',
      description: 'Select from the curated font library',
      options: { list: LIBRARY_FONTS },
      hidden: ({ parent }: { parent?: { source?: string } }) => parent?.source !== 'library',
    }),
    defineField({
      name: 'googleFont',
      title: 'Google Font Family Name',
      type: 'string',
      description: 'Exact family name from Google Fonts — e.g. "Space Grotesk", "DM Sans"',
      hidden: ({ parent }: { parent?: { source?: string } }) => parent?.source !== 'google',
    }),
  ],
})

const typescaleType = defineType({
  name: 'typescale',
  title: 'Type Scale',
  type: 'object',
  fields: [
    defineField({ name: 'size', title: 'Size (px)', type: 'number' }),
    defineField({ name: 'weight', title: 'Weight', type: 'number' }),
    defineField({ name: 'lineHeight', title: 'Line Height', type: 'number' }),
    defineField({ name: 'letterSpacing', title: 'Letter Spacing (px)', type: 'number' }),
  ],
})

const buttonStyleType = defineType({
  name: 'buttonStyle',
  title: 'Button Style',
  type: 'object',
  fields: [
    defineField({ name: 'background', title: 'Background', type: 'string' }),
    defineField({ name: 'text', title: 'Text Color', type: 'string' }),
    defineField({ name: 'borderRadius', title: 'Border Radius (px)', type: 'number' }),
  ],
})

const buttonStyleThemeType = defineType({
  name: 'buttonStyleTheme',
  title: 'Button Style (Theme)',
  type: 'object',
  description: 'Theme-specific button styling — explicit tokens, not derived',
  fields: [
    defineField({
      name: 'background',
      title: 'Background',
      type: 'string',
      description: 'Explicit token — e.g. var(--primary) or OKLCH color',
    }),
    defineField({
      name: 'text',
      title: 'Text Color',
      type: 'string',
      description: 'Explicit token — text color for this button',
    }),
    defineField({
      name: 'borderRadius',
      title: 'Border Radius (px)',
      type: 'number',
      description: 'Optional — can override theme default',
    }),
    defineField({
      name: 'hover',
      title: 'Hover State (Optional Override)',
      type: 'object',
      description: 'Leave empty to use default hover behavior',
      fields: [
        defineField({
          name: 'background',
          title: 'Hover Background',
          type: 'string',
          description: 'Optional explicit override',
        }),
        defineField({
          name: 'text',
          title: 'Hover Text Color',
          type: 'string',
          description: 'Optional explicit override',
        }),
      ],
    }),
  ],
})

const cardStyleThemeType = defineType({
  name: 'cardStyleTheme',
  title: 'Card Style (Theme)',
  type: 'object',
  description: 'Theme-specific card styling — explicit tokens, not derived',
  fields: [
    defineField({
      name: 'background',
      title: 'Background',
      type: 'string',
      description: 'Explicit token — e.g. var(--surface) or OKLCH color',
    }),
    defineField({
      name: 'border',
      title: 'Border Color',
      type: 'string',
      description: 'Explicit token — border color for this card',
    }),
  ],
})

// ─── Section Surface System ───────────────────────────────────────────────────

const glassStyleType = defineType({
  name: 'glassStyle',
  title: 'Glass Style',
  type: 'object',
  description: 'Semi-transparent surface with optional backdrop blur',
  fields: [
    defineField({
      name: 'backgroundOklch',
      title: 'Background (OKLCH with alpha)',
      type: 'string',
      description: 'OKLCH color with transparency — e.g. "oklch(0.8 0.1 200 / 0.75)"',
    }),
    defineField({
      name: 'backdropBlur',
      title: 'Backdrop Blur (px)',
      type: 'number',
      description: 'Blur amount — 0 for no blur, 10-20 typical for premium effect',
      initialValue: 12,
    }),
    defineField({
      name: 'borderColor',
      title: 'Border Color (OKLCH)',
      type: 'string',
      description: 'Border color in OKLCH — e.g. "oklch(1 0 0 / 0.1)"',
    }),
    defineField({
      name: 'borderWidth',
      title: 'Border Width (px)',
      type: 'number',
      initialValue: 1,
    }),
  ],
})

const sectionSurfacesThemeType = defineType({
  name: 'sectionSurfacesTheme',
  title: 'Section Surfaces (Theme)',
  type: 'object',
  description: 'Theme-specific section surfaces — explicit tokens, not derived',
  fields: [
    defineField({
      name: 'surface1',
      title: 'Surface 1 (Primary Background)',
      type: 'string',
      description: 'Explicit token — usually var(--color-background) or OKLCH',
    }),
    defineField({
      name: 'surface2',
      title: 'Surface 2 (Secondary Background)',
      type: 'string',
      description: 'Explicit token — usually var(--color-background-alt) or OKLCH',
    }),
    defineField({
      name: 'surface3',
      title: 'Surface 3 (Tertiary Background)',
      type: 'string',
      description: 'Explicit token — optional tertiary surface for advanced rhythms',
    }),
    defineField({
      name: 'brandSurface',
      title: 'Brand Surface',
      type: 'string',
      description: 'Explicit token — brand color surface drawn from tenant branding',
    }),
    defineField({
      name: 'glass',
      title: 'Glass Surface',
      type: 'glassStyle',
      description: 'Semi-transparent surface for premium sections',
    }),
  ],
})

const sectionSurfacesType = defineType({
  name: 'sectionSurfaces',
  title: 'Section Surfaces',
  type: 'object',
  description: 'Define the reusable background surfaces for page sections — theme-aware',
  fields: [
    defineField({
      name: 'lightTheme',
      title: 'Light Theme',
      type: 'sectionSurfacesTheme',
      description: 'Surfaces for light theme',
    }),
    defineField({
      name: 'darkTheme',
      title: 'Dark Theme',
      type: 'sectionSurfacesTheme',
      description: 'Surfaces for dark theme',
    }),
  ],
})

const backgroundAssetType = defineType({
  name: 'backgroundAsset',
  title: 'Background Asset',
  type: 'object',
  fields: [
    defineField({
      name: 'key',
      title: 'Key / Slug',
      type: 'string',
      description: 'Unique identifier for this asset (e.g. "logotype", "pattern-dark") — used in components to reference this asset',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'name',
      title: 'Display Name',
      type: 'string',
      description: 'Human-readable name for Studio',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'lightImage',
      title: 'Light Theme Image',
      type: 'image',
      description: 'Image for light theme',
      options: { hotspot: false },
    }),
    defineField({
      name: 'darkImage',
      title: 'Dark Theme Image',
      type: 'image',
      description: 'Image for dark theme',
      options: { hotspot: false },
    }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'key' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '—', subtitle }),
  },
})

// ─── Form Field System ────────────────────────────────────────────────────────

const formInputThemeType = defineType({
  name: 'formInputTheme',
  title: 'Form Input (Theme)',
  type: 'object',
  description: 'Theme-specific styling for a form element',
  fields: [
    defineField({ name: 'background', title: 'Background', type: 'string', description: 'Input background — e.g. var(--color-surface) or OKLCH' }),
    defineField({ name: 'border', title: 'Border Color', type: 'string', description: 'Default border color' }),
    defineField({ name: 'text', title: 'Text Color', type: 'string' }),
    defineField({ name: 'placeholder', title: 'Placeholder Color', type: 'string' }),
    defineField({ name: 'focusBorder', title: 'Focus Border Color', type: 'string', description: 'Border color when the input is focused' }),
    defineField({ name: 'errorBorder', title: 'Error Border Color', type: 'string', description: 'Border color in error state' }),
    defineField({ name: 'successBorder', title: 'Success Border Color', type: 'string', description: 'Border color in success state' }),
    defineField({ name: 'disabledOpacity', title: 'Disabled Opacity', type: 'number', description: '0–1 — e.g. 0.4', initialValue: 0.4, validation: (Rule) => Rule.min(0).max(1) }),
  ],
})

const formInputType = defineType({
  name: 'formInput',
  title: 'Form Input',
  type: 'object',
  fields: [
    defineField({ name: 'lightTheme', title: 'Light Theme', type: 'formInputTheme' }),
    defineField({ name: 'darkTheme', title: 'Dark Theme', type: 'formInputTheme' }),
  ],
})

// ─── Card Variant System ───────────────────────────────────────────────────────

const cardVariantType = defineType({
  name: 'cardVariant',
  title: 'Card Variant',
  type: 'object',
  fields: [
    defineField({ name: 'key', title: 'Key', type: 'string', description: 'Unique identifier — e.g. "default", "elevated", "glass", "testimonial"', validation: (Rule) => Rule.required() }),
    defineField({ name: 'label', title: 'Label', type: 'string', description: 'Human-readable name for Studio', validation: (Rule) => Rule.required() }),
    defineField({ name: 'lightTheme', title: 'Light Theme', type: 'cardStyleTheme' }),
    defineField({ name: 'darkTheme', title: 'Dark Theme', type: 'cardStyleTheme' }),
  ],
  preview: {
    select: { title: 'label', subtitle: 'key' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '—', subtitle }),
  },
})

/**
 * motionType — flat token object for all animation timing and easing.
 *
 * Stored as: durations in ms (numbers), easings as CSS cubic-bezier strings.
 * Consumers divide duration by 1000 for motion/react; pass easing string directly.
 * mergeShallowObject handles inheritance automatically — no custom merge needed.
 */
const motionType = defineType({
  name: 'motion',
  title: 'Motion',
  type: 'object',
  fields: [
    defineField({ name: 'durationFast',   title: 'Duration — Fast (ms)',   type: 'number', description: 'Micro-interactions, icon state changes — e.g. 120ms', initialValue: 120 }),
    defineField({ name: 'durationBase',   title: 'Duration — Base (ms)',   type: 'number', description: 'Standard transitions, hover effects — e.g. 200ms', initialValue: 200 }),
    defineField({ name: 'durationSlow',   title: 'Duration — Slow (ms)',   type: 'number', description: 'Reveal animations, panel slides — e.g. 350ms', initialValue: 350 }),
    defineField({ name: 'durationSlower', title: 'Duration — Slower (ms)', type: 'number', description: 'Hero entrances, page-level transitions — e.g. 600ms', initialValue: 600 }),
    defineField({
      name: 'easingStandard',
      title: 'Easing — Standard',
      type: 'string',
      description: 'General-purpose easing for most transitions',
      initialValue: 'cubic-bezier(0.4, 0, 0.2, 1)',
    }),
    defineField({
      name: 'easingDecelerate',
      title: 'Easing — Decelerate (enter)',
      type: 'string',
      description: 'Elements entering the screen — start fast, slow to stop',
      initialValue: 'cubic-bezier(0, 0, 0.2, 1)',
    }),
    defineField({
      name: 'easingAccelerate',
      title: 'Easing — Accelerate (exit)',
      type: 'string',
      description: 'Elements leaving the screen — start slow, exit quickly',
      initialValue: 'cubic-bezier(0.4, 0, 1, 1)',
    }),
    defineField({
      name: 'easingEmphasized',
      title: 'Easing — Emphasized',
      type: 'string',
      description: 'Important transitions that need extra attention — hero reveals, dialogs',
      initialValue: 'cubic-bezier(0.2, 0, 0, 1)',
    }),
  ],
})

const mediaAssetType = defineType({
  name: 'mediaAsset',
  title: 'Media Asset',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      description: 'Friendly name for this asset (e.g. "Hero Image", "Team Photo")',
    }),
    defineField({
      name: 'image',
      title: 'Image',
      type: 'image',
      description: 'Max 4000px / 10MB recommended',
      options: { hotspot: false },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'tenant',
      title: 'Tenant',
      type: 'reference',
      to: [{ type: 'client' }],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'project',
      title: 'Project',
      type: 'reference',
      to: [{ type: 'project' }],
    }),
    defineField({
      name: 'projectSlug',
      title: 'Project Slug',
      type: 'string',
      description: 'Denormalized from project reference — set by API',
      readOnly: true,
      hidden: true,
    }),
    defineField({
      name: 'tags',
      title: 'Tags',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      options: { layout: 'tags' },
    }),
    defineField({
      name: 'altText',
      title: 'Alt Text',
      type: 'localizedString',
      description: 'Alt text for screen readers and accessibility (multilingual)',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'caption',
      title: 'Caption',
      type: 'localizedString',
      description: 'Optional caption displayed beneath the image (multilingual)',
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'localizedText',
      description: 'Optional internal notes about this image (multilingual)',
    }),
    defineField({
      name: 'uploadedBy',
      title: 'Uploaded By (User ID)',
      type: 'string',
      description: 'User ID who uploaded this asset — auto-populated when user management is ready',
      readOnly: true,
      hidden: true,
    }),
    defineField({
      name: 'uploadedByName',
      title: 'Uploaded By (User Name)',
      type: 'string',
      description: 'User name/email who uploaded this asset — auto-populated when user management is ready',
      readOnly: true,
      hidden: true,
    }),
  ],
  preview: {
    select: {
      title: 'name',
      altTextEn: 'altText.en',
      media: 'image',
      subtitle: 'tags.0',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare: ({ title, altTextEn, media, subtitle }: { title?: string; altTextEn?: string; media?: any; subtitle?: string }) => ({
      title: title ?? altTextEn ?? 'Untitled',
      media,
      subtitle: subtitle ?? 'No tags',
    }),
  },
})

const designSystemType = defineType({
  name: 'designSystem',
  title: 'Design System',
  type: 'document',
  groups: [
    { name: 'meta', title: 'Info' },
    { name: 'branding', title: 'Branding' },
    { name: 'colors', title: 'Colors' },
    { name: 'typography', title: 'Typography' },
    { name: 'shape', title: 'Shape & Spacing' },
    { name: 'layout', title: 'Layout' },
    { name: 'motion', title: 'Motion' },
    { name: 'components', title: 'Components' },
  ],
  fields: [
    defineField({
      name: 'projectSlug',
      title: 'Project',
      type: 'string',
      group: 'meta',
      description: 'Which project this design system belongs to — leave empty for templates',
      readOnly: true,
    }),
    defineField({ name: 'name', title: 'Name', type: 'string', group: 'meta' }),
    defineField({
      name: 'role',
      title: 'Role',
      type: 'string',
      group: 'meta',
      description: 'Active = assigned to a project and in use. Template = not assigned, used as a base for future systems.',
      options: {
        list: [
          { title: 'Active — in use', value: 'active' },
          { title: 'Template — not assigned', value: 'template' },
        ],
        layout: 'radio',
      },
      initialValue: 'active',
    }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 2, group: 'meta' }),

    // Branding
    defineField({
      name: 'branding',
      title: 'Branding',
      type: 'object',
      group: 'branding',
      fields: [
        defineField({ name: 'logo', title: 'Logo (dark background)', type: 'image', options: { hotspot: false } }),
        defineField({ name: 'logoLight', title: 'Logo (light background)', type: 'image', options: { hotspot: false } }),
        defineField({ name: 'logoHeightDesktop', title: 'Logo Height — Desktop (px)', type: 'number', description: 'Max height of the logo in the header on desktop. Typical: 28–40px.', initialValue: 32 }),
        defineField({ name: 'logoHeightMobile', title: 'Logo Height — Mobile (px)', type: 'number', description: 'Max height of the logo in the header on mobile. Typical: 24–32px.', initialValue: 28 }),
        defineField({ name: 'favicon', title: 'Favicon', type: 'image', options: { hotspot: false } }),
        defineField({ name: 'openGraphImage', title: 'Open Graph Image', type: 'image', description: 'Social Sharing Image • 1200 x 630 pixels • Aspect ratio: 1.91:1 • JPG preferred', options: { hotspot: false } }),
        defineField({ name: 'appleTouchIcon', title: 'Apple Touch Icon', type: 'image', description: 'Used when saved to iPhone/iPad home screen • 180 x 180 pixels • PNG', options: { hotspot: false } }),
      ],
    }),

    // Background Assets
    defineField({
      name: 'backgroundAssets',
      title: 'Background Assets',
      type: 'array',
      group: 'branding',
      description: 'Reusable background images for pages and sections (light/dark variants)',
      of: [defineArrayMember({ type: 'backgroundAsset' })],
    }),

    // Colors
    defineField({
      name: 'colors',
      title: 'Colors',
      type: 'object',
      group: 'colors',
      fields: [
        defineField({ name: 'lightTheme', title: 'Light Theme', type: 'colorTheme' }),
        defineField({ name: 'darkTheme', title: 'Dark Theme', type: 'colorTheme' }),
      ],
    }),

    // Typography
    defineField({
      name: 'typography',
      title: 'Typography',
      type: 'object',
      group: 'typography',
      fields: [
        defineField({ name: 'headingFont', title: 'Heading Font', type: 'fontDefinition' }),
        defineField({ name: 'bodyFont', title: 'Body Font', type: 'fontDefinition' }),
        defineField({ name: 'h1', title: 'H1', type: 'typescale' }),
        defineField({ name: 'h2', title: 'H2', type: 'typescale' }),
        defineField({ name: 'h3', title: 'H3', type: 'typescale' }),
        defineField({ name: 'h4', title: 'H4', type: 'typescale' }),
        defineField({ name: 'bodyLarge', title: 'Body Large', type: 'typescale' }),
        defineField({ name: 'body', title: 'Body', type: 'typescale' }),
        defineField({ name: 'small', title: 'Small Text', type: 'typescale' }),
      ],
    }),

    // Radius
    defineField({
      name: 'radius',
      title: 'Border Radius',
      type: 'object',
      group: 'shape',
      fields: [
        defineField({ name: 'small', title: 'Small (px)', type: 'number' }),
        defineField({ name: 'medium', title: 'Medium (px)', type: 'number' }),
        defineField({ name: 'large', title: 'Large (px)', type: 'number' }),
      ],
    }),

    // Spacing
    defineField({
      name: 'spacing',
      title: 'Spacing',
      type: 'object',
      group: 'shape',
      fields: [
        defineField({ name: 'xs', title: 'XS (px)', type: 'number' }),
        defineField({ name: 's', title: 'S (px)', type: 'number' }),
        defineField({ name: 'm', title: 'M (px)', type: 'number' }),
        defineField({ name: 'l', title: 'L (px)', type: 'number' }),
        defineField({ name: 'xl', title: 'XL (px)', type: 'number' }),
      ],
    }),

    // Buttons (theme-aware)
    defineField({
      name: 'buttons',
      title: 'Buttons',
      type: 'object',
      group: 'components',
      description: 'Button styles per variant and theme',
      fields: [
        defineField({
          name: 'primary',
          title: 'Primary Button',
          type: 'object',
          fields: [
            defineField({
              name: 'lightTheme',
              title: 'Light Theme',
              type: 'buttonStyleTheme',
            }),
            defineField({
              name: 'darkTheme',
              title: 'Dark Theme',
              type: 'buttonStyleTheme',
            }),
          ],
        }),
        defineField({
          name: 'secondary',
          title: 'Secondary Button',
          type: 'object',
          fields: [
            defineField({
              name: 'lightTheme',
              title: 'Light Theme',
              type: 'buttonStyleTheme',
            }),
            defineField({
              name: 'darkTheme',
              title: 'Dark Theme',
              type: 'buttonStyleTheme',
            }),
          ],
        }),
      ],
    }),

    // Cards (theme-aware)
    defineField({
      name: 'cards',
      title: 'Cards',
      type: 'object',
      group: 'components',
      description: 'Card styles per theme',
      fields: [
        defineField({
          name: 'lightTheme',
          title: 'Light Theme',
          type: 'cardStyleTheme',
        }),
        defineField({
          name: 'darkTheme',
          title: 'Dark Theme',
          type: 'cardStyleTheme',
        }),
      ],
    }),

    // Section Surfaces
    defineField({
      name: 'sectionSurfaces',
      title: 'Section Surfaces',
      type: 'sectionSurfaces',
      group: 'components',
      description: 'Define the reusable background surfaces for page sections',
    }),

    // Glass — global reusable token for header, cards, modals, dropdowns
    defineField({
      name: 'glass',
      title: 'Glass Effect',
      type: 'glassStyle',
      group: 'components',
      description: 'Global glass token — consumed by the header, navigation dropdown, cards, and modals. Individual components reference this instead of defining their own glass styles.',
    }),

    // Forms
    defineField({
      name: 'forms',
      title: 'Forms',
      type: 'object',
      group: 'components',
      description: 'Form element styling — consumed by contact, newsletter, and booking forms',
      fields: [
        defineField({ name: 'input', title: 'Input', type: 'formInput' }),
        defineField({ name: 'textarea', title: 'Textarea', type: 'formInput' }),
        defineField({ name: 'select', title: 'Select', type: 'formInput' }),
        defineField({ name: 'checkbox', title: 'Checkbox', type: 'formInput' }),
        defineField({ name: 'radio', title: 'Radio', type: 'formInput' }),
      ],
    }),

    // Navigation tokens
    defineField({
      name: 'navigation',
      title: 'Navigation',
      type: 'object',
      group: 'components',
      description: 'Navigation and menu styling tokens',
      fields: [
        defineField({ name: 'menuRadius', title: 'Menu Item Radius (px)', type: 'number', description: 'Border radius of individual nav items / pills', initialValue: 8 }),
        defineField({ name: 'menuGap', title: 'Menu Gap (px)', type: 'number', description: 'Spacing between top-level nav items', initialValue: 4 }),
        defineField({ name: 'dropdownRadius', title: 'Dropdown Radius (px)', type: 'number', description: 'Border radius of the dropdown panel', initialValue: 12 }),
        defineField({
          name: 'dropdownStyle',
          title: 'Dropdown Style',
          type: 'string',
          options: { list: [{ title: 'Solid', value: 'solid' }, { title: 'Glass', value: 'glass' }, { title: 'Surface', value: 'surface' }], layout: 'radio' },
          initialValue: 'glass',
          description: 'Visual treatment of the dropdown panel — glass uses the global glass token',
        }),
      ],
    }),

    // Motion tokens — timing and easing for all animations
    defineField({
      name: 'motion',
      title: 'Motion',
      type: 'motion',
      group: 'motion',
      description: 'Animation timing and easing tokens — inherited by all components',
    }),

    // Card variants (extensible array — add pricing, testimonial, team, etc. as needed)
    defineField({
      name: 'cardVariants',
      title: 'Card Variants',
      type: 'array',
      group: 'components',
      description: 'Named card variants — reference by key in components. Add any variant you need (default, elevated, glass, testimonial, etc.).',
      of: [defineArrayMember({ type: 'cardVariant' })],
    }),

    // Shadows (semantic names — designers think in context, not sizes)
    defineField({
      name: 'shadows',
      title: 'Shadows',
      type: 'object',
      group: 'components',
      description: 'Semantic shadow tokens — used by cards, dropdowns, and modals',
      fields: [
        defineField({ name: 'card', title: 'Card Shadow', type: 'string', description: 'CSS box-shadow value for cards — e.g. "0 1px 3px oklch(0 0 0 / 0.08), 0 4px 12px oklch(0 0 0 / 0.06)"' }),
        defineField({ name: 'dropdown', title: 'Dropdown Shadow', type: 'string', description: 'CSS box-shadow value for dropdowns and popovers' }),
        defineField({ name: 'modal', title: 'Modal Shadow', type: 'string', description: 'CSS box-shadow value for modals and dialogs' }),
      ],
    }),

    // Layout tokens — section rhythm and reading width
    defineField({
      name: 'layout',
      title: 'Layout',
      type: 'object',
      group: 'layout',
      description: 'Layout tokens — control page rhythm across all sections',
      fields: [
        defineField({ name: 'maxContentWidth', title: 'Max Content Width (px)', type: 'number', description: 'Maximum width of the page container — typically 1280–1440px', initialValue: 1280 }),
        defineField({ name: 'maxTextWidth', title: 'Max Text Width (px)', type: 'number', description: 'Maximum width for reading-width text blocks — typically 680–780px', initialValue: 720 }),
        defineField({ name: 'sectionPaddingY', title: 'Section Padding Y — Normal (px)', type: 'number', description: 'Standard vertical padding for sections — top and bottom', initialValue: 96 }),
        defineField({ name: 'sectionPaddingYCompact', title: 'Section Padding Y — Compact (px)', type: 'number', description: 'Compact vertical padding for tight sections', initialValue: 56 }),
        defineField({ name: 'sectionPaddingYLarge', title: 'Section Padding Y — Large (px)', type: 'number', description: 'Large vertical padding for spacious hero-style sections', initialValue: 144 }),
      ],
    }),
  ],
  preview: {
    select: { title: 'name', slug: 'projectSlug' },
    prepare: ({ title, slug }) => ({ title: title ?? `Design System — ${slug ?? '?'}`, subtitle: slug }),
  },
})

// ─── Site Config ──────────────────────────────────────────────────────────────

const siteConfigType = defineType({
  name: 'siteConfig',
  title: 'Site Config',
  type: 'document',
  groups: [
    { name: 'branding', title: 'Branding' },
    { name: 'siteControls', title: 'Site Controls' },
    { name: 'locales', title: 'Languages' },
    { name: 'navigation', title: 'Navigation' },
    { name: 'contact', title: 'Contact' },
    { name: 'footer', title: 'Footer' },
    { name: 'social', title: 'Social' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'siteName', title: 'Site Name', type: 'string', group: 'branding' }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'localizedString', group: 'branding' }),
    defineField({ name: 'logo', title: 'Logo', type: 'localizedImage', group: 'branding' }),
    defineField({ name: 'logoLight', title: 'Logo (Light variant)', type: 'localizedImage', group: 'branding' }),
    defineField({ name: 'faviconSvg', title: 'Favicon (SVG)', type: 'image', group: 'branding' }),
    defineField({ name: 'faviconPng', title: 'Favicon (PNG)', type: 'image', group: 'branding' }),
    defineField({
      name: 'backgroundGraphic',
      title: 'Brand Watermark',
      type: 'object',
      group: 'branding',
      fields: [
        defineField({ name: 'enabled', title: 'Enable Background Graphic', type: 'boolean', initialValue: false }),
        defineField({ name: 'asset', title: 'Background Asset', type: 'image' }),
        defineField({ name: 'opacity', title: 'Opacity (%)', type: 'number', initialValue: 5, validation: (Rule) => Rule.min(0).max(100) }),
        defineField({ name: 'scale', title: 'Scale (%)', type: 'number', initialValue: 100, validation: (Rule) => Rule.min(10).max(500) }),
        defineField({ name: 'mobileScale', title: 'Mobile Scale (%)', type: 'number', validation: (Rule) => Rule.min(10).max(500) }),
        defineField({ name: 'rotation', title: 'Rotation (°)', type: 'number', initialValue: 0, validation: (Rule) => Rule.min(0).max(360) }),
        defineField({
          name: 'positionPreset',
          title: 'Position',
          type: 'string',
          options: { list: [{ title: 'Center', value: 'center' }, { title: 'Top Left', value: 'topLeft' }, { title: 'Top Right', value: 'topRight' }, { title: 'Bottom Left', value: 'bottomLeft' }, { title: 'Bottom Right', value: 'bottomRight' }], layout: 'radio' },
          initialValue: 'center',
        }),
        defineField({ name: 'offsetX', title: 'Offset X (%)', type: 'number', initialValue: 0, validation: (Rule) => Rule.min(-100).max(100) }),
        defineField({ name: 'offsetY', title: 'Offset Y (%)', type: 'number', initialValue: 0, validation: (Rule) => Rule.min(-100).max(100) }),
        defineField({ name: 'mobileOffsetX', title: 'Mobile Offset X (%)', type: 'number', validation: (Rule) => Rule.min(-100).max(100) }),
        defineField({ name: 'mobileOffsetY', title: 'Mobile Offset Y (%)', type: 'number', validation: (Rule) => Rule.min(-100).max(100) }),
        defineField({
          name: 'scrollBehavior',
          title: 'Scroll Behavior',
          type: 'string',
          options: { list: [{ title: 'Fixed', value: 'fixed' }, { title: 'Scroll With Content', value: 'scroll' }, { title: 'Parallax', value: 'parallax' }], layout: 'radio' },
          initialValue: 'scroll',
        }),
        defineField({
          name: 'scope',
          title: 'Scope',
          type: 'string',
          options: { list: [{ title: 'Entire Site', value: 'entire' }, { title: 'Homepage Only', value: 'homepage' }, { title: 'Hero Only', value: 'hero' }], layout: 'radio' },
          initialValue: 'entire',
        }),
      ],
    }),
    defineField({
      name: 'headerAppearance',
      title: 'Header Appearance',
      type: 'object',
      group: 'branding',
      fields: [
        defineField({ name: 'stickyHeader', title: 'Sticky Header', type: 'boolean', initialValue: true }),
        defineField({
          name: 'initialStyle',
          title: 'Initial Style (top of page)',
          type: 'string',
          options: { list: [{ title: 'Transparent', value: 'transparent' }, { title: 'Solid', value: 'solid' }, { title: 'Glass', value: 'glass' }], layout: 'radio' },
          initialValue: 'transparent',
        }),
        defineField({
          name: 'scrolledStyle',
          title: 'Scrolled Style (after scrolling)',
          type: 'string',
          options: { list: [{ title: 'Transparent', value: 'transparent' }, { title: 'Solid', value: 'solid' }, { title: 'Glass', value: 'glass' }], layout: 'radio' },
          initialValue: 'glass',
        }),
        defineField({ name: 'backgroundOpacity', title: 'Background Opacity (%)', type: 'number', initialValue: 85, validation: (Rule) => Rule.min(0).max(100) }),
        defineField({ name: 'blurEffect', title: 'Blur Effect', type: 'boolean', initialValue: true }),
        defineField({
          name: 'shadow',
          title: 'Shadow',
          type: 'string',
          options: { list: [{ title: 'None', value: 'none' }, { title: 'Small', value: 'small' }, { title: 'Medium', value: 'medium' }], layout: 'radio' },
          initialValue: 'small',
        }),
        defineField({
          name: 'headerHeight',
          title: 'Header Height',
          type: 'string',
          options: { list: [{ title: 'Compact', value: 'compact' }, { title: 'Normal', value: 'normal' }, { title: 'Large', value: 'large' }], layout: 'radio' },
          initialValue: 'normal',
        }),
        defineField({ name: 'customHeight', title: 'Custom Height (px)', type: 'number', description: 'Leave empty to use preset height' }),
        defineField({ name: 'zIndex', title: 'Z-Index', type: 'number', initialValue: 50 }),
        defineField({
          name: 'borderStyle',
          title: 'Border Style',
          type: 'string',
          options: { list: [{ title: 'Always', value: 'always' }, { title: 'On Scroll', value: 'onScroll' }, { title: 'Never', value: 'never' }], layout: 'radio' },
          initialValue: 'onScroll',
        }),
      ],
    }),
    defineField({
      name: 'languageSwitcherPlacement',
      title: 'Language Switcher Placement',
      type: 'string',
      group: 'siteControls',
      options: { list: [{ title: 'Header', value: 'header' }, { title: 'Footer', value: 'footer' }, { title: 'Both', value: 'both' }], layout: 'radio' },
      initialValue: 'header',
      description: 'Visibility is automatic: hidden if only 1 language, shown if 2+',
    }),
    defineField({
      name: 'themeMode',
      title: 'Theme Mode',
      type: 'string',
      group: 'siteControls',
      options: { list: [{ title: 'Light Only', value: 'lightOnly' }, { title: 'Dark Only', value: 'darkOnly' }, { title: 'Light + Dark Toggle + System', value: 'toggle' }, { title: 'Follow System', value: 'system' }], layout: 'radio' },
      initialValue: 'toggle',
      description: 'Controls whether theme switcher appears and which options are available',
    }),
    defineField({
      name: 'themeSwitcherPlacement',
      title: 'Theme Switcher Placement',
      type: 'string',
      group: 'siteControls',
      options: { list: [{ title: 'Header', value: 'header' }, { title: 'Footer', value: 'footer' }, { title: 'Both', value: 'both' }], layout: 'radio' },
      initialValue: 'header',
      description: 'Visibility determined by Theme Mode setting',
    }),
    defineField({
      name: 'defaultLocale',
      title: 'Default Language',
      type: 'string',
      group: 'locales',
      options: { list: LOCALE_CODES.map((code) => ({ title: PLATFORM_LOCALES[code].nativeName, value: code })), layout: 'radio' },
      initialValue: 'en',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'supportedLocales',
      title: 'Supported Languages',
      type: 'array',
      group: 'locales',
      of: [defineArrayMember({ type: 'string', options: { list: LOCALE_CODES.map((code) => ({ title: PLATFORM_LOCALES[code].nativeName, value: code })) } })],
      validation: (Rule) => Rule.required().min(1),
    }),
    defineField({ name: 'navLinks', title: 'Navigation Links', type: 'array', group: 'navigation', of: [defineArrayMember({ type: 'navigationLink' })] }),
    defineField({ name: 'showLangSwitcherInNav', title: 'Show language switcher in nav', type: 'boolean', group: 'navigation', initialValue: false }),
    defineField({ name: 'ctaLabel', title: 'Nav CTA Button Label', type: 'localizedString', group: 'navigation' }),
    defineField({ name: 'ctaHref', title: 'Nav CTA Button URL', type: 'string', group: 'navigation' }),
    defineField({ name: 'phone', title: 'Phone', type: 'string', group: 'contact' }),
    defineField({ name: 'email', title: 'Email', type: 'string', group: 'contact' }),
    defineField({ name: 'address', title: 'Address', type: 'text', rows: 2, group: 'contact' }),
    defineField({ name: 'contactEmail', title: 'Contact Form Recipient Email', type: 'string', group: 'contact' }),
    defineField({ name: 'mobileNumber', title: 'Mobile Number', type: 'string', group: 'contact' }),
    defineField({ name: 'whatsappNumber', title: 'WhatsApp Number', type: 'string', group: 'contact' }),
    defineField({ name: 'whatsappSubjects', title: 'WhatsApp Subject Options', type: 'array', group: 'contact', of: [defineArrayMember({ type: 'whatsappSubject' })], validation: (Rule) => Rule.max(5) }),
    defineField({ name: 'emailSubjects', title: 'Email Subject Options', type: 'array', group: 'contact', of: [defineArrayMember({ type: 'emailSubject' })], validation: (Rule) => Rule.max(5) }),
    defineField({ name: 'footerLinks', title: 'Footer Links', type: 'array', group: 'footer', of: [defineArrayMember({ type: 'navigationLink' })] }),
    defineField({ name: 'footerCtaHeading', title: 'Footer CTA Heading', type: 'localizedString', group: 'footer' }),
    defineField({ name: 'footerCtaSubtext', title: 'Footer CTA Subtext', type: 'localizedString', group: 'footer' }),
    defineField({ name: 'footerCtaInputPlaceholder', title: 'Footer CTA Input Placeholder', type: 'localizedString', group: 'footer' }),
    defineField({ name: 'footerCtaButtonLabel', title: 'Footer CTA Button Label', type: 'localizedString', group: 'footer' }),
    defineField({ name: 'legalName', title: 'Legal Company Name', type: 'string', group: 'footer' }),
    defineField({ name: 'legalAddress', title: 'Legal Address', type: 'text', rows: 2, group: 'footer' }),
    defineField({ name: 'registrationInfo', title: 'Registration Info', type: 'string', group: 'footer' }),
    defineField({ name: 'foundedYear', title: 'Founded Year', type: 'number', group: 'footer' }),
    defineField({ name: 'youtubeChannelUrl', title: 'YouTube Channel URL', type: 'url', group: 'social' }),
    defineField({ name: 'socialLinks', title: 'Social Links', type: 'array', group: 'social', of: [defineArrayMember({ type: 'socialLink' })] }),
  ],
  preview: {
    select: { title: 'siteName', slug: 'projectSlug' },
    prepare: ({ title, slug }) => ({ title: title ?? slug ?? 'Site Config', subtitle: slug }),
  },
})

// ─── Live Page ────────────────────────────────────────────────────────────────

const livePageType = defineType({
  name: 'livePage',
  title: 'Live Page',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'video', title: 'Video' },
    { name: 'events', title: 'Featured Events' },
    { name: 'meta', title: 'SEO / Meta' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'heroTitle', title: 'Hero Title', type: 'localizedString', group: 'content', description: 'e.g. "Welcome to Livener"' }),
    defineField({ name: 'heroSubtitle', title: 'Hero Subtitle', type: 'localizedString', group: 'content', description: 'e.g. "Live video streaming, in the palm of your hands"' }),
    defineField({ name: 'betaNotice', title: 'Beta Notice', type: 'localizedString', group: 'content', description: 'e.g. "Currently in beta — tested live, in real environments."' }),
    defineField({ name: 'introText', title: 'Intro Text', type: 'localizedText', group: 'content' }),
    defineField({
      name: 'cloudflareVideoId',
      title: 'Cloudflare Video ID',
      type: 'string',
      group: 'video',
      description: 'The video ID from Cloudflare Stream (e.g. "abc123xyz"). The embed URL is generated automatically.',
    }),
    defineField({
      name: 'featuredEvents',
      title: 'Featured Events',
      type: 'array',
      group: 'events',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'event' }] })],
      description: 'Events to show in the past events grid. If empty, past events are shown automatically.',
    }),
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'localizedString', group: 'meta' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'localizedText', group: 'meta' }),
  ],
  preview: {
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: 'Live Page', subtitle: slug }),
  },
})

// ─── Events Page ──────────────────────────────────────────────────────────────

const eventsPageType = defineType({
  name: 'eventsPage',
  title: 'Events Page',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'media', title: 'Media' },
    { name: 'meta', title: 'SEO / Meta' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'heroTitle', title: 'Hero Title', type: 'localizedString', group: 'content', description: 'e.g. "Events"' }),
    defineField({ name: 'heroSubtitle', title: 'Hero Subtitle', type: 'localizedString', group: 'content' }),
    defineField({ name: 'introText', title: 'Intro Text', type: 'localizedText', group: 'content' }),
    defineField({ name: 'heroImage', title: 'Hero Image', type: 'localizedImage', group: 'media' }),
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'localizedString', group: 'meta' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'localizedText', group: 'meta' }),
  ],
  preview: {
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: 'Events Page', subtitle: slug }),
  },
})

// ─── Event ────────────────────────────────────────────────────────────────────

const eventType = defineType({
  name: 'event',
  title: 'Event',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'schedule', title: 'Schedule' },
    { name: 'media', title: 'Media' },
    { name: 'streaming', title: 'Streaming' },
    { name: 'meta', title: 'SEO / Meta' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'title', title: 'Title', type: 'localizedString', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'localizedSlug', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({ name: 'redirectFrom', title: 'Old Slugs (Redirects)', type: 'redirectFrom', group: 'content' }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'content',
      options: { list: [{ title: '🟡 Upcoming', value: 'upcoming' }, { title: '🔴 Live', value: 'live' }, { title: '⚫ Past', value: 'past' }], layout: 'radio' },
      initialValue: 'upcoming',
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'isCurrentLiveEvent', title: 'Feature on /live page', type: 'boolean', group: 'content', initialValue: false }),
    defineField({ name: 'startDate', title: 'Start Date & Time', type: 'datetime', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({ name: 'endDate', title: 'End Date & Time', type: 'datetime', group: 'content' }),
    defineField({ name: 'location', title: 'Location', type: 'localizedString', group: 'content' }),
    defineField({ name: 'shortDescription', title: 'Short Description', type: 'localizedText', group: 'content' }),
    defineField({ name: 'fullDescription', title: 'Full Description', type: 'localizedPortableText', group: 'content' }),
    defineField({ name: 'schedule', title: 'Schedule', type: 'array', group: 'schedule', of: [defineArrayMember({ type: 'scheduleItem' })] }),
    defineField({ name: 'heroImage', title: 'Hero Image', type: 'localizedImage', group: 'media' }),
    defineField({ name: 'gallery', title: 'Gallery', type: 'array', group: 'media', of: [defineArrayMember({ type: 'localizedImage' })] }),
    defineField({ name: 'youtubeUrl', title: 'YouTube Stream / Video URL', type: 'url', group: 'streaming' }),
    defineField({ name: 'youtubeChannelUrl', title: 'YouTube Channel URL', type: 'url', group: 'streaming' }),
    defineField({ name: 'ctaLabel', title: 'CTA Button Label', type: 'localizedString', group: 'streaming' }),
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'localizedString', group: 'meta' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'localizedText', group: 'meta' }),
  ],
  preview: {
    select: { title: 'title.en', subtitle: 'status', slug: 'projectSlug' },
    prepare: ({ title, subtitle, slug }) => ({ title: title ?? 'Untitled Event', subtitle: `${slug} · ${subtitle ?? '?'}` }),
  },
})

// ─── Page ─────────────────────────────────────────────────────────────────────

const pageType = defineType({
  name: 'page',
  title: 'Page',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({
      name: 'pageType',
      title: 'Page Type',
      type: 'string',
      options: {
        list: [
          { title: 'Home', value: 'home' },
          { title: 'About', value: 'about' },
          { title: 'Contact', value: 'contact' },
          { title: 'Team', value: 'team' },
          { title: 'Services', value: 'services' },
          { title: 'Landing Page', value: 'landing' },
          { title: 'Legal', value: 'legal' },
        ],
        layout: 'radio',
      },
      validation: (Rule) => [
        Rule.required(),
        Rule.custom(async (value, context) => {
          if (value !== 'home') return true
          const doc = context.document as { _id?: string; projectSlug?: string } | undefined
          if (!doc?.projectSlug) return true
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const client = (context as any).getClient({ apiVersion: '2026-05-21' })
          const docId = (doc._id ?? '').replace(/^drafts\./, '')
          const count = await client.fetch(
            `count(*[_type == "page" && pageType == "home" && projectSlug == $projectSlug && !(_id in [$id, $draftId])])`,
            { projectSlug: doc.projectSlug, id: docId, draftId: `drafts.${docId}` }
          )
          return count === 0 || 'A home page already exists for this project. Only one home page is allowed per project.'
        }),
      ],
    }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({
      name: 'slug',
      title: 'URL Slug',
      type: 'localizedSlug',
      description: 'The URL path per language, e.g. "about" (EN) / "chi-siamo" (IT)',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'redirectFrom',
      title: 'Redirect From',
      type: 'redirectFrom',
      description: 'Old slugs that redirect here with a 301. Fill these when renaming a page.',
    }),
    defineField({
      name: 'backgroundPattern',
      title: 'Section Background Pattern',
      type: 'string',
      options: {
        list: [
          { title: 'None (Manual section overrides only)', value: 'none' },
          { title: 'Alternate Surface 1 ↔ Surface 2', value: 'alternate1-2' },
          { title: 'Alternate Surface 1 ↔ 2 ↔ 3', value: 'alternate1-2-3' },
        ],
        layout: 'radio',
      },
      initialValue: 'none',
    }),
    defineField({
      name: 'sections',
      title: 'Sections',
      type: 'array',
      of: [
        defineArrayMember({ type: 'heroSection' }),
        defineArrayMember({ type: 'contentSection' }),
        defineArrayMember({ type: 'treatmentsSection' }),
        defineArrayMember({ type: 'teamSection' }),
        defineArrayMember({ type: 'textSection' }),
        defineArrayMember({ type: 'faqSection' }),
        defineArrayMember({ type: 'contactSection' }),
      ],
    }),
  ],
  preview: {
    select: { title: 'title.en', pageType: 'pageType', slugEn: 'slug.en.current', slugIt: 'slug.it.current' },
    prepare: ({ title, pageType, slugEn, slugIt }: { title?: string; pageType?: string; slugEn?: string; slugIt?: string }) => {
      const typeLabel = pageType
        ? pageType.charAt(0).toUpperCase() + pageType.slice(1)
        : 'Page'
      const slug = slugEn ?? slugIt
      const slugLabel = slug ? `/${slug}` : '— no slug'
      return {
        title: title ?? typeLabel,
        subtitle: `${typeLabel} · ${slugLabel}`,
      }
    },
  },
})

// ─── Home Page (legacy — kept for backward compat, replaced by Page) ──────────

const homePageType = defineType({
  name: 'homePage',
  title: 'Home Page',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({
      name: 'backgroundPattern',
      title: 'Section Background Pattern',
      type: 'string',
      options: {
        list: [
          { title: 'None (Manual section overrides only)', value: 'none' },
          { title: 'Alternate Surface 1 ↔ Surface 2', value: 'alternate1-2' },
          { title: 'Alternate Surface 1 ↔ 2 ↔ 3', value: 'alternate1-2-3' },
        ],
        layout: 'radio',
      },
      initialValue: 'none',
      description: 'Automatically assign surfaces to sections. Sections can override individually.',
    }),
    defineField({
      name: 'sections',
      title: 'Sections',
      type: 'array',
      of: [
        defineArrayMember({ type: 'heroSection' }),
        defineArrayMember({ type: 'contentSection' }),
        defineArrayMember({ type: 'treatmentsSection' }),
        defineArrayMember({ type: 'teamSection' }),
        defineArrayMember({ type: 'textSection' }),
        defineArrayMember({ type: 'faqSection' }),
        defineArrayMember({ type: 'contactSection' }),
      ],
    }),
  ],
  preview: {
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: `Home — ${slug ?? '?'}` }),
  },
})

// ─── Blog Post ────────────────────────────────────────────────────────────────

const postType = defineType({
  name: 'post',
  title: 'Blog Post',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'slug', title: 'Slug', type: 'localizedSlug' }),
    defineField({ name: 'redirectFrom', title: 'Redirect From', type: 'redirectFrom' }),
    defineField({ name: 'excerpt', title: 'Excerpt', type: 'localizedText' }),
    defineField({ name: 'body', title: 'Body', type: 'localizedPortableText' }),
    defineField({ name: 'publishedAt', title: 'Published At', type: 'datetime' }),
  ],
  preview: {
    select: { title: 'title.it', slug: 'projectSlug' },
    prepare: ({ title, slug }) => ({ title: title ?? 'Untitled', subtitle: slug }),
  },
})

// ─── Initial Value Templates ──────────────────────────────────────────────────
//
// PARAMETERIZED TEMPLATES FOR PROJECT-OWNED DOCUMENTS
//
// Each template declares:
// - parameters: array with projectSlug parameter definition
// - value: function that receives the projectSlug from the structure tool
//
// The structure tool passes projectSlug via .initialValueTemplateItem('typeId', {projectSlug: slug})
//

/**
 * Initial Value Templates for Project-Owned Content Types
 *
 * IMPORTANT: Template ids must NOT match their schemaType. This prevents Sanity's template
 * resolution from bypassing parameterized templates. Each project-owned type has a template
 * with id: `{schemaType}ProjectOwned` and schemaType: `{schemaType}`.
 *
 * Pattern: When a document is created within a project context, the structure tool calls:
 *   S.initialValueTemplateItem('{schemaType}ProjectOwned', { projectSlug: slug })
 *
 * This passes the slug as a parameter to the template's value() function, which sets
 * the projectSlug field automatically.
 */
export const initialValueTemplates = [
  {
    id: 'siteConfigProjectOwned',
    title: 'Site Config',
    schemaType: 'siteConfig',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
    }),
  },
  {
    id: 'pageProjectOwned',
    title: 'Page',
    schemaType: 'page',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
      sections: [],
    }),
  },
  {
    id: 'homePageProjectOwned',
    title: 'Home Page',
    schemaType: 'homePage',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
      sections: [],
    }),
  },
  {
    id: 'eventProjectOwned',
    title: 'Event',
    schemaType: 'event',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
      status: 'upcoming',
      startDate: new Date().toISOString(),
    }),
  },
  {
    id: 'postProjectOwned',
    title: 'Blog Post',
    schemaType: 'post',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
      publishedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'designSystemProjectOwned',
    title: 'Design System',
    schemaType: 'designSystem',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
      role: 'active',
    }),
  },
  {
    id: 'livePageProjectOwned',
    title: 'Live Page',
    schemaType: 'livePage',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
    }),
  },
  {
    id: 'eventsPageProjectOwned',
    title: 'Events Page',
    schemaType: 'eventsPage',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
    }),
  },
]

// ─── Export ───────────────────────────────────────────────────────────────────

export const schemaTypes = [
  localizedStringType,
  localizedTextType,
  localizedPortableTextType,
  localizedSlugType,
  redirectFromType,
  localizedImageType,
  navigationLinkType,
  socialLinkType,
  scheduleItemType,
  whatsappSubjectType,
  emailSubjectType,
  heroSectionType,
  contentSectionType,
  treatmentCardType,
  treatmentsSectionType,
  teamMemberType,
  teamSectionType,
  textSectionType,
  contactSectionType,
  faqItemType,
  faqSectionType,
  clientType,
  projectType,
  colorThemeType,
  fontDefinitionType,
  typescaleType,
  buttonStyleType,
  buttonStyleThemeType,
  cardStyleThemeType,
  cardVariantType,
  motionType,
  formInputThemeType,
  formInputType,
  glassStyleType,
  sectionSurfacesThemeType,
  sectionSurfacesType,
  backgroundAssetType,
  mediaAssetType,
  designSystemType,
  siteConfigType,
  pageType,
  homePageType,
  postType,
  eventType,
  livePageType,
  eventsPageType,
]
