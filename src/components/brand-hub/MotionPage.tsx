import { DoDontGrid, MONO, RichText, Section, TD, TH, TableWrap, ValueLabel, ValueText, type HubPageProps } from './shared'

export function MotionPage({ model, m, locale }: HubPageProps) {
  const w = model.written.motion
  return (
    <>
      <RichText value={w.body} />
      <Section title={m.motionDurationsTitle}>
        <TableWrap>
          <table className="w-full min-w-[20rem] border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th scope="col" className={TH}>{m.motionDurationsTitle}</th>
                <th scope="col" className={TH}>{m.motionValue}</th>
                <th scope="col" className={TH}><span className="sr-only">{m.legendTitle}</span></th>
              </tr>
            </thead>
            <tbody>
              {model.motion.durations.map((d) => (
                <tr key={d.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <th scope="row" className={`${TD} font-medium`}>{m.motionLabels[d.key]}</th>
                  <td className={TD}><ValueText v={d.value} unit="ms" locale={locale} m={m} /></td>
                  <td className={TD}><ValueLabel source={d.value.source} m={m} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>
      <Section title={m.motionEasingsTitle}>
        <TableWrap>
          <table className="w-full min-w-[20rem] border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th scope="col" className={TH}>{m.motionEasingsTitle}</th>
                <th scope="col" className={TH}>{m.motionValue}</th>
                <th scope="col" className={TH}><span className="sr-only">{m.legendTitle}</span></th>
              </tr>
            </thead>
            <tbody>
              {model.motion.easings.map((e) => (
                <tr key={e.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <th scope="row" className={`${TD} font-medium`}>{m.motionLabels[e.key]}</th>
                  <td className={`${TD} ${MONO}`}><ValueText v={e.value} locale={locale} m={m} /></td>
                  <td className={TD}><ValueLabel source={e.value.source} m={m} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>
      <DoDontGrid items={w.doDont} m={m} />
    </>
  )
}
