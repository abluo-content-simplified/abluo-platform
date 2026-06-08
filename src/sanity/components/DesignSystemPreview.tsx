'use client'

import { useState, useEffect } from 'react'

// Weight/style params per font family — mirrors layout.tsx FONT_WEIGHT_PARAMS
const PREVIEW_FONT_PARAMS: Record<string, string> = {
  'Geist': 'wght@100;200;300;400;500;600;700;800;900',
  'Barlow Condensed': 'ital,wght@0,400;0,500;0,600;0,700;1,400',
  'Poppins': 'wght@300;400;500;600;700',
  'Playfair Display': 'ital,wght@0,400;0,600;0,700;1,400',
  'Lora': 'ital,wght@0,400;0,600;0,700;1,400',
}

function buildPreviewFontsUrl(headingFont: string, bodyFont: string): string {
  const families = Array.from(new Set([headingFont, bodyFont]))
    .filter((f) => f !== 'sans-serif' && f !== 'serif')
    .map((name) => {
      const weights = PREVIEW_FONT_PARAMS[name] ?? 'wght@400;500;600;700'
      return `family=${name.replace(/ /g, '+')}:${weights}`
    })
  if (!families.length) return ''
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ColorTheme {
  background?: string
  backgroundAlt?: string
  surface?: string
  primary?: string
  secondary?: string
  accent?: string
  textPrimary?: string
  textSecondary?: string
  textMuted?: string
  border?: string
  success?: string
  warning?: string
  danger?: string
}

interface FontDefinition {
  source?: 'library' | 'google'
  libraryFont?: string
  googleFont?: string
}

interface Typescale {
  size?: number
  weight?: number
  lineHeight?: number
  letterSpacing?: number
}

interface ButtonStyle {
  background?: string
  text?: string
  borderRadius?: number
}

interface DesignSystemDoc {
  name?: string
  projectSlug?: string
  colors?: {
    darkTheme?: ColorTheme
    lightTheme?: ColorTheme
  }
  typography?: {
    headingFont?: FontDefinition
    bodyFont?: FontDefinition
    h1?: Typescale
    h2?: Typescale
    h3?: Typescale
    h4?: Typescale
    bodyLarge?: Typescale
    body?: Typescale
    small?: Typescale
  }
  radius?: { small?: number; medium?: number; large?: number }
  spacing?: { xs?: number; s?: number; m?: number; l?: number; xl?: number }
  buttons?: { primary?: ButtonStyle; secondary?: ButtonStyle }
  cards?: { background?: string; border?: string }
}

function getFontName(font: FontDefinition | undefined, fallback: string): string {
  if (!font) return fallback
  if (font.source === 'google' && font.googleFont) return font.googleFont.trim()
  if (font.source === 'library' && font.libraryFont) return font.libraryFont.trim()
  return fallback
}

function getFontLabel(font: FontDefinition | undefined, fallback: string): string {
  const name = getFontName(font, fallback)
  const tag = font?.source === 'google' ? ' (Google)' : font?.source === 'library' ? ' (Library)' : ''
  return `${name}${tag}`
}

interface Props {
  document: { displayed: DesignSystemDoc }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TAB_STYLE = (active: boolean): React.CSSProperties => ({
  padding: '8px 20px',
  borderRadius: 8,
  border: 'none',
  background: active ? '#111' : 'transparent',
  color: active ? '#fff' : '#666',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s',
})

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
  color: '#999',
  marginBottom: 16,
  fontWeight: 600,
}

const TOKEN_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid #f0f0f0',
}

function TokenLabel({ label, sub }: { label: string; sub?: string }) {
  return (
    <div>
      <span style={{ fontSize: 13, color: '#111', fontWeight: 500 }}>{label}</span>
      {sub && <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>{sub}</span>}
    </div>
  )
}

function TokenValue({ value }: { value?: string | number }) {
  if (value === undefined || value === null || value === '') return (
    <span style={{ fontSize: 12, color: '#ccc', fontStyle: 'italic' }}>—</span>
  )
  return (
    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#555', background: '#f5f5f5', padding: '2px 8px', borderRadius: 4 }}>
      {value}
    </span>
  )
}

function ColorSwatch({ label, value }: { label: string; value?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: value ?? 'transparent',
        border: '1px solid rgba(0,0,0,0.08)',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{label}</div>
        {value && <div style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>{value}</div>}
      </div>
      {!value && <span style={{ fontSize: 12, color: '#ccc', fontStyle: 'italic' }}>not set</span>}
    </div>
  )
}

// ─── Preview Tab ─────────────────────────────────────────────────────────────

function pxToRem(px: number): string {
  return `${parseFloat((px / 16).toFixed(4))}rem`
}

function PreviewTab({ doc }: { doc: DesignSystemDoc }) {
  const [mode, setMode] = useState<'dark' | 'light'>('dark')
  const theme = mode === 'dark' ? doc.colors?.darkTheme : doc.colors?.lightTheme

  const bg = theme?.background ?? (mode === 'dark' ? '#1a1a2e' : '#ffffff')
  const surface = theme?.surface ?? theme?.backgroundAlt ?? (mode === 'dark' ? '#252538' : '#f3f4f6')
  const primary = theme?.primary ?? '#f59e0b'
  const text = theme?.textPrimary ?? (mode === 'dark' ? '#f0f0f0' : '#111111')
  const border = theme?.border ?? 'rgba(128,128,128,0.15)'
  const headingFont = getFontName(doc.typography?.headingFont, 'sans-serif')
  const bodyFont = getFontName(doc.typography?.bodyFont, 'sans-serif')
  const radius = doc.radius?.medium ?? 12
  const radiusLg = doc.radius?.large ?? 20

  // Inject Google Fonts into Studio so the preview renders the actual typeface
  useEffect(() => {
    const url = buildPreviewFontsUrl(headingFont, bodyFont)
    if (!url) return
    const id = 'abluo-design-system-preview-fonts'
    document.getElementById(id)?.remove()
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
    return () => { document.getElementById(id)?.remove() }
  }, [headingFont, bodyFont])

  // All Sanity-driven font sizes converted to rem — mirrors what layout.tsx outputs
  const sizeH1 = pxToRem(doc.typography?.h1?.size ?? 56)
  const sizeH2 = pxToRem(doc.typography?.h2?.size ?? 36)
  const sizeBody = pxToRem(doc.typography?.body?.size ?? 16)

  return (
    <div>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {(['dark', 'light'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding: '6px 16px', borderRadius: 8,
            border: '1px solid #e0e0e0',
            background: mode === m ? '#111' : '#fff',
            color: mode === m ? '#fff' : '#666',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>
            {m === 'dark' ? '🌙 Dark' : '☀️ Light'}
          </button>
        ))}
      </div>

      {/* Mini website mockup */}
      <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #e5e7eb', background: bg }}>

        {/* Nav */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 32px',
          borderBottom: `1px solid ${border}`,
          background: bg,
        }}>
          <div style={{ fontFamily: headingFont, fontSize: 18, fontWeight: 700, color: primary }}>
            {doc.name ?? 'Brand'}
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            {['About', 'Services', 'Contact'].map((l) => (
              <span key={l} style={{ fontSize: 13, color: text, opacity: 0.6, fontFamily: bodyFont }}>{l}</span>
            ))}
          </div>
          <div style={{
            padding: '8px 18px', borderRadius: radius,
            background: primary, color: '#fff',
            fontSize: 13, fontWeight: 600, fontFamily: bodyFont,
          }}>
            Get Started
          </div>
        </div>

        {/* Hero */}
        <div style={{ padding: '64px 32px', textAlign: 'center', borderBottom: `1px solid ${border}` }}>
          <div style={{
            display: 'inline-block', padding: '4px 14px', borderRadius: 100,
            background: `color-mix(in srgb, ${primary} 15%, transparent)`,
            color: primary, fontSize: 12, fontWeight: 600, fontFamily: bodyFont, marginBottom: 24,
          }}>
            Now in Beta
          </div>
          <h1 style={{
            fontFamily: headingFont, color: text,
            fontSize: sizeH1,
            fontWeight: doc.typography?.h1?.weight ?? 700,
            lineHeight: doc.typography?.h1?.lineHeight ?? 1.1,
            margin: '0 0 20px',
          }}>
            Your headline goes here
          </h1>
          <p style={{
            fontFamily: bodyFont, color: text, opacity: 0.6,
            fontSize: sizeBody,
            lineHeight: doc.typography?.body?.lineHeight ?? 1.6,
            margin: '0 auto 32px', maxWidth: 520,
          }}>
            A short description of what this product or service does, written in plain language.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <div style={{ padding: '12px 28px', borderRadius: radius, background: primary, color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: bodyFont }}>
              Primary Action
            </div>
            <div style={{ padding: '12px 28px', borderRadius: radius, border: `2px solid ${border}`, color: text, fontSize: 14, fontWeight: 500, fontFamily: bodyFont }}>
              Learn More
            </div>
          </div>
        </div>

        {/* Features */}
        <div style={{ padding: '48px 32px', borderBottom: `1px solid ${border}` }}>
          <h2 style={{
            fontFamily: headingFont, color: text, textAlign: 'center',
            fontSize: sizeH2,
            fontWeight: doc.typography?.h2?.weight ?? 700,
            margin: '0 0 32px',
          }}>
            Key Features
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {['Speed', 'Simplicity', 'Quality'].map((f, i) => (
              <div key={f} style={{
                background: surface, borderRadius: radiusLg,
                border: `1px solid ${border}`, padding: 24,
              }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: primary, marginBottom: 16, opacity: 0.8 + i * 0.07 }} />
                <div style={{ fontFamily: headingFont, color: text, fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{f}</div>
                <div style={{ fontFamily: bodyFont, color: text, opacity: 0.55, fontSize: 13, lineHeight: 1.6 }}>
                  Short description of this feature and why it matters to the user.
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: '48px 32px', borderBottom: `1px solid ${border}`, textAlign: 'center', background: surface }}>
          <h2 style={{
            fontFamily: headingFont, color: text,
            fontSize: sizeH2,
            fontWeight: doc.typography?.h2?.weight ?? 700,
            margin: '0 0 12px',
          }}>
            Ready to get started?
          </h2>
          <p style={{ fontFamily: bodyFont, color: text, opacity: 0.55, fontSize: 15, margin: '0 0 28px' }}>
            Join thousands of users already using this platform.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', maxWidth: 420, margin: '0 auto' }}>
            <div style={{
              flex: 1, padding: '11px 16px',
              background: `color-mix(in srgb, ${text} 8%, transparent)`,
              border: `1px solid ${border}`, borderRadius: radius,
              color: text, fontSize: 14, fontFamily: bodyFont, opacity: 0.5,
            }}>
              Enter your email
            </div>
            <div style={{ padding: '11px 22px', borderRadius: radius, background: primary, color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: bodyFont, flexShrink: 0 }}>
              Subscribe
            </div>
          </div>
        </div>

        {/* Contact form */}
        <div style={{ padding: '48px 32px' }}>
          <h2 style={{
            fontFamily: headingFont, color: text,
            fontSize: sizeH2,
            fontWeight: doc.typography?.h2?.weight ?? 700,
            margin: '0 0 24px',
          }}>
            Get in touch
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 560 }}>
            {['Name', 'Email', 'Subject', 'Message'].map((f) => (
              <div key={f} style={{ gridColumn: f === 'Message' ? 'span 2' : undefined }}>
                <div style={{ fontSize: 12, fontFamily: bodyFont, color: text, opacity: 0.5, marginBottom: 6 }}>{f}</div>
                <div style={{
                  padding: f === 'Message' ? '12px 16px' : '10px 16px',
                  height: f === 'Message' ? 72 : undefined,
                  background: `color-mix(in srgb, ${text} 6%, transparent)`,
                  border: `1px solid ${border}`, borderRadius: radius,
                }} />
              </div>
            ))}
            <div style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'inline-block', padding: '11px 28px', borderRadius: radius, background: primary, color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: bodyFont }}>
                Send Message
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Tokens Tab ───────────────────────────────────────────────────────────────

function TokensTab({ doc }: { doc: DesignSystemDoc }) {
  const typo = doc.typography
  const darkTheme = doc.colors?.darkTheme
  const lightTheme = doc.colors?.lightTheme
  const headingFont = getFontName(typo?.headingFont, '—')
  const bodyFont = getFontName(typo?.bodyFont, '—')
  const headingFontLabel = getFontLabel(typo?.headingFont, '—')
  const bodyFontLabel = getFontLabel(typo?.bodyFont, '—')

  type TypoKey = 'h1' | 'h2' | 'h3' | 'h4' | 'bodyLarge' | 'body' | 'small'
  const typescales: { label: string; key: TypoKey; fontRole: 'heading' | 'body' }[] = [
    { label: 'H1', key: 'h1', fontRole: 'heading' },
    { label: 'H2', key: 'h2', fontRole: 'heading' },
    { label: 'H3', key: 'h3', fontRole: 'heading' },
    { label: 'H4', key: 'h4', fontRole: 'heading' },
    { label: 'Body Large', key: 'bodyLarge', fontRole: 'body' },
    { label: 'Body', key: 'body', fontRole: 'body' },
    { label: 'Small Text', key: 'small', fontRole: 'body' },
  ]

  type ColorGroup = { label: string; tokens: { label: string; value?: string }[] }

  function buildColorGroups(t: typeof darkTheme): ColorGroup[] {
    return [
      {
        label: 'Surfaces',
        tokens: [
          { label: 'Background', value: t?.background },
          { label: 'Background Alt', value: t?.backgroundAlt },
          { label: 'Surface', value: t?.surface },
        ],
      },
      {
        label: 'Brand Colors',
        tokens: [
          { label: 'Primary', value: t?.primary },
          { label: 'Secondary', value: t?.secondary },
          { label: 'Accent', value: t?.accent },
        ],
      },
      {
        label: 'Text Colors',
        tokens: [
          { label: 'Text Primary', value: t?.textPrimary },
          { label: 'Text Secondary', value: t?.textSecondary },
          { label: 'Text Muted', value: t?.textMuted },
        ],
      },
      {
        label: 'Borders',
        tokens: [
          { label: 'Border', value: t?.border },
        ],
      },
      {
        label: 'Status Colors',
        tokens: [
          { label: 'Success', value: t?.success },
          { label: 'Warning', value: t?.warning },
          { label: 'Danger', value: t?.danger },
        ],
      },
    ]
  }

  const darkColorGroups = buildColorGroups(darkTheme)
  const lightColorGroups = buildColorGroups(lightTheme)

  const spacingScale = [
    { label: 'XS', value: doc.spacing?.xs },
    { label: 'S', value: doc.spacing?.s },
    { label: 'M', value: doc.spacing?.m },
    { label: 'L', value: doc.spacing?.l },
    { label: 'XL', value: doc.spacing?.xl },
  ]

  const radiusScale = [
    { label: 'Small', value: doc.radius?.small },
    { label: 'Medium', value: doc.radius?.medium },
    { label: 'Large', value: doc.radius?.large },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>

      {/* Typography */}
      <div style={{ gridColumn: 'span 2' }}>
        <p style={SECTION_LABEL}>Typography</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div style={{ flex: 1, background: '#f9fafb', borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Heading Font</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: headingFont, color: '#111' }}>{headingFont}</div>
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>{headingFontLabel}</div>
          </div>
          <div style={{ flex: 1, background: '#f9fafb', borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Body Font</div>
            <div style={{ fontSize: 16, fontFamily: bodyFont, color: '#111' }}>{bodyFont}</div>
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>{bodyFontLabel}</div>
          </div>
        </div>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr', gap: 8, padding: '8px 0', borderBottom: '2px solid #f0f0f0', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>Scale</span>
            <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>Uses</span>
            <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>Size</span>
            <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>Weight</span>
            <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>Line Height</span>
          </div>
          {typescales.map(({ label, key, fontRole }) => {
            const scale = typo?.[key] as Typescale | undefined
            const usesFont = fontRole === 'heading' ? headingFont : bodyFont
            return (
              <div key={label} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr', gap: 8, padding: '10px 0', borderBottom: '1px solid #f5f5f5', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{label}</span>
                <span style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>{usesFont}</span>
                <TokenValue value={scale?.size !== undefined ? `${scale.size}px` : undefined} />
                <TokenValue value={scale?.weight} />
                <TokenValue value={scale?.lineHeight} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Color tokens — full semantic system */}
      <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>

        {/* Dark Theme */}
        <div>
          <p style={SECTION_LABEL}>Dark Theme</p>
          {darkColorGroups.map((group) => (
            <div key={group.label} style={{ marginBottom: 24 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: '#444',
                textTransform: 'uppercase' as const, letterSpacing: '0.08em',
                marginBottom: 8, paddingBottom: 4,
                borderBottom: '1px solid #e8e8e8',
              }}>
                {group.label}
              </div>
              {group.tokens.map(({ label, value }) => (
                <ColorSwatch key={label} label={label} value={value} />
              ))}
            </div>
          ))}
        </div>

        {/* Light Theme */}
        <div>
          <p style={SECTION_LABEL}>Light Theme</p>
          {lightColorGroups.map((group) => (
            <div key={group.label} style={{ marginBottom: 24 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: '#444',
                textTransform: 'uppercase' as const, letterSpacing: '0.08em',
                marginBottom: 8, paddingBottom: 4,
                borderBottom: '1px solid #e8e8e8',
              }}>
                {group.label}
              </div>
              {group.tokens.map(({ label, value }) => (
                <ColorSwatch key={label} label={label} value={value} />
              ))}
            </div>
          ))}
        </div>

      </div>

      {/* Spacing */}
      <div>
        <p style={SECTION_LABEL}>Spacing</p>
        {spacingScale.map(({ label, value }) => (
          <div key={label} style={{ ...TOKEN_ROW, alignItems: 'center' }}>
            <TokenLabel label={label} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {value !== undefined && (
                <div style={{ height: 8, width: value, maxWidth: 120, background: '#111', borderRadius: 2, opacity: 0.15 }} />
              )}
              <TokenValue value={value !== undefined ? `${value}px` : undefined} />
            </div>
          </div>
        ))}
        <div style={{ ...TOKEN_ROW }}>
          <TokenLabel label="XXL" sub="not configured" />
          <TokenValue />
        </div>
      </div>

      {/* Radius */}
      <div>
        <p style={SECTION_LABEL}>Border Radius</p>
        {radiusScale.map(({ label, value }) => (
          <div key={label} style={TOKEN_ROW}>
            <TokenLabel label={label} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {value !== undefined && (
                <div style={{ width: 32, height: 32, background: '#e5e7eb', borderRadius: value }} />
              )}
              <TokenValue value={value !== undefined ? `${value}px` : undefined} />
            </div>
          </div>
        ))}
        <div style={TOKEN_ROW}>
          <TokenLabel label="Extra Large" sub="not configured" />
          <TokenValue />
        </div>
      </div>

      {/* Shadows — not in schema yet */}
      <div>
        <p style={SECTION_LABEL}>Shadows</p>
        {['Small', 'Medium', 'Large'].map((s) => (
          <div key={s} style={TOKEN_ROW}>
            <TokenLabel label={s} />
            <span style={{ fontSize: 12, color: '#ccc', fontStyle: 'italic' }}>not configured</span>
          </div>
        ))}
      </div>

      {/* Layout — not in schema yet */}
      <div>
        <p style={SECTION_LABEL}>Layout</p>
        {['Container Width', 'Content Width', 'Grid Columns', 'Breakpoints'].map((s) => (
          <div key={s} style={TOKEN_ROW}>
            <TokenLabel label={s} />
            <span style={{ fontSize: 12, color: '#ccc', fontStyle: 'italic' }}>not configured</span>
          </div>
        ))}
      </div>

    </div>
  )
}

// ─── Components Tab ───────────────────────────────────────────────────────────

function ComponentsTab() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '80px 32px', textAlign: 'center',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16, background: '#f5f5f5',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, marginBottom: 24,
      }}>
        🧩
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: '#111', margin: '0 0 12px' }}>
        Component Library
      </h3>
      <p style={{ fontSize: 14, color: '#888', lineHeight: 1.7, maxWidth: 360, margin: 0 }}>
        No reusable components defined yet.
        <br />
        Components such as Hero sections, FAQs, Testimonials and CTAs
        will appear here when the library is implemented.
      </p>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function DesignSystemPreview({ document: { displayed } }: Props) {
  const [tab, setTab] = useState<'preview' | 'tokens' | 'components'>('preview')

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 900 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111' }}>
            {displayed.name ?? displayed.projectSlug ?? 'Design System'}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#888' }}>
            Design system overview
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#f5f5f5', padding: 4, borderRadius: 10 }}>
          {(['preview', 'tokens', 'components'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={TAB_STYLE(tab === t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'preview' && <PreviewTab doc={displayed} />}
      {tab === 'tokens' && <TokensTab doc={displayed} />}
      {tab === 'components' && <ComponentsTab />}

    </div>
  )
}
