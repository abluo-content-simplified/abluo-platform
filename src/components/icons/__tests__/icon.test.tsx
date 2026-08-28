import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Icon } from '../Icon'
import { ICONS, ICON_KEYS, ICON_OPTIONS, isIconName } from '../registry'

// Recursively collect every prop value on an element tree, so a colour
// smuggled into a nested <path fill="#fff"> is caught as well as one on the
// root <svg>.
function collectPropValues(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectPropValues(child, out))
    return out
  }
  if (!isValidElement(node)) return out

  const props = (node as ReactElement<Record<string, unknown>>).props
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children') {
      collectPropValues(value, out)
      continue
    }
    if (typeof value === 'string') out.push(value)
  }
  return out
}

describe('ICONS registry', () => {
  it('registers at least 24 icons', () => {
    expect(ICON_KEYS.length).toBeGreaterThanOrEqual(24)
  })

  it('resolves every key in ICON_KEYS to an element', () => {
    for (const key of ICON_KEYS) {
      expect(isValidElement(ICONS[key]), `missing icon: ${key}`).toBe(true)
    }
  })

  it('uses a 24x24 viewBox, currentColor stroke and no fill on every root svg', () => {
    for (const key of ICON_KEYS) {
      const props = (ICONS[key] as ReactElement<Record<string, unknown>>).props
      expect(ICONS[key].type, `${key} is not an svg`).toBe('svg')
      expect(props.viewBox, `${key} viewBox`).toBe('0 0 24 24')
      expect(props.stroke, `${key} stroke`).toBe('currentColor')
      expect(props.fill, `${key} fill`).toBe('none')
      expect(props.strokeWidth, `${key} strokeWidth`).toBe(1.5)
    }
  })

  it('contains no hardcoded colours', () => {
    for (const key of ICON_KEYS) {
      for (const value of collectPropValues(ICONS[key])) {
        expect(value, `${key} has a hardcoded colour: ${value}`).not.toMatch(
          /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/,
        )
      }
    }
  })

  it('uses neutral kebab-case keys', () => {
    for (const key of ICON_KEYS) {
      expect(key, `${key} is not kebab-case`).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
    }
  })
})

describe('ICON_OPTIONS', () => {
  it('has one option per icon key, in the same order', () => {
    expect(ICON_OPTIONS.map((option) => option.value)).toEqual(ICON_KEYS)
  })

  it('gives every option a non-empty title', () => {
    for (const option of ICON_OPTIONS) {
      expect(option.title.length).toBeGreaterThan(0)
    }
  })
})

describe('isIconName', () => {
  it('accepts registered keys and rejects anything else', () => {
    expect(isIconName(ICON_KEYS[0])).toBe(true)
    expect(isIconName('definitely-not-an-icon')).toBe(false)
    expect(isIconName(undefined)).toBe(false)
    expect(isIconName(42)).toBe(false)
  })
})

describe('Icon', () => {
  it('renders an element for every registered key', () => {
    for (const key of ICON_KEYS) {
      const rendered = Icon({ name: key })
      expect(isValidElement(rendered), `Icon did not render: ${key}`).toBe(true)
    }
  })

  it('returns null for an unknown key instead of throwing', () => {
    expect(Icon({ name: 'not-a-real-icon' })).toBeNull()
    expect(Icon({ name: '' })).toBeNull()
    // Prototype keys must not resolve to an icon.
    expect(Icon({ name: 'toString' })).toBeNull()
  })

  it('is decorative by default', () => {
    const rendered = Icon({ name: 'check' }) as ReactElement<Record<string, unknown>>
    expect(rendered.props['aria-hidden']).toBe('true')
    expect(rendered.props.focusable).toBe('false')
    expect(rendered.props.role).toBeUndefined()
  })

  it('becomes an img with a <title> when a title is given', () => {
    const rendered = Icon({ name: 'check', title: 'Included' }) as ReactElement<
      Record<string, unknown>
    >
    expect(rendered.props.role).toBe('img')
    expect(rendered.props['aria-label']).toBe('Included')
    expect(rendered.props['aria-hidden']).toBeUndefined()
    const titles = collectPropValues(rendered.props.children)
    expect(titles).toContain('Included')
  })

  it('defaults to 24px and honours an explicit size', () => {
    const base = Icon({ name: 'check' }) as ReactElement<Record<string, unknown>>
    expect(base.props.width).toBe(24)
    expect(base.props.height).toBe(24)

    const large = Icon({ name: 'check', size: 40 }) as ReactElement<Record<string, unknown>>
    expect(large.props.width).toBe(40)
    expect(large.props.height).toBe(40)
  })
})
