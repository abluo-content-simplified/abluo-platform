/** The one question per screen (ADR-025 spec): H1 + muted helper. */
export function StepHeading({ id, title, helper }: { id: string; title: string; helper?: string }) {
  return (
    <>
      <h1 id={id} className="text-[30px] leading-9 font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      {helper ? <p className="mt-3 text-[17px] leading-7 text-muted-foreground">{helper}</p> : null}
    </>
  )
}

/** Language name in the viewer's interface language ("de" → "German"). */
export function languageName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}
