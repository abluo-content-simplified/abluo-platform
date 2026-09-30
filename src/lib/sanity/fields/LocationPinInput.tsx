'use client'

// ─── Entrance pin picker (siteLocation.pin) ──────────────────────────────────
//
// A draggable Google map for ONE field — the entrance pin of a location —
// built on @sanity/google-maps-input's GeopointInput. The plugin is NOT added
// to sanity.config.ts `plugins`, because that would replace every geopoint
// input in the Studio; this component is wired on the field instead
// (`components.input` in schema.ts).
//
// Pinned to @sanity/google-maps-input 4.1.1 (the last release for Sanity 3
// that uses @sanity/ui 2): its dialog reads the key from a module-level
// config that only the plugin factory sets (`setGeoConfig`), so we call the
// factory once for that side effect and never register the returned plugin.
//
// No NEXT_PUBLIC_GOOGLE_MAPS_STUDIO_KEY → Sanity's plain lat/lng fields.
// "Enter coordinates by hand" is always available (e.g. key rejected by Google).

import { useState } from 'react'
import { Box, Button, Flex, Stack } from '@sanity/ui'
import type { ObjectInputProps } from 'sanity'
import { GeopointInput, googleMapsInput, type GeopointInputProps } from '@sanity/google-maps-input'
import { resolveStudioPinMapConfig } from '@/lib/maps/studio-pin'

// Inlined by Next at build time (the Studio is embedded at /studio), so it
// must be a NEXT_PUBLIC_ variable referenced literally.
const STUDIO_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_STUDIO_KEY

let registeredKey: string | null = null
function ensurePluginConfig(apiKey: string) {
  if (registeredKey === apiKey) return
  try {
    googleMapsInput({ apiKey, defaultLocale: 'en' })
    registeredKey = apiKey
  } catch {
    // Never break the form — the caller falls back to the plain fields.
  }
}

export function LocationPinInput(props: ObjectInputProps) {
  const [manual, setManual] = useState(false)
  const value = props.value as { lat?: unknown; lng?: unknown } | undefined
  const config = resolveStudioPinMapConfig(STUDIO_MAPS_KEY, value)

  if (!config) return props.renderDefault(props)

  ensurePluginConfig(config.apiKey)
  if (registeredKey !== config.apiKey) return props.renderDefault(props)

  return (
    <Stack space={3}>
      {manual ? (
        props.renderDefault(props)
      ) : (
        <GeopointInput {...(props as unknown as Omit<GeopointInputProps, 'geoConfig'>)} geoConfig={config} />
      )}
      <Flex justify="flex-end">
        <Box>
          <Button
            mode="bleed"
            fontSize={1}
            padding={2}
            text={manual ? 'Use the map' : 'Enter coordinates by hand'}
            onClick={() => setManual((m) => !m)}
          />
        </Box>
      </Flex>
    </Stack>
  )
}
