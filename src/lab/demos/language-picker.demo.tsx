'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { LanguagePicker } from '@/components/app/ui/LanguagePicker'
import { languageDisplayName } from '@/components/app/ui/language-model'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function LanguagePickerDemo() {
  const locale = useLocale()
  const [value, setValue] = useState<string[]>(['it'])
  const [limited, setLimited] = useState<string[]>(['fr', 'en'])
  return (
    <DemoStack>
      <DemoBlock title="Site languages first" note="suggested chips are always shown; More languages opens a searchable sheet with every ISO 639-1 language, named in the UI language.">
        <div className="w-full max-w-md">
          <LanguagePicker label="Languages" value={value} onChange={setValue} suggested={['it', 'en', 'de']} />
        </div>
        <p className="w-full text-sm text-muted-foreground">Value: {value.map((c) => `${c} (${languageDisplayName(c, locale)})`).join(', ') || 'none'}</p>
      </DemoBlock>
      <DemoBlock title="With a limit" note="max stops further picks (here 3); the rest turn off in the sheet until one is removed.">
        <div className="w-full max-w-md">
          <LanguagePicker label="Taught in" value={limited} onChange={setLimited} suggested={['fr', 'en']} max={3} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
