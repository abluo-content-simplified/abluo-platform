'use client'

/**
 * LocalizedInput — tenant-aware localized field components for Sanity Studio.
 *
 * These replace the default object input for localizedString, localizedText,
 * and localizedPortableText. Instead of showing all 7 platform language fields,
 * they read the current document's projectSlug, query that project's
 * siteConfig.supportedLocales, and render only those fields.
 *
 * Storage format is unchanged — the underlying Sanity document still stores
 * { en: '...', it: '...', ... }. Only the editor experience is filtered.
 *
 * If projectSlug is not set or siteConfig has no locales, all platform
 * languages are shown as a safe fallback (same as the default Studio behavior).
 */

import { ObjectInputProps, MemberField, MemberFieldSet, MemberFieldError } from 'sanity'
import { useProjectLocales } from './useProjectLocales'
import { PLATFORM_LOCALES, type SupportedLocale } from '@/lib/i18n/locales'

const ALL_LOCALE_KEYS = new Set(Object.keys(PLATFORM_LOCALES))

/**
 * From the Studio's `members` array, return only the fields whose names
 * match the tenant's supported locales — ordered by siteConfig order
 * (default locale first). Non-locale fields pass through unchanged at the end.
 */
function getFilteredMembers(
  members: ObjectInputProps['members'],
  locales: SupportedLocale[]
) {
  // Partition: locale-keyed vs everything else
  const localeMembers = new Map<string, (typeof members)[number]>()
  const otherMembers: (typeof members)[number][] = []

  for (const member of members) {
    const name = member.kind === 'field' ? (member as { name: string }).name : null
    if (name && ALL_LOCALE_KEYS.has(name)) {
      localeMembers.set(name, member)
    } else {
      otherMembers.push(member)
    }
  }

  // Order: siteConfig locale order → non-locale members
  const ordered = locales
    .map((code) => localeMembers.get(code))
    .filter((m): m is NonNullable<typeof m> => m !== undefined)

  return [...ordered, ...otherMembers]
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function LoadingBadge() {
  return (
    <div style={{ fontSize: 11, color: '#999', fontStyle: 'italic', marginBottom: 8 }}>
      Loading tenant languages…
    </div>
  )
}

function LanguageBadge({ locales }: { locales: SupportedLocale[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {locales.map((code) => (
        <span
          key={code}
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '2px 6px',
            borderRadius: 3,
            background: '#f0f0f0',
            color: '#555',
          }}
        >
          {code}
        </span>
      ))}
    </div>
  )
}

// ─── Shared rendering wrapper ─────────────────────────────────────────────────

function LocalizedInputWrapper({
  props,
  showBadge = true,
}: {
  props: ObjectInputProps
  showBadge?: boolean
}) {
  const { locales, loading } = useProjectLocales()
  const filteredMembers = getFilteredMembers(props.members, locales)
  const isFiltered = locales.length < ALL_LOCALE_KEYS.size

  return (
    <div>
      {loading && <LoadingBadge />}
      {!loading && showBadge && isFiltered && <LanguageBadge locales={locales} />}
      {filteredMembers.map((member) => {
        const renderProps = {
          key: member.key,
          renderAnnotation: props.renderAnnotation,
          renderBlock: props.renderBlock,
          renderField: props.renderField,
          renderInlineBlock: props.renderInlineBlock,
          renderInput: props.renderInput,
          renderItem: props.renderItem,
          renderPreview: props.renderPreview,
        }
        if (member.kind === 'field') return <MemberField {...renderProps} member={member} />
        if (member.kind === 'fieldSet') return <MemberFieldSet {...renderProps} member={member} />
        if (member.kind === 'error') return <MemberFieldError {...renderProps} member={member} />
        return null
      })}
    </div>
  )
}

// ─── Exported input components ────────────────────────────────────────────────

export function LocalizedStringInput(props: ObjectInputProps) {
  return <LocalizedInputWrapper props={props} />
}

export function LocalizedTextInput(props: ObjectInputProps) {
  return <LocalizedInputWrapper props={props} />
}

export function LocalizedPortableTextInput(props: ObjectInputProps) {
  // Rich text fields are tall — skip the badge; field titles show the language names.
  return <LocalizedInputWrapper props={props} showBadge={false} />
}
