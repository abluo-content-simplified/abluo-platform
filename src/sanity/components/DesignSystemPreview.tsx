'use client'

import { useState } from 'react'

interface ColorTheme {
  background?: string
  secondary?: string
  primary?: string
  textPrimary?: string
  border?: string
}

interface DesignSystemDoc {
  name?: string
  projectSlug?: string
  colors?: {
    darkTheme?: ColorTheme
    lightTheme?: ColorTheme
  }
  typography?: {
    headingFont?: string
    bodyFont?: string
  }
  radius?: {
    small?: number
    medium?: number
    large?: number
  }
  spacing?: {
    xs?: number
    s?: number
    m?: number
    l?: number
    xl?: number
  }
}

interface Props {
  document: {
    displayed: DesignSystemDoc
  }
}

function Swatch({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: value,
          border: '1px solid rgba(0,0,0,0.1)',
          flexShrink: 0,
        }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{value}</div>
      </div>
    </div>
  )
}

export function DesignSystemPreview({ document: { displayed } }: Props) {
  const [mode, setMode] = useState<'dark' | 'light'>('dark')

  const theme = mode === 'dark' ? displayed.colors?.darkTheme : displayed.colors?.lightTheme
  const headingFont = displayed.typography?.headingFont ?? 'sans-serif'
  const bodyFont = displayed.typography?.bodyFont ?? 'sans-serif'

  const bg = theme?.background ?? (mode === 'dark' ? '#1a1a2e' : '#ffffff')
  const textColor = theme?.textPrimary ?? (mode === 'dark' ? '#f5f5f5' : '#111111')
  const primaryColor = theme?.primary ?? '#f59e0b'
  const secondaryBg = theme?.secondary ?? (mode === 'dark' ? '#2a2a3e' : '#f3f4f6')
  const borderColor = theme?.border ?? 'rgba(128,128,128,0.2)'

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 800 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111' }}>
            {displayed.name ?? displayed.projectSlug ?? 'Design System'} — Preview
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#888' }}>
            Visual preview of colors, typography, and components
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['dark', 'light'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '6px 16px',
                borderRadius: 6,
                border: '1px solid #ddd',
                background: mode === m ? '#111' : '#fff',
                color: mode === m ? '#fff' : '#111',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {m === 'dark' ? '🌙 Dark' : '☀️ Light'}
            </button>
          ))}
        </div>
      </div>

      {/* Live render */}
      <div
        style={{
          background: bg,
          borderRadius: 16,
          padding: 40,
          border: '1px solid #e5e7eb',
          marginBottom: 40,
        }}
      >
        {/* Typography */}
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: textColor, opacity: 0.4, marginBottom: 16 }}>
            Typography
          </p>
          <div style={{ fontFamily: headingFont, color: textColor, fontSize: 48, fontWeight: 700, lineHeight: 1.1, marginBottom: 8 }}>
            Heading Font
          </div>
          <div style={{ fontFamily: bodyFont, color: textColor, fontSize: 16, lineHeight: 1.6, opacity: 0.75 }}>
            Body text — {bodyFont}. The quick brown fox jumps over the lazy dog.
          </div>
        </div>

        {/* Buttons */}
        <div style={{ marginBottom: 32, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ width: '100%', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: textColor, opacity: 0.4, margin: '0 0 12px' }}>
            Buttons
          </p>
          <button
            style={{
              padding: '12px 24px',
              borderRadius: displayed.radius?.medium ?? 12,
              background: primaryColor,
              border: 'none',
              color: '#fff',
              fontFamily: bodyFont,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'default',
            }}
          >
            Primary Button
          </button>
          <button
            style={{
              padding: '12px 24px',
              borderRadius: displayed.radius?.medium ?? 12,
              background: 'transparent',
              border: `2px solid ${primaryColor}`,
              color: primaryColor,
              fontFamily: bodyFont,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'default',
            }}
          >
            Secondary Button
          </button>
        </div>

        {/* Card */}
        <div style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: textColor, opacity: 0.4, marginBottom: 12 }}>
            Card
          </p>
          <div
            style={{
              background: secondaryBg,
              border: `1px solid ${borderColor}`,
              borderRadius: displayed.radius?.large ?? 16,
              padding: 24,
            }}
          >
            <div style={{ fontFamily: headingFont, color: textColor, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              Card Title
            </div>
            <div style={{ fontFamily: bodyFont, color: textColor, opacity: 0.65, fontSize: 14, lineHeight: 1.6 }}>
              This is how a card looks with the current theme settings.
            </div>
          </div>
        </div>
      </div>

      {/* Color palette */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 16 }}>
          {mode === 'dark' ? 'Dark' : 'Light'} Theme Colors
        </h3>
        <Swatch label="Background" value={theme?.background} />
        <Swatch label="Secondary / Surface" value={theme?.secondary} />
        <Swatch label="Primary" value={theme?.primary} />
        <Swatch label="Text Primary" value={theme?.textPrimary} />
        <Swatch label="Border" value={theme?.border} />
      </div>

      {/* Typography info */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 16 }}>Typography</h3>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1, background: '#f9fafb', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Heading Font</div>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: headingFont }}>{headingFont}</div>
          </div>
          <div style={{ flex: 1, background: '#f9fafb', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Body Font</div>
            <div style={{ fontSize: 16, fontFamily: bodyFont }}>{bodyFont}</div>
          </div>
        </div>
      </div>

      {/* Radius */}
      {displayed.radius && (
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 16 }}>Border Radius</h3>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
            {(['small', 'medium', 'large'] as const).map((size) => {
              const r = displayed.radius?.[size]
              if (!r) return null
              return (
                <div key={size} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: 60,
                      height: 60,
                      background: '#e5e7eb',
                      borderRadius: r,
                      marginBottom: 8,
                    }}
                  />
                  <div style={{ fontSize: 11, color: '#888' }}>{size}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111', fontFamily: 'monospace' }}>{r}px</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
