import { CARD_STYLE, DoDontGrid, RichText, type HubPageProps } from './shared'

/** Voice and content — written guidance only (nothing here comes from the design system). */
export function VoicePage({ model, m }: HubPageProps) {
  const w = model.written.voice
  if (!w.body && w.doDont.length === 0) {
    return <p className="p-5 text-sm" style={{ ...CARD_STYLE, color: 'var(--color-text-secondary)' }}>{m.notWritten}</p>
  }
  return (
    <>
      <RichText value={w.body} />
      <DoDontGrid items={w.doDont} m={m} />
    </>
  )
}
