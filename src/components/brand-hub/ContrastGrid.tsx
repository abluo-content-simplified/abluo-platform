import { formatBrandHubMessage } from '@/lib/i18n/brand-hub-messages'
import type { ContrastCheck, ThemeKey } from '@/lib/modules/brand-hub/types'
import { HEADING_FONT, PassFail, Section, TD, TH, TableWrap, ValueLabel, type HubPageProps } from './shared'

const THEMES: ThemeKey[] = ['light', 'dark']

export function ContrastGrid({ model, m, locale }: HubPageProps) {
  if (model.contrast.length === 0) return null
  const fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <Section title={m.contrastTitle} id="contrast">
      <p className="mb-6 max-w-[var(--layout-max-text-width,720px)] text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {m.contrastMethod}
      </p>
      <div className="flex flex-col gap-8">
        {THEMES.map((theme) => {
          const checks = model.contrast.filter((c) => c.theme === theme)
          if (checks.length === 0) return null
          const groups = new Map<string, ContrastCheck[]>()
          for (const c of checks) groups.set(c.background, [...(groups.get(c.background) ?? []), c])
          return (
            <div key={theme}>
              <h3 className="mb-4 text-lg font-semibold" style={HEADING_FONT}>{theme === 'light' ? m.light : m.dark}</h3>
              <div className="flex flex-col gap-5">
                {[...groups.entries()].map(([bg, rows]) => (
                  <div key={bg} className="break-inside-avoid">
                    <TableWrap>
                      <table className="w-full min-w-[34rem] border-collapse">
                        <caption className="px-3 pt-3 text-left text-sm font-semibold">
                          {formatBrandHubMessage(m.contrastOn, { role: m.roles[bg as keyof typeof m.roles] })}
                        </caption>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <th scope="col" className={TH}>{m.contrastForeground}</th>
                            <th scope="col" className={TH}>{m.contrastSample}</th>
                            <th scope="col" className={TH}>{m.contrastRatio}</th>
                            <th scope="col" className={TH}>{m.normalText}</th>
                            <th scope="col" className={TH}>{m.largeText}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((c) => (
                            <tr key={`${c.foreground}-${c.background}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                              <th scope="row" className={`${TD} font-medium`}>{m.roles[c.foreground]}</th>
                              <td className={TD}>
                                <span
                                  className="inline-block px-3 py-1.5"
                                  style={{
                                    background: c.backgroundHex,
                                    color: c.foregroundHex,
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--color-border)',
                                    fontFamily: 'var(--font-body)',
                                  }}
                                >
                                  {m.contrastSample}
                                </span>
                              </td>
                              <td className={`${TD} font-mono whitespace-nowrap`}>{fmt.format(c.ratio)}:1</td>
                              <td className={TD}><PassFail pass={c.passNormal} m={m} /></td>
                              <td className={TD}><PassFail pass={c.passLarge} m={m} /></td>
                            </tr>
                          )).flatMap((row, i) => {
                            const c = rows[i]
                            if (c.suggestions.length === 0) return [row]
                            return [row, (
                              <tr key={`${c.foreground}-${c.background}-fix`}>
                                <td colSpan={5} className={`${TD} pt-0`}>
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                                    <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{m.suggestionTitle}</span>
                                    <ValueLabel source="calculated" m={m} />
                                    {c.suggestions.map((sg) => (
                                      <span key={sg.change} className="inline-flex items-center gap-2">
                                        <span
                                          className="inline-block px-3 py-1"
                                          style={{
                                            background: sg.change === 'background' ? sg.hex : c.backgroundHex,
                                            color: sg.change === 'foreground' ? sg.hex : c.foregroundHex,
                                            borderRadius: 'var(--radius-sm)',
                                            border: '1px solid var(--color-border)',
                                            fontFamily: 'var(--font-body)',
                                          }}
                                        >
                                          {m.contrastSample}
                                        </span>
                                        <span className="font-mono">
                                          {formatBrandHubMessage(sg.change === 'foreground' ? m.suggestForeground : m.suggestBackground, { hex: sg.hex, ratio: fmt.format(sg.ratio) })}
                                        </span>
                                      </span>
                                    ))}
                                    <span className="w-full text-xs">{m.suggestionNote}</span>
                                  </div>
                                </td>
                              </tr>
                            )]
                          })}
                        </tbody>
                      </table>
                    </TableWrap>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
