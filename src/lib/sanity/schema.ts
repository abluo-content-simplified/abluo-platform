import { defineType, defineField, defineArrayMember } from 'sanity'
import { TenantLinker } from '@/lib/sanity/fields/TenantLinker'
import { ProjectLinker } from '@/lib/sanity/fields/ProjectLinker'
import { LocalizedStringInput, LocalizedTextInput, LocalizedPortableTextInput, LocalizedSlugInput, LocalizedRedirectFromInput } from '@/lib/sanity/fields/LocalizedInput'
import { PLATFORM_LOCALES, LOCALE_CODES } from '@/lib/i18n/locales'
import { scopedRef, projectSlugField } from '@/lib/sanity/fields/shared'
import { buildSchema } from '@/lib/modules/schema'

// scopedRef and projectSlugField are imported from @/lib/sanity/fields/shared.
// They live there so module schema files can import them without creating a
// circular dependency through this file. See shared.ts for full documentation.

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
  components: { input: LocalizedRedirectFromInput },
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

// ─── CTA Object ───────────────────────────────────────────────────────────────
// Reusable CTA object used across hero sections, cards, feature sections,
// landing pages, footer, and any future component that needs a call-to-action.
//
// Editors answer one question: "What should happen when the user clicks?"
// Styling (button variant, size) is always controlled by the consuming component.
const ctaType = defineType({
  name: 'cta',
  title: 'CTA',
  type: 'object',
  fields: [
    // ── Label ────────────────────────────────────────────────────────────────
    defineField({
      name: 'label',
      title: 'Label',
      type: 'localizedString',
      description: 'Button text shown to the visitor (e.g. "Get Early Access", "Download PDF")',
    }),

    // ── Internal Name ────────────────────────────────────────────────────────
    defineField({
      name: 'internalName',
      title: 'Internal Name',
      type: 'string',
      description: 'Internal identifier for analytics, reporting, A/B testing and audits. Be specific (e.g. "Hero Primary CTA", "Investor Deck Download").',
      validation: (Rule) => Rule.required().min(3).max(80),
    }),

    // ── Action Type ──────────────────────────────────────────────────────────
    defineField({
      name: 'actionType',
      title: 'Action',
      type: 'string',
      options: {
        list: [
          { title: '📄 Go to a page', value: 'page' },
          { title: '📋 Open a form', value: 'form' },
          { title: '⬇️ Download a file', value: 'fileDownload' },
          { title: '🔗 External URL', value: 'externalUrl' },
        ],
        layout: 'radio',
      },
      validation: (Rule) => Rule.required(),
    }),

    // ── Page reference (shown when actionType === 'page') ────────────────────
    // Filters to pages that already have a slug — prevents selecting blank drafts
    // which would resolve to "No Slug" in the CTA picker and fail at runtime.
    defineField({
      name: 'pageRef',
      title: 'Page',
      type: 'reference',
      to: [{ type: 'page' }],
      hidden: ({ parent }: { parent?: { actionType?: string } }) => parent?.actionType !== 'page',
      description: 'Pick any page from this project. Never type a URL.',
      options: {
        filter: ({ document }: { document: Record<string, unknown> }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const projectSlug = (document as any)?.projectSlug as string | undefined
          if (!projectSlug) return { filter: '_id == "@@no-project-selected@@"' }
          return {
            filter: 'projectSlug == $projectSlug && defined(slug)',
            params: { projectSlug },
          }
        },
        disableNew: true,
      },
    }),

    // ── Form reference (shown when actionType === 'form') ────────────────────
    // Stores the reference now; modal trigger wired in a future session.
    defineField({
      name: 'formRef',
      title: 'Form',
      type: 'reference',
      to: [{ type: 'form' }],
      hidden: ({ parent }: { parent?: { actionType?: string } }) => parent?.actionType !== 'form',
      description: 'Select the form to open when clicked.',
      options: { filter: scopedRef, disableNew: true },
    }),

    // ── File download (shown when actionType === 'fileDownload') ─────────────
    defineField({
      name: 'file',
      title: 'File',
      type: 'file',
      hidden: ({ parent }: { parent?: { actionType?: string } }) => parent?.actionType !== 'fileDownload',
      description: 'Upload a PDF, deck, or any downloadable asset.',
    }),

    // ── External URL (shown when actionType === 'externalUrl') ───────────────
    defineField({
      name: 'externalUrl',
      title: 'URL',
      type: 'url',
      hidden: ({ parent }: { parent?: { actionType?: string } }) => parent?.actionType !== 'externalUrl',
      validation: (Rule) =>
        Rule.custom((url, context) => {
          const parent = context.parent as { actionType?: string }
          if (parent?.actionType === 'externalUrl' && !url) return 'URL is required'
          return true
        }),
    }),
    defineField({
      name: 'openInNewTab',
      title: 'Open in new tab',
      type: 'boolean',
      initialValue: true,
      hidden: ({ parent }: { parent?: { actionType?: string } }) => parent?.actionType !== 'externalUrl',
    }),
  ],
  preview: {
    select: {
      label: 'label.en',
      internalName: 'internalName',
      actionType: 'actionType',
    },
    prepare: ({ label, internalName, actionType }: { label?: string; internalName?: string; actionType?: string }) => {
      const icon: Record<string, string> = {
        page: '📄',
        form: '📋',
        fileDownload: '⬇️',
        externalUrl: '🔗',
      }
      return {
        title: label ?? internalName ?? '—',
        subtitle: `${icon[actionType ?? ''] ?? '?'} ${internalName ?? ''}`,
      }
    },
  },
})

const navigationLinkType = defineType({
  name: 'navigationLink',
  title: 'Navigation Link',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'localizedString', validation: (Rule) => Rule.required() }),
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
      // Default to internal — most nav links point to pages within the site.
      // Previously 'external' which caused every new link to default to '#'
      // when the URL field was left blank.
      initialValue: 'internal',
    }),
    // Primary way to link to a page — reference to any page document in this project.
    // Studio shows only pages that belong to the same projectSlug as the siteConfig.
    defineField({
      name: 'pageRef',
      title: 'Page',
      type: 'reference',
      to: [{ type: 'page' }],
      hidden: ({ parent }: { parent?: { linkType?: string } }) => parent?.linkType !== 'internal',
      description: 'Pick any page from this project',
      options: { filter: scopedRef, disableNew: true },
    }),
    // Special built-in sections that are coded routes with no corresponding
    // Sanity page document (Homepage, Live, Events, Blog).
    // These will never appear in the Page picker above because they are not
    // page documents — use this dropdown for them instead.
    // Hidden when pageRef is already set.
    defineField({
      name: 'internalPage',
      title: 'Special section',
      type: 'string',
      options: {
        list: [
          { title: 'Homepage', value: 'homepage' },
          { title: 'Live', value: 'live' },
          { title: 'Events', value: 'events' },
          { title: 'News & Announcements (Blog)', value: 'blog' },
        ],
      },
      hidden: ({ parent }: { parent?: { linkType?: string; pageRef?: unknown } }) =>
        parent?.linkType !== 'internal' || !!parent?.pageRef,
      description: 'Use for special built-in sections (Live, Events, Blog) that are not in the page picker above.',
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
    select: { title: 'label.en', linkType: 'linkType', internalPage: 'internalPage', externalUrl: 'externalUrl', pageTitle: 'pageRef.title.en', pageSlug: 'pageRef.slug.en.current' },
    prepare: ({ title, linkType, internalPage, externalUrl, pageTitle, pageSlug }) => ({
      title: title ?? '—',
      subtitle: linkType === 'internal'
        ? (pageTitle ? `📄 ${pageTitle} (/${pageSlug})` : `📄 ${internalPage}`)
        : `🔗 ${externalUrl}`,
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
// projectSlugField imported from @/lib/sanity/fields/shared

// ─── Section object types ─────────────────────────────────────────────────────

const heroSectionType = defineType({
  name: 'heroSection',
  title: 'Hero Section',
  type: 'object',
  groups: [
    { name: 'content', title: 'Content' },
    { name: 'media', title: 'Media' },
    { name: 'layout', title: 'Layout' },
    { name: 'style', title: 'Style' },
  ],
  fields: [
    // ── Content ───────────────────────────────────────────────────────────────
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      group: 'content',
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
      description: 'Used when no media background is set.',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString', group: 'content' }),
    defineField({ name: 'headline', title: 'Headline', type: 'localizedText', group: 'content' }),
    defineField({ name: 'subheadline', title: 'Subheadline', type: 'localizedText', group: 'content' }),
    defineField({ name: 'ctaLabel', title: 'CTA Button Label', type: 'localizedString', group: 'content' }),
    defineField({ name: 'ctaHref', title: 'CTA Button Link', type: 'string', group: 'content' }),

    // ── Media ─────────────────────────────────────────────────────────────────
    defineField({
      name: 'mediaType',
      title: 'Media Type',
      type: 'string',
      group: 'media',
      options: {
        list: [
          { title: '🖼 Image', value: 'image' },
          { title: '🎬 Video', value: 'video' },
        ],
        layout: 'radio',
      },
      description: 'Choose image or video as the hero background. Leave unset for a solid surface background.',
    }),
    defineField({
      name: 'heroImage',
      title: 'Hero Image',
      type: 'image',
      group: 'media',
      options: { hotspot: true },
      hidden: ({ parent }: { parent?: { mediaType?: string } }) => parent?.mediaType === 'video',
      description: 'Full-bleed background image.',
    }),
    defineField({
      name: 'heroVideo',
      title: 'Hero Video (Cloudflare Stream ID)',
      type: 'string',
      group: 'media',
      hidden: ({ parent }: { parent?: { mediaType?: string } }) => parent?.mediaType !== 'video',
      description: 'Cloudflare Stream video ID (e.g. "abc123def456"). Autoplays muted and looped with no controls.',
    }),
    defineField({
      name: 'posterImage',
      title: 'Poster Image',
      type: 'image',
      group: 'media',
      options: { hotspot: true },
      hidden: ({ parent }: { parent?: { mediaType?: string } }) => parent?.mediaType !== 'video',
      description: 'Fallback image shown while the video loads.',
    }),

    // ── Layout ────────────────────────────────────────────────────────────────
    defineField({
      name: 'heroHeight',
      title: 'Height',
      type: 'string',
      group: 'layout',
      options: {
        list: [
          { title: 'Small — 50vh', value: 'small' },
          { title: 'Medium — 70vh', value: 'medium' },
          { title: 'Large — 90vh', value: 'large' },
          { title: 'Full Screen — 100vh', value: 'fullscreen' },
        ],
        layout: 'radio',
      },
      initialValue: 'large',
    }),
    defineField({
      name: 'contentWidth',
      title: 'Content Width',
      type: 'string',
      group: 'layout',
      options: {
        list: [
          { title: 'Standard', value: 'standard' },
          { title: 'Wide', value: 'wide' },
          { title: 'Full Width', value: 'full' },
        ],
        layout: 'radio',
      },
      initialValue: 'standard',
    }),
    defineField({
      name: 'contentAlignment',
      title: 'Content Alignment',
      type: 'string',
      group: 'layout',
      options: {
        list: [
          { title: 'Left', value: 'left' },
          { title: 'Center', value: 'center' },
          { title: 'Right', value: 'right' },
        ],
        layout: 'radio',
      },
      initialValue: 'left',
    }),
    defineField({
      name: 'verticalAlignment',
      title: 'Vertical Alignment',
      type: 'string',
      group: 'layout',
      options: {
        list: [
          { title: 'Top', value: 'top' },
          { title: 'Center', value: 'center' },
          { title: 'Bottom', value: 'bottom' },
        ],
        layout: 'radio',
      },
      initialValue: 'center',
    }),

    // ── Style ─────────────────────────────────────────────────────────────────
    defineField({
      name: 'overlayOpacity',
      title: 'Overlay Opacity',
      type: 'number',
      group: 'style',
      validation: (Rule) => Rule.min(0).max(100),
      initialValue: 40,
      description: 'Dark overlay on top of the media (0–100). Improves text readability.',
    }),
    defineField({
      name: 'blur',
      title: 'Background Blur',
      type: 'number',
      group: 'style',
      validation: (Rule) => Rule.min(0).max(20),
      initialValue: 0,
      description: 'Blur the media background (0–20px).',
    }),
    defineField({
      name: 'brightness',
      title: 'Background Brightness',
      type: 'number',
      group: 'style',
      validation: (Rule) => Rule.min(50).max(150),
      initialValue: 100,
      description: 'Adjust media brightness (50–150%). Lower darkens, higher brightens.',
    }),
  ],
  preview: {
    select: {
      headlineIt: 'headline.it',
      headlineEn: 'headline.en',
      mediaType: 'mediaType',
      heroHeight: 'heroHeight',
    },
    prepare: ({ headlineIt, headlineEn, mediaType, heroHeight }: {
      headlineIt?: string; headlineEn?: string; mediaType?: string; heroHeight?: string
    }) => ({
      title: headlineIt ?? headlineEn ?? 'Hero',
      subtitle: ['Hero Section', mediaType ? `· ${mediaType}` : '', heroHeight ? `· ${heroHeight}` : ''].filter(Boolean).join(' '),
    }),
  },
})

/**
 * heroLiveCaptureSection — two-column hero with live event circle + animated phone mockup.
 *
 * Visual concept: Layer 1 = large circular event image (football, church, concert…)
 *                 Layer 2 = hand holding phone with Livener streaming interface
 *
 * Reusable: swap eyebrow/title/subtitle/images for any industry vertical.
 */
const heroLiveCaptureSectionType = defineType({
  name: 'heroLiveCaptureSection',
  title: 'Hero — Live Capture',
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
    defineField({
      name: 'eyebrow',
      title: 'Eyebrow Label',
      type: 'localizedString',
      description: 'Short overline above the headline — e.g. "Livener for Investors"',
    }),
    defineField({
      name: 'title',
      title: 'Headline',
      type: 'localizedText',
      description: 'Main headline. Use newlines to control line breaks.',
    }),
    defineField({
      name: 'subtitle',
      title: 'Subtitle',
      type: 'localizedText',
      description: 'Supporting paragraph below the headline.',
    }),
    defineField({
      name: 'ctas',
      title: 'CTAs',
      type: 'array',
      of: [defineArrayMember({ type: 'cta' })],
      description: 'Add one or more calls-to-action. First is rendered as primary, second as secondary.',
    }),
    defineField({
      name: 'backgroundImage',
      title: 'Event Background Image',
      type: 'image',
      options: { hotspot: true },
      description: 'Large circular image representing the real-world event being captured (football match, church service, concert…)',
    }),
    defineField({
      name: 'phoneScreenImage',
      title: 'Phone Screen Image',
      type: 'image',
      options: { hotspot: true },
      description: 'Image shown inside the phone as the live video feed. Falls back to the Event Background Image if not set.',
    }),
    defineField({
      name: 'circleSize',
      title: 'Circle Size',
      type: 'string',
      initialValue: 'md',
      options: {
        list: [
          { title: 'Small (320 px)', value: 'sm' },
          { title: 'Medium (400 px)', value: 'md' },
          { title: 'Large (480 px)', value: 'lg' },
        ],
        layout: 'radio',
      },
    }),
    defineField({
      name: 'animationIntensity',
      title: 'Animation Intensity',
      type: 'string',
      initialValue: 'moderate',
      options: {
        list: [
          { title: 'Subtle', value: 'subtle' },
          { title: 'Moderate', value: 'moderate' },
          { title: 'Expressive', value: 'expressive' },
        ],
        layout: 'radio',
      },
    }),
  ],
  preview: {
    select: { title: 'title.it', titleEn: 'title.en' },
    prepare: ({ title, titleEn }) => ({
      title: title ?? titleEn ?? 'Live Capture Hero',
      subtitle: 'Hero — Live Capture',
    }),
  },
})

/**
 * heroLensSection — story-driven two-column hero for the "filming a live event" concept.
 *
 * Visual concept:
 *   Layer 1 — large circular background image (the event being filmed)
 *   Layer 2 — foreground PNG rendered as-is (a hand holding a phone with content inside)
 *
 * No phone is generated. The foreground image must be supplied by the editor.
 * Animation: subtle mouse parallax, slow drift, gentle float, very slight scroll tilt.
 */
const heroLensSectionType = defineType({
  name: 'heroLensSection',
  title: 'Hero — Lens',
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
    defineField({
      name: 'eyebrow',
      title: 'Eyebrow Label',
      type: 'localizedString',
      description: 'Short overline above the headline — e.g. "Capture the moment"',
    }),
    defineField({
      name: 'title',
      title: 'Headline',
      type: 'localizedText',
      description: 'Main headline. Use newlines to control line breaks.',
    }),
    defineField({
      name: 'subtitle',
      title: 'Subtitle',
      type: 'localizedText',
      description: 'Supporting paragraph below the headline.',
    }),
    defineField({
      name: 'ctas',
      title: 'CTAs',
      type: 'array',
      of: [defineArrayMember({ type: 'cta' })],
      description: 'Add one or more calls-to-action. First is rendered as primary, second as secondary.',
    }),
    defineField({
      name: 'backgroundImage',
      title: 'Background Image (Circle)',
      type: 'image',
      options: { hotspot: true },
      description:
        'The event image displayed inside the large background circle — e.g. a football pitch, concert stage, church interior.',
    }),
    defineField({
      name: 'foregroundImage',
      title: 'Foreground Image (Hand + Phone)',
      type: 'image',
      options: { hotspot: true },
      description:
        'Complete PNG of a hand holding a smartphone. The phone screen content must already be visible inside the image — it will be rendered exactly as uploaded, without any masking or modification.',
    }),
  ],
  preview: {
    select: { title: 'title.it', titleEn: 'title.en' },
    prepare: ({ title, titleEn }) => ({
      title: title ?? titleEn ?? 'Lens Hero',
      subtitle: 'Hero — Lens',
    }),
  },
})

const contentSectionType = defineType({
  name: 'contentSection',
  title: 'Media Content Section',
  type: 'object',
  groups: [
    { name: 'content', title: 'Content' },
    { name: 'media', title: 'Media' },
    { name: 'layout', title: 'Layout' },
    { name: 'ctas', title: 'CTAs' },
  ],
  fields: [
    // ── Surface ───────────────────────────────────────────────────────────────
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      group: 'content',
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

    // ── Content ───────────────────────────────────────────────────────────────
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString', group: 'content' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString', group: 'content' }),
    defineField({ name: 'body', title: 'Body', type: 'localizedPortableText', group: 'content' }),

    // ── CTAs ──────────────────────────────────────────────────────────────────
    defineField({
      name: 'primaryCta',
      title: 'Primary CTA',
      type: 'cta',
      group: 'ctas',
      description: 'Main call-to-action button — uses primary button style from the Design System.',
    }),
    defineField({
      name: 'secondaryCta',
      title: 'Secondary CTA',
      type: 'cta',
      group: 'ctas',
      description: 'Optional secondary action — rendered as a ghost or text button.',
    }),

    // ── Media ─────────────────────────────────────────────────────────────────
    defineField({
      name: 'image',
      title: 'Image',
      type: 'localizedImage',
      group: 'media',
      description: 'Optional image. Ignored when Media Position is set to None.',
    }),
    defineField({
      name: 'mediaPosition',
      title: 'Media Position',
      type: 'string',
      group: 'media',
      options: {
        list: [
          { title: '◻ None (text only)', value: 'none' },
          { title: '◀ Left', value: 'left' },
          { title: '▶ Right', value: 'right' },
          { title: '▲ Top', value: 'top' },
          { title: '▼ Bottom', value: 'bottom' },
        ],
        layout: 'radio',
      },
      initialValue: 'right',
    }),
    defineField({
      name: 'mediaStyle',
      title: 'Media Style',
      type: 'string',
      group: 'media',
      description: 'Presentation style — defined by the Design System. Each DS can override what each style looks like.',
      options: {
        list: [
          { title: 'Default', value: 'default' },
          { title: 'Rounded', value: 'rounded' },
          { title: 'Square (1:1)', value: 'square' },
          { title: 'Landscape (16:9)', value: 'landscape' },
          { title: 'Portrait (3:4)', value: 'portrait' },
          { title: 'Circle', value: 'circle' },
          { title: 'Full Height', value: 'fullHeight' },
        ],
      },
      initialValue: 'default',
      hidden: ({ parent }: { parent?: { mediaPosition?: string } }) => parent?.mediaPosition === 'none',
    }),

    // ── Layout ────────────────────────────────────────────────────────────────
    defineField({
      name: 'contentRatio',
      title: 'Content Ratio',
      type: 'string',
      group: 'layout',
      description: 'Width split between text and media columns. Only applies when media is Left or Right.',
      options: {
        list: [
          { title: '40 / 60 — Emphasis on media', value: '40/60' },
          { title: '50 / 50 — Equal split', value: '50/50' },
          { title: '60 / 40 — Emphasis on text', value: '60/40' },
        ],
        layout: 'radio',
      },
      initialValue: '50/50',
      hidden: ({ parent }: { parent?: { mediaPosition?: string } }) =>
        parent?.mediaPosition === 'none' ||
        parent?.mediaPosition === 'top' ||
        parent?.mediaPosition === 'bottom',
    }),
    defineField({
      name: 'verticalAlignment',
      title: 'Vertical Alignment',
      type: 'string',
      group: 'layout',
      description: 'How to align columns vertically when media is Left or Right.',
      options: {
        list: [
          { title: 'Top', value: 'top' },
          { title: 'Center', value: 'center' },
          { title: 'Bottom', value: 'bottom' },
        ],
        layout: 'radio',
      },
      initialValue: 'center',
      hidden: ({ parent }: { parent?: { mediaPosition?: string } }) =>
        parent?.mediaPosition === 'none' ||
        parent?.mediaPosition === 'top' ||
        parent?.mediaPosition === 'bottom',
    }),
    defineField({
      name: 'reverseOnMobile',
      title: 'Reverse Order on Mobile',
      type: 'boolean',
      group: 'layout',
      description: 'Show text before media on small screens, regardless of desktop position.',
      initialValue: false,
    }),
  ],
  preview: {
    select: { title: 'title.en', mediaPosition: 'mediaPosition' },
    prepare: ({ title, mediaPosition }: { title?: string; mediaPosition?: string }) => ({
      title: title ?? 'Media Content Section',
      subtitle: `Media Content Section${mediaPosition ? ` — media ${mediaPosition}` : ''}`,
    }),
  },
})

const statementSectionType = defineType({
  name: 'statementSection',
  title: 'Statement Section',
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
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'localizedString' }),
    defineField({ name: 'headline', title: 'Headline', type: 'localizedString' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
    defineField({
      name: 'alignment',
      title: 'Text Alignment',
      type: 'string',
      options: {
        list: [
          { title: 'Left', value: 'left' },
          { title: 'Center', value: 'center' },
        ],
        layout: 'radio',
      },
      initialValue: 'left',
    }),
    defineField({
      name: 'image',
      title: 'Image (optional)',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'imagePosition',
      title: 'Image Position',
      type: 'string',
      options: {
        list: [
          { title: 'Right', value: 'right' },
          { title: 'Left', value: 'left' },
        ],
        layout: 'radio',
      },
      initialValue: 'right',
    }),
  ],
  preview: {
    select: { headline_it: 'headline.it', headline_en: 'headline.en' },
    prepare: ({ headline_it, headline_en }: { headline_it?: string; headline_en?: string }) => ({
      title: headline_it ?? headline_en ?? 'Statement',
      subtitle: 'Statement Section',
    }),
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
    defineField({
      name: 'photo',
      title: 'Photo',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({ name: 'name', title: 'Name', type: 'string' }),
    defineField({ name: 'role', title: 'Role / Job Title', type: 'localizedString' }),
    defineField({ name: 'bio', title: 'Short Description', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'role.it', media: 'photo' },
    prepare: ({ title, subtitle, media }) => ({ title: title ?? 'Team Member', subtitle, media }),
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
    defineField({ name: 'subtitle', title: 'Subtitle / Eyebrow', type: 'localizedString' }),
    defineField({ name: 'intro', title: 'Introduction', type: 'localizedPortableText' }),
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
    // ── Map presentation ──────────────────────────────────────────────────────
    defineField({
      name: 'showMap',
      title: 'Show Map',
      type: 'boolean',
      initialValue: true,
      description: 'Display an interactive Google Map. The map is generated automatically from the business address in Site Configuration — no embed code needed.',
    }),
    defineField({
      name: 'mapHeight',
      title: 'Map Height (px)',
      type: 'number',
      initialValue: 400,
      description: 'Height of the map in pixels. Default: 400.',
      validation: (Rule) => Rule.min(200).max(800),
    }),
    defineField({
      name: 'mapTheme',
      title: 'Map Theme',
      type: 'string',
      initialValue: 'auto',
      options: {
        list: [
          { title: 'Automatic', value: 'auto' },
          { title: 'Light', value: 'light' },
          { title: 'Dark', value: 'dark' },
        ],
        layout: 'radio',
        direction: 'horizontal',
      },
      description: 'Dark mode is reserved for a future Maps JavaScript API integration. In v1, all themes render the standard interactive Google Map.',
    }),
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

// ─── Metrics Section ──────────────────────────────────────────────────────────

const metricItemType = defineType({
  name: 'metricItem',
  title: 'Metric',
  type: 'object',
  fields: [
    defineField({
      name: 'value',
      title: 'Value',
      type: 'localizedString',
      description: 'The headline figure, e.g. "£10bn+" (EN) / "€10bn+" (IT), or a phrase like "Fundraising Round Open"',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'label',
      title: 'Label',
      type: 'localizedString',
      description: 'Short supporting label, e.g. "Estimated Addressable Market"',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Description (optional)',
      type: 'localizedText',
    }),
    defineField({
      name: 'animateNumber',
      title: 'Animate Number',
      type: 'boolean',
      description: 'Reserved for future count-up animation. Has no effect yet.',
      initialValue: false,
    }),
  ],
  preview: {
    select: { value_en: 'value.en', value_it: 'value.it', label_en: 'label.en', label_it: 'label.it' },
    prepare: ({ value_en, value_it, label_en, label_it }: { value_en?: string; value_it?: string; label_en?: string; label_it?: string }) => ({
      title: value_en ?? value_it ?? 'Metric',
      subtitle: label_en ?? label_it ?? '',
    }),
  },
})

const BACKGROUND_SURFACE_OPTIONS = [
  { title: '⬜ Use Page Pattern', value: 'usePagePattern' },
  { title: '⬜ Surface 1', value: 'surface1' },
  { title: '⬜ Surface 2', value: 'surface2' },
  { title: '🟦 Surface 3', value: 'surface3' },
  { title: '🟢 Brand Surface', value: 'brandSurface' },
  { title: '◻ Transparent', value: 'transparent' },
  { title: '🔲 Glass', value: 'glass' },
]

const metricsSectionType = defineType({
  name: 'metricsSection',
  title: 'Metrics Section',
  type: 'object',
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: { list: BACKGROUND_SURFACE_OPTIONS },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'localizedString' }),
    defineField({ name: 'headline', title: 'Headline', type: 'localizedString' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
    defineField({
      name: 'metrics',
      title: 'Metrics',
      type: 'array',
      of: [defineArrayMember({ type: 'metricItem' })],
      validation: (Rule) => Rule.min(1).max(8),
    }),
  ],
  preview: {
    select: { headline_en: 'headline.en', headline_it: 'headline.it' },
    prepare: ({ headline_en, headline_it }: { headline_en?: string; headline_it?: string }) => ({
      title: headline_en ?? headline_it ?? 'Metrics',
      subtitle: 'Metrics Section',
    }),
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

// blogListingSection moved to src/lib/modules/blog/schema.ts (ADR-011 Phase D1)

// ─── Gallery Module ────────────────────────────────────────────────────────────

const galleryItemType = defineType({
  name: 'galleryItem',
  title: 'Gallery Item',
  type: 'object',
  fields: [
    defineField({
      name: 'mediaAsset',
      title: 'Media Asset',
      type: 'reference',
      to: [{ type: 'mediaAsset' }],
      validation: (Rule) => Rule.required(),
      description: 'Select a Media Asset from the Media Library.',
    }),
    // ── Title override ──────────────────────────────────────────────────────
    defineField({
      name: 'titleOverrideEnabled',
      title: 'Override Display Title',
      type: 'boolean',
      initialValue: false,
      description: 'Enable to use a custom title for this item instead of the Media Library title.',
    }),
    defineField({
      name: 'titleOverride',
      title: 'Custom Display Title',
      type: 'localizedString',
      description: 'Replaces the Media Library title in this gallery only.',
      hidden: ({ parent }) => !parent?.titleOverrideEnabled,
    }),
    // ── Caption override ────────────────────────────────────────────────────
    defineField({
      name: 'captionOverrideEnabled',
      title: 'Override Caption',
      type: 'boolean',
      initialValue: false,
      description: 'Enable to use a custom caption for this item instead of the Media Library caption.',
    }),
    defineField({
      name: 'captionOverride',
      title: 'Custom Caption',
      type: 'localizedString',
      description: 'Replaces the Media Library caption in this gallery only.',
      hidden: ({ parent }) => !parent?.captionOverrideEnabled,
    }),
  ],
  preview: {
    select: {
      assetName: 'mediaAsset.name',
      assetAltEn: 'mediaAsset.altText.en',
      assetTitleEn: 'mediaAsset.title.en',
      media: 'mediaAsset.image',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare: ({ assetName, assetAltEn, assetTitleEn, media }: { assetName?: string; assetAltEn?: string; assetTitleEn?: string; media?: any }) => ({
      title: assetName ?? assetTitleEn ?? assetAltEn ?? 'Media Asset',
      media,
    }),
  },
})

const galleryType = defineType({
  name: 'gallery',
  title: 'Gallery',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({
      name: 'internalName',
      title: 'Internal Name',
      type: 'string',
      description: 'Used in Studio to identify this gallery (e.g. "Hygiene", "Our Team").',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'Optional identifier for future API use.',
      options: { source: 'internalName', maxLength: 96 },
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'localizedString',
      description: 'Optional short description of this gallery.',
    }),
    defineField({
      name: 'items',
      title: 'Gallery Items',
      type: 'array',
      description: 'Ordered list of Media Assets in this gallery. Drag to reorder.',
      of: [defineArrayMember({ type: 'galleryItem' })],
      validation: (Rule) => Rule.min(1),
    }),
  ],
  preview: {
    select: {
      title: 'internalName',
      projectSlug: 'projectSlug',
      count0: 'items.0',
      count1: 'items.1',
    },
    prepare: ({ title, projectSlug, count0, count1 }: { title?: string; projectSlug?: string; count0?: unknown; count1?: unknown }) => ({
      title: title ?? 'Unnamed Gallery',
      subtitle: `${projectSlug ?? '?'} · ${[count0, count1].filter(Boolean).length}+ items`,
    }),
  },
})

const photoGallerySectionType = defineType({
  name: 'photoGallerySection',
  title: 'Photo Gallery Section',
  type: 'object',
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: { list: BACKGROUND_SURFACE_OPTIONS },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'localizedString' }),
    defineField({ name: 'headline', title: 'Headline', type: 'localizedString' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
    defineField({
      name: 'gallery',
      title: 'Gallery',
      type: 'reference',
      to: [{ type: 'gallery' }],
      validation: (Rule) => Rule.required(),
      description: 'Select the gallery to display. Manage galleries in the Gallery section.',
    }),
    defineField({
      name: 'columns',
      title: 'Columns',
      type: 'number',
      options: {
        list: [
          { title: '2 Columns', value: 2 },
          { title: '3 Columns', value: 3 },
          { title: '4 Columns', value: 4 },
        ],
        layout: 'radio',
      },
      initialValue: 3,
    }),
    defineField({
      name: 'imageRatio',
      title: 'Image Ratio',
      type: 'string',
      options: {
        list: [
          { title: 'Square (1:1)', value: 'square' },
          { title: 'Landscape (4:3)', value: 'landscape' },
          { title: 'Portrait (3:4)', value: 'portrait' },
          { title: 'Auto (original)', value: 'auto' },
        ],
        layout: 'radio',
      },
      initialValue: 'square',
    }),
    defineField({
      name: 'spacing',
      title: 'Grid Spacing',
      type: 'string',
      options: {
        list: [
          { title: 'Tight (4px)', value: 'tight' },
          { title: 'Normal (12px)', value: 'normal' },
          { title: 'Loose (24px)', value: 'loose' },
        ],
        layout: 'radio',
      },
      initialValue: 'normal',
    }),
    defineField({
      name: 'showCaptions',
      title: 'Show Captions',
      type: 'boolean',
      initialValue: false,
      description: 'Display image captions beneath each item.',
    }),
  ],
  preview: {
    select: {
      headline_en: 'headline.en',
      headline_it: 'headline.it',
      galleryName: 'gallery.internalName',
    },
    prepare: ({ headline_en, headline_it, galleryName }: { headline_en?: string; headline_it?: string; galleryName?: string }) => ({
      title: headline_en ?? headline_it ?? galleryName ?? 'Photo Gallery',
      subtitle: `Photo Gallery Section${galleryName ? ` · ${galleryName}` : ''}`,
    }),
  },
})

// ─── Form System ──────────────────────────────────────────────────────────────

const FORM_FIELD_TYPES = [
  { title: 'Text', value: 'text' },
  { title: 'Email', value: 'email' },
  { title: 'Phone', value: 'phone' },
  { title: 'Textarea', value: 'textarea' },
  { title: 'Select', value: 'select' },
  { title: 'Radio Group', value: 'radio-group' },
  { title: 'Checkbox', value: 'checkbox' },
  { title: 'Checkbox Group', value: 'checkbox-group' },
]

const formOptionItemType = defineType({
  name: 'formOptionItem',
  title: 'Option',
  type: 'object',
  fields: [
    defineField({ name: 'value', title: 'Value', type: 'string', description: 'Stored in the database — no spaces, e.g. "dental_care"', validation: (Rule) => Rule.required() }),
    defineField({ name: 'label', title: 'Label', type: 'localizedString', description: 'Displayed to the user' }),
  ],
  preview: {
    select: { title: 'value', subtitle: 'label.en' },
    prepare: ({ title, subtitle }: { title?: string; subtitle?: string }) => ({
      title: subtitle ?? title ?? 'Option',
      subtitle: title ?? '',
    }),
  },
})

const formFieldItemType = defineType({
  name: 'formFieldItem',
  title: 'Form Field',
  type: 'object',
  fields: [
    defineField({
      name: 'id',
      title: 'Field ID',
      type: 'string',
      description: 'Unique key for this field — no spaces, e.g. "patient_name". Used as the key in the submission payload.',
      validation: (Rule) => Rule.required().regex(/^[a-z][a-z0-9_]*$/, { name: 'snake_case', invert: false }).error('Must be snake_case — lowercase letters, digits, and underscores only'),
    }),
    defineField({
      name: 'type',
      title: 'Field Type',
      type: 'string',
      options: { list: FORM_FIELD_TYPES, layout: 'radio' },
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'label', title: 'Label', type: 'localizedString' }),
    defineField({ name: 'placeholder', title: 'Placeholder', type: 'localizedString' }),
    defineField({ name: 'helpText', title: 'Help Text', type: 'localizedString' }),
    defineField({ name: 'checkboxLabel', title: 'Checkbox Label', type: 'localizedString', description: 'Text shown next to the checkbox (for checkbox type only)', hidden: ({ parent }: { parent?: { type?: string } }) => parent?.type !== 'checkbox' }),
    defineField({ name: 'required', title: 'Required', type: 'boolean', initialValue: false }),
    defineField({
      name: 'width',
      title: 'Width',
      type: 'string',
      options: { list: [{ title: 'Full width', value: '100%' }, { title: 'Half width', value: '50%' }], layout: 'radio' },
      initialValue: '100%',
    }),
    defineField({
      name: 'rows',
      title: 'Rows',
      type: 'number',
      description: 'Number of rows for textarea (default: 4)',
      initialValue: 4,
      hidden: ({ parent }: { parent?: { type?: string } }) => parent?.type !== 'textarea',
    }),
    defineField({
      name: 'options',
      title: 'Options',
      type: 'array',
      of: [defineArrayMember({ type: 'formOptionItem' })],
      description: 'Options for select, radio-group, or checkbox-group fields',
      hidden: ({ parent }: { parent?: { type?: string } }) =>
        !['select', 'radio-group', 'checkbox-group'].includes(parent?.type ?? ''),
    }),
  ],
  preview: {
    select: { id: 'id', type: 'type', labelEn: 'label.en' },
    prepare: ({ id, type, labelEn }: { id?: string; type?: string; labelEn?: string }) => ({
      title: labelEn ?? id ?? 'Field',
      subtitle: `${type ?? '?'} · ${id ?? ''}`,
    }),
  },
})

const formType = defineType({
  name: 'form',
  title: 'Form',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({ name: 'title', title: 'Internal Title', type: 'localizedString', description: 'Used in Studio only — not shown on the website', validation: (Rule) => Rule.required() }),
    defineField({ name: 'description', title: 'Description', type: 'localizedString', description: 'Optional text shown above the form fields' }),
    defineField({ name: 'submitLabel', title: 'Submit Button Label', type: 'localizedString', description: 'Defaults to "Submit" if empty' }),
    defineField({ name: 'successMessage', title: 'Success Message', type: 'localizedString', description: 'Shown after successful submission' }),
    defineField({
      name: 'inquiryType',
      title: 'Inquiry Type',
      type: 'string',
      description: 'Tag stored in the database to categorise submissions — e.g. "contact", "appointment", "quote"',
      initialValue: 'contact',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'recipientEmail',
      title: 'Recipient Email (future)',
      type: 'string',
      description: '⏳ Not yet implemented. When email notifications are enabled, new submissions will be sent here. Leave empty for now.',
    }),
    defineField({
      name: 'fields',
      title: 'Fields',
      type: 'array',
      of: [defineArrayMember({ type: 'formFieldItem' })],
    }),
  ],
  preview: {
    select: { titleEn: 'title.en', projectSlug: 'projectSlug', inquiryType: 'inquiryType' },
    prepare: ({ titleEn, projectSlug, inquiryType }: { titleEn?: string; projectSlug?: string; inquiryType?: string }) => ({
      title: titleEn ?? 'Form',
      subtitle: `${projectSlug ?? '—'} · ${inquiryType ?? '—'}`,
    }),
  },
})

const formSectionType = defineType({
  name: 'formSection',
  title: 'Form Section',
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
    defineField({
      name: 'form',
      title: 'Form',
      type: 'reference',
      to: [{ type: 'form' }],
      description: 'The form to render in this section',
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: { titleEn: 'form.title.en', projectSlug: 'form.projectSlug' },
    prepare: ({ titleEn, projectSlug }: { titleEn?: string; projectSlug?: string }) => ({
      title: titleEn ?? 'Form Section',
      subtitle: projectSlug ?? '—',
    }),
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
    // ── Module installations (ADR-011 Phase B1) ─────────────────────────────
    // First-class installation records — replaces enabledModules[] string array.
    // Each entry is one module installed on this project, carrying version,
    // enabled state, install timestamp, config, and provenance.
    //
    // Read by: sanity.config.ts structure builder (via enabledModuleIds GROQ
    //          projection) and ProjectLinker display.
    // Written by: migration 002-module-installations.ts; future Phase C2 UI.
    //
    // Hidden from the Studio form — managed programmatically.
    defineField({
      name: 'moduleInstallations',
      title: 'Module Installations',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({ name: 'moduleId', title: 'Module ID', type: 'string' }),
            defineField({ name: 'version', title: 'Version', type: 'string' }),
            defineField({ name: 'enabled', title: 'Enabled', type: 'boolean', initialValue: true }),
            defineField({ name: 'installedAt', title: 'Installed At', type: 'string' }),
            defineField({ name: 'provenance', title: 'Provenance', type: 'string' }),
            // config: Record<string, unknown> — not declared in schema until modules
            // define config schemas. Written directly via API (always {} in B1).
          ],
          preview: {
            select: { title: 'moduleId', subtitle: 'version' },
            prepare: ({ title, subtitle }: { title?: string; subtitle?: string }) => ({
              title: title ?? 'Unknown module',
              subtitle: subtitle ?? '',
            }),
          },
        }),
      ],
      hidden: true, // managed programmatically; displayed via ProjectLinker
    }),

    // ── Migration bridge — do not remove ────────────────────────────────────
    // enabledModules: string[] is the legacy installation mechanism. It is kept
    // present in the schema as a data bridge during the migration window.
    // sanity.config.ts reads moduleInstallations first via a GROQ select(),
    // with a coalesce fallback to enabledModules for any unmigrated project.
    //
    // Do not remove this field until all project documents are migrated and
    // the coalesce fallback in sanity.config.ts is removed (post-B1 cleanup).
    defineField({
      name: 'enabledModules',
      title: 'Modules (legacy)',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      options: {
        list: [
          { title: 'Blog', value: 'blog' },
          { title: 'Events', value: 'events' },
          { title: 'Live', value: 'live' },
        ],
      },
      hidden: true, // migration bridge — superseded by moduleInstallations
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

// ─── Form Typography & Geometry ──────────────────────────────────────────────

const formTypographyType = defineType({
  name: 'formTypography',
  title: 'Form Typography',
  type: 'object',
  description: 'Typographic tokens for labels, help text, and error messages',
  fields: [
    defineField({ name: 'labelColor',    title: 'Label Color',          type: 'string', description: 'CSS color string for field labels' }),
    defineField({ name: 'labelSize',     title: 'Label Size (px)',      type: 'number', description: 'Label font size in px — e.g. 12', initialValue: 12 }),
    defineField({ name: 'labelWeight',   title: 'Label Weight',         type: 'number', description: 'Label font weight — e.g. 500', initialValue: 500 }),
    defineField({ name: 'helpTextColor', title: 'Help Text Color',      type: 'string', description: 'CSS color string for help/hint text below fields' }),
    defineField({ name: 'helpTextSize',  title: 'Help Text Size (px)',  type: 'number', description: 'Help text font size in px — e.g. 12', initialValue: 12 }),
    defineField({ name: 'errorTextColor',title: 'Error Text Color',     type: 'string', description: 'CSS color string for inline error messages' }),
    defineField({ name: 'errorTextSize', title: 'Error Text Size (px)', type: 'number', description: 'Error text font size in px — e.g. 12', initialValue: 12 }),
    defineField({ name: 'requiredColor', title: 'Required * Color',     type: 'string', description: 'Color of the required field asterisk' }),
  ],
})

const formGeometryType = defineType({
  name: 'formGeometry',
  title: 'Form Geometry',
  type: 'object',
  description: 'Spacing and shape tokens shared by all input types',
  fields: [
    defineField({ name: 'inputHeight',  title: 'Input Height (px)',    type: 'number', description: 'Standardised height for single-line inputs — e.g. 44', initialValue: 44 }),
    defineField({ name: 'paddingX',     title: 'Padding X (px)',       type: 'number', description: 'Horizontal padding inside inputs — e.g. 14', initialValue: 14 }),
    defineField({ name: 'paddingY',     title: 'Padding Y (px)',       type: 'number', description: 'Vertical padding inside inputs — e.g. 10', initialValue: 10 }),
    defineField({ name: 'labelGap',     title: 'Label → Input Gap (px)',type: 'number', description: 'Vertical space between label and input — e.g. 6', initialValue: 6 }),
    defineField({ name: 'fieldGap',     title: 'Field Gap (px)',       type: 'number', description: 'Vertical space between form fields — e.g. 20', initialValue: 20 }),
    defineField({ name: 'borderRadius', title: 'Border Radius (px)',   type: 'number', description: 'Input border radius — overrides global --radius-md', initialValue: 8 }),
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
      description: 'Internal label for this asset (e.g. "Hero Image", "Team Photo")',
    }),
    defineField({
      name: 'mediaType',
      title: 'Media Type',
      type: 'string',
      options: {
        list: [
          { title: '🖼 Image', value: 'image' },
          { title: '🎬 Video', value: 'video' },
        ],
        layout: 'radio',
      },
      initialValue: 'image',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'title',
      title: 'Display Title',
      type: 'localizedString',
      description: 'Optional display title shown in galleries (e.g. "Dr. Paolo Martegani"). Galleries can override this per item.',
    }),
    defineField({
      name: 'image',
      title: 'Image',
      type: 'image',
      description: 'Max 4000px / 10MB recommended',
      options: { hotspot: false },
      hidden: ({ document }) => (document?.mediaType as string) === 'video',
      validation: (Rule) =>
        Rule.custom((value, context) => {
          const mediaType = (context.document?.mediaType as string) ?? 'image'
          if (mediaType !== 'video' && !value) return 'Image is required for image assets'
          return true
        }),
    }),
    defineField({
      name: 'videoUrl',
      title: 'Video URL',
      type: 'string',
      description: 'Vimeo, YouTube, or direct .mp4 URL. Used when Media Type is Video.',
      hidden: ({ document }) => (document?.mediaType as string) !== 'video',
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
    { name: 'media', title: 'Media' },
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
        defineField({ name: 'input',      title: 'Input',      type: 'formInput' }),
        defineField({ name: 'textarea',   title: 'Textarea',   type: 'formInput' }),
        defineField({ name: 'select',     title: 'Select',     type: 'formInput' }),
        defineField({ name: 'checkbox',   title: 'Checkbox',   type: 'formInput' }),
        defineField({ name: 'radio',      title: 'Radio',      type: 'formInput' }),
        defineField({ name: 'typography', title: 'Typography', type: 'formTypography', description: 'Labels, help text, error messages, required marker' }),
        defineField({ name: 'geometry',   title: 'Geometry',   type: 'formGeometry',   description: 'Input height, padding, gaps, border radius' }),
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

    // Media styles — named presentation presets for images across all sections.
    // Sections (e.g. Media Content Section, Gallery) pick a style key.
    // Each Design System defines what that key looks like — radius, aspect ratio, objectFit.
    // Child DS entries override parent entries by key; new entries are appended.
    defineField({
      name: 'mediaStyles',
      title: 'Media Styles',
      type: 'array',
      group: 'media',
      description: 'Named media presentation styles. Sections reference these by key — edit here to change how images look across the entire site.',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'mediaStyleDef',
          title: 'Media Style',
          fields: [
            defineField({
              name: 'key',
              title: 'Key',
              type: 'string',
              description: 'Internal identifier used by sections — must match the option in the section schema (default, rounded, square, landscape, portrait, circle, fullHeight).',
              validation: (Rule) => Rule.required(),
            }),
            defineField({ name: 'label', title: 'Label', type: 'string', description: 'Human-readable name shown in the design system preview.' }),
            defineField({
              name: 'borderRadius',
              title: 'Border Radius (px)',
              type: 'number',
              description: 'Image corner radius in pixels. Use 9999 for a full circle.',
            }),
            defineField({
              name: 'aspectRatio',
              title: 'Aspect Ratio',
              type: 'string',
              description: 'CSS aspect-ratio value — e.g. "auto", "1/1", "4/3", "3/4", "16/9".',
              options: {
                list: [
                  { title: 'Auto (natural height)', value: 'auto' },
                  { title: '1:1 — Square', value: '1/1' },
                  { title: '4:3 — Classic', value: '4/3' },
                  { title: '3:4 — Portrait', value: '3/4' },
                  { title: '16:9 — Wide', value: '16/9' },
                ],
              },
            }),
            defineField({
              name: 'objectFit',
              title: 'Object Fit',
              type: 'string',
              description: 'How the image fills its container.',
              options: {
                list: [
                  { title: 'Cover (fill, crop edges)', value: 'cover' },
                  { title: 'Contain (show full image)', value: 'contain' },
                ],
                layout: 'radio',
              },
              initialValue: 'cover',
            }),
          ],
          preview: {
            select: { key: 'key', label: 'label', aspectRatio: 'aspectRatio' },
            prepare: ({ key, label, aspectRatio }: { key?: string; label?: string; aspectRatio?: string }) => ({
              title: label ?? key ?? 'Style',
              subtitle: `key: ${key ?? '?'}${aspectRatio && aspectRatio !== 'auto' ? ` · ${aspectRatio}` : ''}`,
            }),
          },
        }),
      ],
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

// ─── Business Location ────────────────────────────────────────────────────────
// Structured address stored once in siteConfig.
// The Contact Section reads this to generate the Google Maps embed URL
// automatically — editors never paste embed code.

const businessLocationType = defineType({
  name: 'businessLocation',
  title: 'Business Location',
  type: 'object',
  fields: [
    defineField({ name: 'street', title: 'Street', type: 'string', description: 'Street name and number, e.g. "Via Cascina Sirone 12"' }),
    defineField({ name: 'postalCode', title: 'Postal Code', type: 'string' }),
    defineField({ name: 'city', title: 'City', type: 'string' }),
    defineField({ name: 'state', title: 'State / Province', type: 'string', description: 'Optional. Only needed when city name is ambiguous.' }),
    defineField({ name: 'country', title: 'Country', type: 'string' }),
  ],
  preview: {
    select: { street: 'street', city: 'city' },
    prepare: ({ street, city }) => ({
      title: [street, city].filter(Boolean).join(', ') || 'Business Location',
    }),
  },
})

// ─── Site Config ──────────────────────────────────────────────────────────────

const siteConfigType = defineType({
  name: 'siteConfig',
  title: 'Site Config',
  type: 'document',
  groups: [
    { name: 'branding', title: 'Branding' },
    { name: 'seo', title: 'SEO Defaults' },
    { name: 'siteControls', title: 'Site Controls' },
    { name: 'locales', title: 'Languages' },
    { name: 'navigation', title: 'Navigation' },
    { name: 'contact', title: 'Contact' },
    { name: 'footer', title: 'Footer' },
    { name: 'social', title: 'Social' },
    { name: 'integrations', title: 'Integrations' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'siteName', title: 'Site Name', type: 'string', group: 'branding' }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'localizedString', group: 'branding' }),
    defineField({ name: 'logo', title: 'Logo', type: 'localizedImage', group: 'branding' }),
    defineField({ name: 'logoLight', title: 'Logo (Light variant)', type: 'localizedImage', group: 'branding' }),
    defineField({ name: 'faviconSvg', title: 'Favicon (SVG)', type: 'image', group: 'branding' }),
    defineField({ name: 'faviconPng', title: 'Favicon (PNG)', type: 'image', group: 'branding' }),
    defineField({ name: 'openGraphImage', title: 'Open Graph Image', type: 'image', group: 'branding', description: 'Social sharing image • 1200 × 630 px • JPG preferred. Used as the default og:image on all pages that do not have a page-specific image.' }),
    defineField({ name: 'appleTouchIcon', title: 'Apple Touch Icon', type: 'image', group: 'branding', description: 'Shown when the site is saved to an iPhone/iPad home screen • 180 × 180 px • PNG' }),
    defineField({ name: 'logoHeightDesktop', title: 'Logo Height — Desktop (px)', type: 'number', group: 'branding', description: 'Max height of the logo in the header on desktop. Default: 36px.', initialValue: 36 }),
    defineField({ name: 'logoHeightMobile', title: 'Logo Height — Mobile (px)', type: 'number', group: 'branding', description: 'Max height of the logo in the header on mobile. Default: 28px.', initialValue: 28 }),
    defineField({ name: 'seoDefaultTitle', title: 'Default Page Title', type: 'localizedString', group: 'seo', description: 'Used as the <title> on pages that do not have a page-specific title. Falls back to Site Name.' }),
    defineField({ name: 'seoDefaultDescription', title: 'Default Meta Description', type: 'localizedText', group: 'seo', description: 'Used as the meta description on pages that do not have a page-specific description. Falls back to Tagline.' }),
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
    defineField({
      name: 'location',
      title: 'Business Location',
      type: 'businessLocation',
      group: 'contact',
      description: 'Structured address used to generate the Google Map automatically. Fill this in and the Contact Section map will work with no further setup.',
    }),
    defineField({
      name: 'address',
      title: 'Address (legacy)',
      type: 'text',
      rows: 2,
      group: 'contact',
      readOnly: true,
      description: '⚠️ Legacy flat text field. Migrate content to Business Location above, then this field can be removed.',
    }),
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
    defineField({
      name: 'integrations',
      title: 'Integrations',
      type: 'object',
      group: 'integrations',
      description: 'Platform-managed tracking and site-verification configuration. Values are injected verbatim into page metadata/scripts.',
      fields: [
        defineField({
          name: 'analyticsEnabled',
          title: 'Analytics Enabled',
          type: 'boolean',
          initialValue: false,
          description: 'Master switch — when off, GA4, GTM, Meta Pixel, and custom tracking scripts do not execute; verification meta tags are unaffected (they are not visitor tracking).',
        }),
        defineField({
          name: 'consentModeEnabled',
          title: 'Consent Mode Enabled',
          type: 'boolean',
          initialValue: false,
          description: 'Fail-closed consent gate. When on and no valid visitor consent exists, ALL tracking is blocked — GA4, GTM, Meta Pixel, and Analytics/Marketing/Functional custom scripts. Only Necessary custom scripts (Abluo-admin-approved) still load. Until the visitor-consent mechanism ships, turning this on blocks tracking rather than permitting it.',
        }),
        defineField({
          name: 'googleAnalyticsId',
          title: 'Google Analytics (GA4) Measurement ID',
          type: 'string',
          description: 'GA4 Measurement ID, format G-XXXXXXXXXX.',
          validation: (Rule) => Rule.regex(/^G-[A-Z0-9]+$/, { name: 'ga4-measurement-id' }).error('Must be in the format G-XXXXXXXXXX'),
        }),
        defineField({
          name: 'googleTagManagerId',
          title: 'Google Tag Manager Container ID',
          type: 'string',
          description: 'GTM Container ID, format GTM-XXXXXXX.',
          validation: (Rule) => Rule.regex(/^GTM-[A-Z0-9]+$/, { name: 'gtm-container-id' }).error('Must be in the format GTM-XXXXXXX'),
        }),
        defineField({
          name: 'googleSiteVerification',
          title: 'Google Search Console Verification',
          type: 'string',
          description: 'The content value of the google-site-verification meta tag — the token only, not the full meta tag.',
        }),
        defineField({
          name: 'bingSiteVerification',
          title: 'Bing Webmaster Verification',
          type: 'string',
          description: 'The content value of the msvalidate.01 meta tag.',
        }),
        defineField({
          name: 'metaPixelId',
          title: 'Meta Pixel ID',
          type: 'string',
          description: 'Numeric Meta (Facebook) Pixel ID.',
          validation: (Rule) => Rule.regex(/^[0-9]+$/, { name: 'numeric-only' }).error('Must contain digits only'),
        }),
        defineField({
          name: 'customScripts',
          title: 'Custom Scripts',
          type: 'array',
          description: 'Platform feature managed exclusively by Abluo administrators — never exposed to tenants or the client dashboard. Intended only for trusted third-party integrations (Google, Meta, LinkedIn, Hotjar, etc.). Never paste secrets or server-side API keys. Prefer external src-based scripts over large inline snippets. Code is injected verbatim into the page.',
          of: [
            defineArrayMember({
              type: 'object',
              name: 'customScript',
              fields: [
                defineField({
                  name: 'label',
                  title: 'Label',
                  type: 'string',
                  description: 'Internal identifier for this script — not shown publicly.',
                  validation: (Rule) => Rule.required(),
                }),
                defineField({
                  name: 'description',
                  title: 'Description / Purpose',
                  type: 'text',
                  rows: 3,
                  description: 'What this script does and why it exists — internal documentation for admins.',
                  validation: (Rule) => Rule.required(),
                }),
                defineField({
                  name: 'placement',
                  title: 'Placement',
                  type: 'string',
                  options: { list: [{ title: 'Head', value: 'head' }, { title: 'End of body', value: 'bodyEnd' }], layout: 'radio' },
                  initialValue: 'head',
                }),
                defineField({
                  name: 'code',
                  title: 'Code',
                  type: 'text',
                  rows: 6,
                  description: 'Raw HTML/script, injected verbatim.',
                  validation: (Rule) => Rule.required(),
                }),
                defineField({
                  name: 'consentCategory',
                  title: 'Consent Category',
                  type: 'string',
                  options: {
                    list: [
                      { title: 'Necessary', value: 'necessary' },
                      { title: 'Analytics', value: 'analytics' },
                      { title: 'Marketing', value: 'marketing' },
                      { title: 'Functional', value: 'functional' },
                    ],
                    layout: 'radio',
                  },
                  description: 'When consentModeEnabled is on and no valid visitor consent exists, only Necessary scripts load — Analytics, Marketing, and Functional scripts are blocked until the consent mechanism ships and consent is given.',
                  validation: (Rule) => Rule.required(),
                }),
                defineField({ name: 'enabled', title: 'Enabled', type: 'boolean', initialValue: false }),
              ],
              preview: {
                select: { title: 'label', category: 'consentCategory', placement: 'placement', enabled: 'enabled' },
                prepare: ({ title, category, placement, enabled }) => ({
                  title: title ?? 'Untitled script',
                  subtitle: `${category ?? '—'} · ${placement ?? '—'}${enabled === false ? ' · disabled' : ''}`,
                }),
              },
            }),
          ],
        }),
      ],
    }),
  ],
  preview: {
    select: { title: 'siteName', slug: 'projectSlug' },
    prepare: ({ title, slug }) => ({ title: title ?? slug ?? 'Site Config', subtitle: slug }),
  },
})

// livePage, eventsPage, blogPage, event moved to module schema files (ADR-011 Phase D1):
//   livePage   → src/lib/modules/live/schema.ts
//   eventsPage → src/lib/modules/events/schema.ts
//   event      → src/lib/modules/events/schema.ts
//   blogPage   → src/lib/modules/blog/schema.ts

// ─── Page ─────────────────────────────────────────────────────────────────────

const pageType = defineType({
  name: 'page',
  title: 'Page',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'redirects', title: 'Redirects' },
  ],
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
      title: 'Old Slugs (Redirects)',
      type: 'redirectFrom',
      group: 'redirects',
      description: 'Fill these only when you rename a slug. Old URLs here will 301-redirect to the current slug.',
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
        defineArrayMember({ type: 'heroLiveCaptureSection' }),
        defineArrayMember({ type: 'heroLensSection' }),
        defineArrayMember({ type: 'contentSection' }),
        defineArrayMember({ type: 'statementSection' }),
        defineArrayMember({ type: 'treatmentsSection' }),
        defineArrayMember({ type: 'teamSection' }),
        defineArrayMember({ type: 'textSection' }),
        defineArrayMember({ type: 'faqSection' }),
        defineArrayMember({ type: 'contactSection' }),
        defineArrayMember({ type: 'blogListingSection' }),
        defineArrayMember({ type: 'formSection' }),
        defineArrayMember({ type: 'metricsSection' }),
        defineArrayMember({ type: 'photoGallerySection' }),
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
        defineArrayMember({ type: 'heroLiveCaptureSection' }),
        defineArrayMember({ type: 'heroLensSection' }),
        defineArrayMember({ type: 'contentSection' }),
        defineArrayMember({ type: 'statementSection' }),
        defineArrayMember({ type: 'treatmentsSection' }),
        defineArrayMember({ type: 'teamSection' }),
        defineArrayMember({ type: 'textSection' }),
        defineArrayMember({ type: 'faqSection' }),
        defineArrayMember({ type: 'contactSection' }),
        defineArrayMember({ type: 'blogListingSection' }),
        defineArrayMember({ type: 'formSection' }),
        defineArrayMember({ type: 'metricsSection' }),
        defineArrayMember({ type: 'photoGallerySection' }),
      ],
    }),
  ],
  preview: {
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: `Home — ${slug ?? '?'}` }),
  },
})

// postAuthorType, blogCategoryType, postType moved to src/lib/modules/blog/schema.ts (ADR-011 Phase D1).

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
      featured: false,
    }),
  },
  {
    id: 'postAuthorProjectOwned',
    title: 'Author',
    schemaType: 'postAuthor',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
    }),
  },
  {
    id: 'blogCategoryProjectOwned',
    title: 'Category',
    schemaType: 'blogCategory',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
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
  {
    id: 'blogPageProjectOwned',
    title: 'Blog Page',
    schemaType: 'blogPage',
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
  ctaType,
  navigationLinkType,
  socialLinkType,
  scheduleItemType,
  whatsappSubjectType,
  emailSubjectType,
  heroSectionType,
  heroLiveCaptureSectionType,
  heroLensSectionType,
  contentSectionType,
  statementSectionType,
  treatmentCardType,
  treatmentsSectionType,
  teamMemberType,
  teamSectionType,
  textSectionType,
  businessLocationType,
  contactSectionType,
  faqItemType,
  faqSectionType,
  metricItemType,
  metricsSectionType,
  formOptionItemType,
  formFieldItemType,
  formType,
  formSectionType,
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
  formTypographyType,
  formGeometryType,
  glassStyleType,
  sectionSurfacesThemeType,
  sectionSurfacesType,
  backgroundAssetType,
  mediaAssetType,
  galleryItemType,
  galleryType,
  photoGallerySectionType,
  designSystemType,
  siteConfigType,
  pageType,
  homePageType,
  // Module-owned types — derived from MODULE_REGISTRY via buildSchema().
  // heroLiveCaptureSection and heroLensSection are platform-distributed section
  // templates registered above; their availability is not module-gated.
  ...buildSchema(),
]
