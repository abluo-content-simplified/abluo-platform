import { sanityClient } from '@/lib/sanity/client'

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return null
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  }
}

function rgbToOklch(r: number, g: number, b: number): string {
  // RGB to linear
  const lr = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  const lg = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  const lb = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)

  // Linear to XYZ (D65)
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750
  const z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041

  // XYZ to LMS
  const l_ = Math.cbrt(x * 0.8189330101 + y * 0.3329415441 + z * -0.1288174949)
  const m_ = Math.cbrt(x * 0.0329845436 + y * 0.9440763681 + z * 0.1231897411)
  const s_ = Math.cbrt(x * 0.1467054338 + y * -0.3045674746 + z * 0.2413163729)

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_

  const C = Math.sqrt(a * a + b_ * b_)
  let h = (Math.atan2(b_, a) * 180) / Math.PI
  if (h < 0) h += 360

  return `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${h.toFixed(2)}deg)`
}

function hexToOklch(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return rgbToOklch(rgb.r, rgb.g, rgb.b)
}

export async function GET() {
  try {
    const query = `*[_type == "designSystem" && (name == "Abluo Base" || name == "Abluo Dental")] { _id, name, colors }`
    const systems = await sanityClient.fetch(query)

    console.log(`Found ${systems.length} design systems`)

    const mutations: any[] = []

    for (const system of systems) {
      console.log(`Converting ${system.name}...`)

      const updatedColors: any = { lightTheme: {}, darkTheme: {} }
      let hasHex = false

      if (system.colors?.lightTheme) {
        for (const [key, value] of Object.entries(system.colors.lightTheme)) {
          if (typeof value === 'string' && value.startsWith('#')) {
            hasHex = true
            const oklch = hexToOklch(value)
            updatedColors.lightTheme[key] = oklch
            console.log(`  Light.${key}: ${value} → ${oklch}`)
          } else {
            updatedColors.lightTheme[key] = value
          }
        }
      }

      if (system.colors?.darkTheme) {
        for (const [key, value] of Object.entries(system.colors.darkTheme)) {
          if (typeof value === 'string' && value.startsWith('#')) {
            hasHex = true
            const oklch = hexToOklch(value)
            updatedColors.darkTheme[key] = oklch
            console.log(`  Dark.${key}: ${value} → ${oklch}`)
          } else {
            updatedColors.darkTheme[key] = value
          }
        }
      }

      if (hasHex) {
        mutations.push({
          patch: {
            id: system._id,
            set: { colors: updatedColors },
          },
        })
      }
    }

    if (mutations.length === 0) {
      return Response.json({ message: 'No HEX colors found to convert' })
    }

    console.log(`Applying ${mutations.length} mutations...`)

    const result = await sanityClient.observable.mutate(mutations).toPromise()

    console.log('✅ All design systems updated to OKLCH')

    return Response.json({
      success: true,
      message: 'All design systems converted to OKLCH',
      systems: systems.length,
      mutations: mutations.length,
    })
  } catch (error: any) {
    console.error('Error:', error)
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
