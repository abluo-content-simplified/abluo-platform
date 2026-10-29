// PLACEHOLDER app icons for the installable dashboards (client + admin).
// There is no Abluo logo yet (being designed). Replace PLACEHOLDER_SVG below
// (or point it at the real logo SVG) and re-run:  node scripts/make-app-icons.mjs
// Output: public/dashboard/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const out = process.env.ICON_OUT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'dashboard')
mkdirSync(out, { recursive: true })

const BG = '#f4f3f0'
const FG = '#1c1c1e'

// `pad` = fraction of the canvas kept free around the glyph (maskable needs a safe zone).
// `radius` = 0 for full-bleed icons (maskable, apple-touch: the OS rounds them).
// The lowercase "a" is drawn as shapes (a ring + a stem), not text, so the result
// does not depend on which fonts are installed on the machine running the script.
const svg = ({ pad, radius }) => {
  const g = 512 * (1 - pad * 2) // glyph box
  const o = 512 * pad
  const sw = g * 0.13 // stroke
  const r = g * 0.3 // ring radius (centre-line)
  const cx = o + g * 0.42
  const cy = o + g * 0.62
  const stemX = cx + r
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${BG}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${FG}" stroke-width="${sw}"/>
  <path d="M${stemX} ${cy - r - g * 0.04} V${cy + r}" stroke="${FG}" stroke-width="${sw}" stroke-linecap="round" fill="none"/>
</svg>`
}

const render = async (name, size, opts) =>
  sharp(Buffer.from(svg(opts))).resize(size, size).png().toFile(join(out, name))

await render('icon-192.png', 192, { pad: 0.16, radius: 112 })
await render('icon-512.png', 512, { pad: 0.16, radius: 112 })
await render('icon-maskable-512.png', 512, { pad: 0.3, radius: 0 })
await render('apple-touch-icon.png', 180, { pad: 0.16, radius: 0 })
console.log('wrote placeholder icons to', out)
