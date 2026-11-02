'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { CountryPicker } from '@/components/app/ui/CountryPicker'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { countryName } from '@/components/app/ui/country-model'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function CountryPickerDemo() {
  const locale = useLocale()
  const [country, setCountry] = useState<string | null>('IT')
  const [optional, setOptional] = useState<string | null>(null)
  return (
    <DemoStack>
      <DemoBlock title="The field" note="id, value, onChange (ISO alpha-2, upper-case). Opens a sheet: search, EU member states first, then all other countries, named in the UI language.">
        <div className="w-full max-w-sm">
          <FieldLabel htmlFor="demo-cp-country">Country</FieldLabel>
          <CountryPicker id="demo-cp-country" value={country} onChange={setCountry} />
        </div>
        <p className="w-full text-sm text-muted-foreground">
          Value: {country || 'none'}
          {country ? ` (${countryName(country, locale)})` : ''}
        </p>
      </DemoBlock>
      <DemoBlock title="Optional" note="clearable adds Clear to the sheet (onChange('')).">
        <div className="w-full max-w-sm">
          <FieldLabel htmlFor="demo-cp-optional">Country of residence</FieldLabel>
          <CountryPicker id="demo-cp-optional" value={optional} onChange={setOptional} clearable />
        </div>
        <p className="w-full text-sm text-muted-foreground">Value: {optional || 'none'}</p>
      </DemoBlock>
    </DemoStack>
  )
}
