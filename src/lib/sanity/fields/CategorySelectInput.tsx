'use client'

import { useEffect, useMemo, useState } from 'react'
import { useClient, useFormValue, set, unset, type ArrayOfPrimitivesInputProps } from 'sanity'

/**
 * CategorySelectInput — choose from categories defined in the module.
 *
 * ADR-020 Amendment B.
 *
 * Categories used to be documents chosen through a reference picker. They are
 * now per-website module configuration: an admin defines the vocabulary once in
 * Modules → Blog, and an author SELECTS from it while writing. Defining is
 * configuration; selecting is content.
 *
 * That is what makes this component necessary. The choices live in
 * `project.moduleInstallations[moduleId].config.categories` for the project this
 * document belongs to, so they cannot be a static `options.list` — Sanity
 * resolves those at schema-build time, with no idea which website a document
 * belongs to.
 *
 * The stored value is an array of stable category KEYS, never labels. Renaming
 * "Dental Health", or translating it into German, leaves every post that
 * references it untouched.
 */

interface ConfiguredCategory {
  value: string
  label: Record<string, string>
  color?: string
}

/** Admin-facing label, English-first — Studio UI language, not content locale (ADR-010). */
function displayLabel(category: ConfiguredCategory): string {
  const label = category.label ?? {}
  return label.en ?? label.it ?? Object.values(label).find(Boolean) ?? category.value
}

export function CategorySelectInput(props: ArrayOfPrimitivesInputProps) {
  const client = useClient({ apiVersion: '2026-05-21' })
  const moduleId =
    ((props.schemaType.options as { moduleId?: string } | undefined)?.moduleId) ?? 'blog'

  // Every module-owned content type carries projectSlug — the universal tenant
  // key (CLAUDE.md). It tells us whose vocabulary to load.
  const projectSlug = useFormValue(['projectSlug']) as string | undefined

  const [categories, setCategories] = useState<ConfiguredCategory[]>([])
  const [loading, setLoading] = useState(true)

  const selected = useMemo(
    () => (props.value ?? []).filter((v): v is string => typeof v === 'string'),
    [props.value]
  )

  useEffect(() => {
    if (!projectSlug) {
      setLoading(false)
      return
    }
    setLoading(true)
    client
      .fetch<ConfiguredCategory[] | null>(
        `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]
          .moduleInstallations[moduleId == $moduleId][0]
          .config.categories[]{ value, label, color }`,
        { projectSlug, moduleId }
      )
      .then((data) => setCategories(data ?? []))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false))
  }, [projectSlug, moduleId]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: string[]) => props.onChange(next.length > 0 ? set(next) : unset())

  const toggle = (value: string) =>
    commit(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
    )

  if (!projectSlug) {
    return (
      <div style={{ fontSize: 13, color: '#999' }}>
        Assign this document to a website first — categories are defined per website.
      </div>
    )
  }

  if (loading) return <div style={{ fontSize: 13, color: '#aaa' }}>Loading categories…</div>

  if (categories.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#999', lineHeight: 1.5 }}>
        No categories defined yet. Add them under <strong>Modules → Categories</strong>, then
        choose them here.
      </div>
    )
  }

  // Keys with no matching definition — a category removed from the module while
  // content still references it. Surfaced rather than silently dropped.
  const orphans = selected.filter((v) => !categories.some((c) => c.value === v))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {categories.map((category) => {
          const isOn = selected.includes(category.value)
          const accent = category.color || '#1a1a1a'
          return (
            <label
              key={category.value}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderRadius: 999,
                fontSize: 13,
                cursor: 'pointer',
                border: `1px solid ${isOn ? accent : '#d0d0d0'}`,
                background: isOn ? `color-mix(in srgb, ${accent} 12%, transparent)` : '#fff',
                color: isOn ? accent : '#444',
              }}
            >
              <input
                type="checkbox"
                checked={isOn}
                onChange={() => toggle(category.value)}
                style={{ width: 14, height: 14 }}
              />
              {displayLabel(category)}
            </label>
          )
        })}
      </div>

      {orphans.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#8d6e00' }}>
          No longer defined in the module: {orphans.join(', ')}.{' '}
          <button
            type="button"
            onClick={() => commit(selected.filter((v) => !orphans.includes(v)))}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: '#1565c0',
              cursor: 'pointer',
              font: 'inherit',
              textDecoration: 'underline',
            }}
          >
            Remove them
          </button>
        </div>
      )}
    </div>
  )
}
