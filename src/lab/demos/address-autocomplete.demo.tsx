'use client'

import { useState } from 'react'
import { AddressAutocomplete, type AddressProvider } from '@/components/app/ui/AddressAutocomplete'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import type { ParsedAddress } from '@/components/app/ui/address-model'
import { DemoBlock, DemoStack } from '../demo-kit'

/** Canned places so the demo never calls Google. */
const PLACES: { placeId: string; primary: string; secondary: string; address: ParsedAddress }[] = [
  { placeId: 'demo-it', primary: 'Via Roma 1', secondary: 'Cervia RA, Italia', address: { addressLine1: 'Via Roma 1', postalCode: '48015', city: 'Cervia', region: 'RA', country: 'IT' } },
  { placeId: 'demo-de', primary: 'Südstraße 27', secondary: 'München, Deutschland', address: { addressLine1: 'Südstraße 27', postalCode: '80331', city: 'München', region: 'Bayern', country: 'DE' } },
  { placeId: 'demo-gb', primary: '10 Downing Street', secondary: 'London, UK', address: { addressLine1: '10 Downing Street', postalCode: 'SW1A 2AA', city: 'London', region: 'England', country: 'GB' } },
]
const demoProvider: AddressProvider = {
  search: async (input) => PLACES.filter((p) => `${p.primary} ${p.secondary}`.toLowerCase().includes(input.toLowerCase())).map(({ placeId, primary, secondary }) => ({ placeId, primary, secondary })),
  details: async (placeId) => PLACES.find((p) => p.placeId === placeId)?.address ?? null,
}

export default function AddressAutocompleteDemo() {
  const [line1, setLine1] = useState('')
  const [picked, setPicked] = useState<ParsedAddress | null>(null)
  return (
    <DemoStack>
      <DemoBlock title="The field" note="Type 3+ characters (try “via”, “süd” or “london”). Arrow keys move, Enter picks, Escape closes. This demo uses canned places; the real field asks Google Places (New) with the Maps key.">
        <div className="w-full max-w-sm">
          <FieldLabel htmlFor="demo-aa-line1">Address</FieldLabel>
          <AddressAutocomplete id="demo-aa-line1" value={line1} onChange={setLine1} onSelect={setPicked} provider={demoProvider} />
        </div>
        <pre className="w-full overflow-x-auto text-xs text-muted-foreground">{picked ? JSON.stringify(picked, null, 2) : 'onSelect: nothing picked yet'}</pre>
      </DemoBlock>
    </DemoStack>
  )
}
