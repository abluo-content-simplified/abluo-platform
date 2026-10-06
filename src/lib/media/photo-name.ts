/**
 * A photo's starting name, from its file name: the extension goes, separators
 * become spaces ("summer_party-02.jpg" → "summer party 02"). Names a camera
 * or phone made up (IMG_1234, PXL_20240101_…, DSC01234, image.jpg, a long
 * number or hash) carry no meaning, so they give '' and the card shows a
 * placeholder instead. Pure — used on the server at upload and in tests.
 */
const CAMERA: RegExp[] = [
  /^img[\s_-]?\d+/i, // iPhone / many Android: IMG_1234, IMG-20240101-WA0001
  /^img[\s_-]?e?\d+/i, // IMG_E1234 (edited iPhone)
  /^pxl[\s_-]?\d+/i, // Pixel
  /^dsc[fn]?[\s_-]?\d+/i, // Sony / Nikon: DSC01234, DSCF1234, DSCN1234
  /^_?dsc\d+/i,
  /^p\d{6,}/i, // Olympus / Panasonic P1010001
  /^dji[\s_-]?\d+/i,
  /^gopr\d+/i,
  /^mvimg[\s_-]?\d+/i,
  /^photo[\s_-]?\d+/i,
  /^screenshot[\s_-]?\d/i,
  /^whatsapp[\s_-]image/i,
  /^(image|photo|picture|img|foto|bild|immagine)[\s_-]*\d*$/i,
  /^\d[\d\s_-]*$/, // 20240101_123456, 1234567890
  /^[0-9a-f]{8}-[0-9a-f]{4}-/i, // UUIDs
  /^[0-9a-f]{16,}$/i, // hashes
]

export function photoNameFromFile(fileName: string | null | undefined): string {
  const raw = (fileName ?? '').split(/[\\/]/).pop() ?? ''
  const stem = raw.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim()
  if (!stem || CAMERA.some((re) => re.test(stem))) return ''
  return stem
    .replace(/[_]+/g, ' ')
    .replace(/(?<=\S)-(?=\S)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}
