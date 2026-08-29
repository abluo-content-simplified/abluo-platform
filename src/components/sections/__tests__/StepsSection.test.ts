import { describe, expect, it } from 'vitest'
import { stepOrdinal, resolveStepColumns, buildStepsGridCss } from '../StepsSection'

describe('stepOrdinal', () => {
  it('pads the first step to two digits', () => {
    expect(stepOrdinal(0)).toBe('01')
  })

  it('keeps two-digit ordinals unpadded', () => {
    expect(stepOrdinal(11)).toBe('12')
  })
})

describe('resolveStepColumns', () => {
  it('never uses more columns than there are steps', () => {
    expect(resolveStepColumns(1)).toBe(1)
    expect(resolveStepColumns(2)).toBe(2)
  })

  it('caps at three columns', () => {
    expect(resolveStepColumns(3)).toBe(3)
    expect(resolveStepColumns(7)).toBe(3)
  })

  it('treats an empty step list as a single column', () => {
    expect(resolveStepColumns(0)).toBe(1)
  })
})

describe('buildStepsGridCss', () => {
  it('starts single-column with no right rules and no connectors', () => {
    const css = buildStepsGridCss('scope', 3)
    // The base (mobile) block comes before any media query.
    const base = css.split('@media')[0]
    expect(base).toContain('grid-template-columns:1fr')
    expect(base).toContain('border-top:1px solid var(--color-border)')
    expect(base).not.toContain('border-right:1px solid')
    expect(base).toContain('.steps-connector{display:none;}')
  })

  it('adds a two-column breakpoint and a three-column breakpoint for three steps', () => {
    const css = buildStepsGridCss('scope', 3)
    expect(css).toContain('@media (min-width:640px)')
    expect(css).toContain('@media (min-width:1024px)')
    expect(css).toContain('repeat(2,minmax(0,1fr))')
    expect(css).toContain('repeat(3,minmax(0,1fr))')
  })

  it('stops at two columns when there are only two steps', () => {
    const css = buildStepsGridCss('scope', 2)
    expect(css).toContain('@media (min-width:640px)')
    expect(css).not.toContain('@media (min-width:1024px)')
  })

  it('emits no breakpoints at all for a single step', () => {
    expect(buildStepsGridCss('scope', 1)).not.toContain('@media')
  })

  it('drops the right rule on the last cell of every row and on the last cell overall', () => {
    const css = buildStepsGridCss('scope', 6)
    expect(css).toContain('.scope>*:nth-child(3n){border-right:none;}')
    expect(css).toContain('.scope>*:last-child{border-right:none;}')
  })

  it('hides the connector wherever the right rule is dropped', () => {
    const css = buildStepsGridCss('scope', 6)
    expect(css).toContain('.scope>*:nth-child(3n) .steps-connector{display:none;}')
    expect(css).toContain('.scope>*:last-child .steps-connector{display:none;}')
  })

  it('scopes every rule to the given class', () => {
    const css = buildStepsGridCss('steps-grid-r1', 4)
    const selectors = css.match(/\.[a-zA-Z0-9_-]+/g) ?? []
    for (const selector of selectors) {
      expect(['.steps-grid-r1', '.steps-connector']).toContain(selector)
    }
  })
})


describe('buildStepsGridCss — connector/rule visibility across breakpoints', () => {
  // Regression: at >=1024px BOTH media queries apply. The 640px block's
  // `>*:nth-child(2n)` (specificity 0,2,0) beat the 1024px block's bare `>*`
  // reset (0,1,0) regardless of order, so with 3 steps the middle cell lost
  // its right rule AND its connector arrow at 3 columns.
  it('resets at matching specificity so the 2-col hide cannot leak into 3-col', () => {
    const css = buildStepsGridCss('sc', 3)
    const lg = css.slice(css.indexOf('@media (min-width:1024px)'))
    expect(lg).toContain('.sc>*:nth-child(n){border-right:1px solid var(--color-border);}')
    expect(lg).toContain('.sc>*:nth-child(n) .steps-connector{display:flex;}')
    // and only the row-final cell is hidden at 3 columns
    expect(lg).toContain('.sc>*:nth-child(3n) .steps-connector{display:none;}')
  })

  it('still hides the connector on the last cell of each row', () => {
    const css = buildStepsGridCss('sc', 3)
    expect(css).toContain('.sc>*:last-child .steps-connector{display:none;}')
  })
})
