/**
 * Field `hintBelow`: the hint moves under the control (side-by-side toolbar
 * fields line up), keeping its aria-describedby wiring.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Field } from '../Field'

describe('Field hintBelow', () => {
  it('default: the hint sits between the label and the control', () => {
    const html = renderToStaticMarkup(<Field label="Search" hint="By name">{(p) => <input {...p} />}</Field>)
    expect(html.indexOf('By name')).toBeLessThan(html.indexOf('<input'))
  })

  it('hintBelow: the hint follows the control and still describes it', () => {
    const html = renderToStaticMarkup(
      <Field label="Search" hint="By name" hintBelow>
        {(p) => <input {...p} />}
      </Field>,
    )
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf('By name'))
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1]
    expect(describedBy).toBeTruthy()
    expect(html).toContain(`<p id="${describedBy}"`)
  })
})
