/**
 * Section picker — replaces the "Add item" button of every page `sections`
 * array with an "Add section" dialog: sections grouped by purpose, each with a
 * sketch and one line of text, filtered to what the project can actually show.
 *
 * Wired once in sanity.config.ts (form.components.input), so no schema field
 * changes: every array whose members are the page sections gets it.
 *
 * Also groups Sanity's own insert menu (it still appears for "Add item
 * before / after" on an existing row) using the same catalogue.
 *
 * Filtering: a module's sections are offered only when the project has that
 * module installed (project.moduleInstallations, enabled != false). Unknown
 * state → offer everything; the website renderer gates anyway. A type already
 * on the page is always kept, so existing sections never turn invalid.
 */
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  useClient,
  useFormValue,
  type ArrayInputFunctionsProps,
  type ArrayOfObjectsInputProps,
  type ArraySchemaType,
  type InputProps,
  type SchemaType,
} from 'sanity'
import { Box, Button, Card, Dialog, Flex, Grid, Stack, Text, TextInput } from '@sanity/ui'
import { AddIcon, SearchIcon } from '@sanity/icons'
import {
  SECTION_CATALOGUE,
  SECTION_GROUPS,
  insertMenuGroups,
  offeredSectionTypes,
} from '@/lib/sanity/sections/catalogue'
import { SectionPreview } from './SectionPreviews'

const API_VERSION = '2024-01-01'
const INSTALLED_QUERY = `*[_type == "project" && projectSlug == $projectSlug][0]{
  "ids": coalesce(moduleInstallations[enabled != false].moduleId, [])
}`

type SectionItem = { _type: string; _key: string }

/** An array is a page-sections array when it can hold the page section types. */
export function isPageSectionsArray(schemaType: SchemaType): schemaType is ArraySchemaType {
  if (schemaType.jsonType !== 'array') return false
  const names = new Set(((schemaType as ArraySchemaType).of ?? []).map((t) => t.name))
  return names.has('heroSection') && names.has('locationsSection')
}

/** Installed module ids for the document's project; null = unknown. */
function useInstalledModules(): Set<string> | null {
  const projectSlug = useFormValue(['projectSlug']) as string | undefined
  const client = useClient({ apiVersion: API_VERSION })
  const [installed, setInstalled] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (!projectSlug) {
      setInstalled(null)
      return
    }
    let live = true
    client
      .fetch<{ ids: string[] } | null>(INSTALLED_QUERY, { projectSlug })
      .then((r) => live && setInstalled(r ? new Set(r.ids) : null))
      .catch(() => live && setInstalled(null))
    return () => {
      live = false
    }
  }, [client, projectSlug])
  return installed
}

// ── "Add section" button + dialog ─────────────────────────────────────────────

function AddSectionFunctions(props: ArrayInputFunctionsProps<SectionItem, ArraySchemaType>) {
  const { schemaType, readOnly, onValueCreate, onItemAppend } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const members = schemaType.of
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (t: SchemaType) => {
      if (!q) return true
      const d = SECTION_CATALOGUE[t.name]?.description ?? ''
      return `${t.title ?? t.name} ${d}`.toLowerCase().includes(q)
    }
    const listed = SECTION_GROUPS.map((g) => ({
      ...g,
      types: members.filter((t) => SECTION_CATALOGUE[t.name]?.group === g.id && match(t)),
    }))
    // Anything not in the catalogue still shows (the test keeps this empty).
    const rest = members.filter((t) => !SECTION_CATALOGUE[t.name] && match(t))
    if (rest.length) listed.push({ id: 'review', title: 'Other', hint: '', types: rest })
    return listed.filter((g) => g.types.length > 0)
  }, [members, query])

  const add = (type: SchemaType) => {
    onItemAppend(onValueCreate(type as ArraySchemaType) as SectionItem)
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      <Button
        icon={AddIcon}
        mode="ghost"
        text="Add section"
        disabled={readOnly}
        onClick={() => setOpen(true)}
        style={{ width: '100%' }}
      />
      {open && (
        <Dialog
          id="abluo-add-section"
          header="Add section"
          width={3}
          onClose={() => {
            setOpen(false)
            setQuery('')
          }}
          onClickOutside={() => setOpen(false)}
        >
          <Box padding={4}>
            <Stack space={5}>
              <TextInput
                icon={SearchIcon}
                placeholder="Search sections"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.currentTarget.value)}
              />
              {groups.length === 0 && (
                <Text muted size={1}>
                  No section matches “{query}”.
                </Text>
              )}
              {groups.map((g) => (
                <Stack key={g.id} space={3}>
                  <Stack space={2}>
                    <Text size={1} weight="semibold">
                      {g.title}
                    </Text>
                    {g.hint && (
                      <Text size={1} muted>
                        {g.hint}
                      </Text>
                    )}
                  </Stack>
                  <Grid columns={[1, 2, 3]} gap={3}>
                    {g.types.map((t) => (
                      <Card
                        key={t.name}
                        as="button"
                        type="button"
                        radius={2}
                        border
                        padding={2}
                        onClick={() => add(t)}
                        style={{ textAlign: 'left', cursor: 'pointer' }}
                      >
                        <Flex direction="column" gap={3} align="stretch">
                          <Card radius={1} tone="transparent" padding={2}>
                            <SectionPreview type={t.name} />
                          </Card>
                          <Stack space={2} paddingX={1} paddingBottom={1}>
                            <Text size={1} weight="semibold">
                              {t.title ?? t.name}
                            </Text>
                            {SECTION_CATALOGUE[t.name] && (
                              <Text size={1} muted>
                                {SECTION_CATALOGUE[t.name].description}
                              </Text>
                            )}
                          </Stack>
                        </Flex>
                      </Card>
                    ))}
                  </Grid>
                </Stack>
              ))}
            </Stack>
          </Box>
        </Dialog>
      )}
    </>
  )
}

// ── the input ─────────────────────────────────────────────────────────────────

function makeSectionsInput(sectionOwner: Record<string, string>) {
  return function SectionsInput(props: ArrayOfObjectsInputProps) {
    const installed = useInstalledModules()
    const value = props.value as SectionItem[] | undefined
    const usedKey = (value ?? []).map((i) => i._type).sort().join(',')
    const installedKey = installed ? [...installed].sort().join(',') : '∅'

    const schemaType = useMemo(() => {
      const all = props.schemaType.of.map((t) => t.name)
      const used = new Set(usedKey ? usedKey.split(',') : [])
      const offered = new Set(offeredSectionTypes(all, sectionOwner, installed, used))
      const of = props.schemaType.of.filter((t) => offered.has(t.name))
      return {
        ...props.schemaType,
        of,
        options: {
          ...props.schemaType.options,
          insertMenu: {
            filter: true,
            showIcons: true,
            groups: insertMenuGroups(of.map((t) => t.name)),
            views: [{ name: 'list' as const }],
          },
        },
      } as typeof props.schemaType
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.schemaType, usedKey, installedKey])

    return props.renderDefault({
      ...props,
      schemaType,
      arrayFunctions: AddSectionFunctions as ComponentType<ArrayInputFunctionsProps<unknown, ArraySchemaType>>,
    } as ArrayOfObjectsInputProps)
  }
}

/**
 * form.components.input for sanity.config.ts: page-sections arrays get the
 * picker, every other input renders as before.
 */
export function sectionPickerInput(sectionOwner: Record<string, string>) {
  const SectionsInput = makeSectionsInput(sectionOwner)
  return function SectionPickerInputResolver(props: InputProps) {
    if (isPageSectionsArray(props.schemaType)) {
      return <SectionsInput {...(props as ArrayOfObjectsInputProps)} />
    }
    return props.renderDefault(props)
  }
}
