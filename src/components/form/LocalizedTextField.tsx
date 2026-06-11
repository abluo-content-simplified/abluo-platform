'use client'

import { useState } from 'react'

interface LocalizedTextFieldProps {
  value: Record<string, string> | undefined
  onChange: (value: Record<string, string>) => void
  languages: string[]
  label: string
  placeholder?: string
  required?: boolean
}

export function LocalizedTextField({
  value = {},
  onChange,
  languages,
  label,
  placeholder,
  required,
}: LocalizedTextFieldProps) {
  const [activeLanguage, setActiveLanguage] = useState(languages[0] || 'en')

  const handleChange = (lang: string, text: string) => {
    onChange({
      ...value,
      [lang]: text,
    })
  }

  const getStatus = (lang: string) => {
    const content = value[lang]
    return content && content.trim().length > 0 ? '✓' : '○'
  }

  return (
    <div>
      <label className="text-sm font-medium text-zinc-700 block mb-2">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>

      {languages.length > 1 && (
        <div className="flex gap-2 mb-3 border-b border-zinc-200">
          {languages.map((lang) => (
            <button
              key={lang}
              onClick={() => setActiveLanguage(lang)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                activeLanguage === lang
                  ? 'text-zinc-900 border-b-2 border-zinc-900 -mb-[2px]'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {lang.toUpperCase()} <span className="text-xs ml-1">{getStatus(lang)}</span>
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        value={value[activeLanguage] || ''}
        onChange={(e) => handleChange(activeLanguage, e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
      />
    </div>
  )
}
