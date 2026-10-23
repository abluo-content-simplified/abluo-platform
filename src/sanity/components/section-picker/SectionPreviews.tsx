/**
 * Section previews — the sketches on each card of the "Add section" picker.
 *
 * Same drawing rules as SectionWireframes.tsx, at picker size:
 *   - `currentColor` only, so they read in the Studio's light and dark themes.
 *   - Three levels of emphasis: 1 for structure and buttons, ~0.55 for
 *     headings, ~0.25 for body copy; images are a ~0.12 fill.
 *   - Schematic, not literal: they show the LAYOUT (columns, cards, where the
 *     map or the image sits), never a tenant's design.
 *   - One 120×80 canvas (3:2), 10 units of margin.
 *
 * Every section type in the catalogue needs one — a test enforces it.
 */
import type { ReactNode } from 'react'

const HEAD = 0.55
const BODY = 0.25
const FILL = 0.12
const RULE = 0.3

// ── primitives ────────────────────────────────────────────────────────────────

const Eyebrow = ({ x, y, w = 16 }: { x: number; y: number; w?: number }) => (
  <rect x={x} y={y} width={w} height={2} rx={1} fill="currentColor" opacity={HEAD} />
)
const Head = ({ x, y, w, h = 5 }: { x: number; y: number; w: number; h?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx={1} fill="currentColor" opacity={HEAD} />
)
/** `n` lines of body copy; the last one shorter. */
const Lines = ({ x, y, w, n = 2, gap = 4 }: { x: number; y: number; w: number; n?: number; gap?: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <rect key={i} x={x} y={y + i * gap} width={i === n - 1 && n > 1 ? w * 0.7 : w} height={2} rx={1} fill="currentColor" opacity={BODY} />
    ))}
  </>
)
const Btn = ({ x, y, w = 20, outline = false }: { x: number; y: number; w?: number; outline?: boolean }) =>
  outline ? (
    <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={6} rx={3} fill="none" stroke="currentColor" strokeWidth={1} />
  ) : (
    <rect x={x} y={y} width={w} height={7} rx={3.5} fill="currentColor" />
  )
const Img = ({ x, y, w, h, rx = 2 }: { x: number; y: number; w: number; h: number; rx?: number }) => {
  const s = Math.min(w, h) / 5
  const cx = x + w / 2
  const cy = y + h / 2
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="currentColor" opacity={FILL} />
      <path d={`M${cx - s} ${cy + s * 0.6} L${cx - s * 0.2} ${cy - s * 0.4} L${cx + s * 0.3} ${cy + s * 0.2} L${cx + s * 0.6} ${cy - s * 0.1} L${cx + s} ${cy + s * 0.6} Z`} fill="currentColor" opacity={BODY} />
      <circle cx={cx + s * 0.55} cy={cy - s * 0.65} r={s * 0.2} fill="currentColor" opacity={BODY} />
    </>
  )
}
const Box = ({ x, y, w, h, rx = 2 }: { x: number; y: number; w: number; h: number; rx?: number }) => (
  <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={rx} fill="none" stroke="currentColor" strokeWidth={1} opacity={RULE} />
)
const Rule = ({ x1, x2, y }: { x1: number; x2: number; y: number }) => (
  <line x1={x1} x2={x2} y1={y} y2={y} stroke="currentColor" strokeWidth={1} opacity={RULE} />
)
const Pin = ({ cx, cy, s = 1 }: { cx: number; cy: number; s?: number }) => (
  <g transform={`translate(${cx} ${cy}) scale(${s})`}>
    <path d="M0 0 C-4 -5 -5 -7 -5 -9.5 A5 5 0 1 1 5 -9.5 C5 -7 4 -5 0 0 Z" fill="currentColor" />
    <circle cx={0} cy={-9.5} r={1.8} fill="var(--card-bg-color, #fff)" />
  </g>
)
/** A map tile: faint fill, a few "roads", a pin. */
const MapTile = ({ x, y, w, h, pin = 1 }: { x: number; y: number; w: number; h: number; pin?: number }) => (
  <>
    <rect x={x} y={y} width={w} height={h} rx={2} fill="currentColor" opacity={FILL} />
    <path d={`M${x} ${y + h * 0.65} L${x + w} ${y + h * 0.35}`} stroke="currentColor" strokeWidth={1.5} opacity={BODY} />
    <path d={`M${x + w * 0.3} ${y} L${x + w * 0.42} ${y + h}`} stroke="currentColor" strokeWidth={1} opacity={BODY} />
    <path d={`M${x + w * 0.7} ${y} L${x + w * 0.62} ${y + h}`} stroke="currentColor" strokeWidth={1} opacity={0.18} />
    <Pin cx={x + w * 0.52} cy={y + h * 0.58} s={pin} />
  </>
)
const Phone = ({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => (
  <>
    <rect x={x} y={y} width={w} height={h} rx={2.5} fill="var(--card-bg-color, #fff)" stroke="currentColor" strokeWidth={1.2} />
    <rect x={x + 2} y={y + 3} width={w - 4} height={h - 6} rx={1} fill="currentColor" opacity={FILL + 0.06} />
  </>
)
/** Section title block: eyebrow + heading, left or centred. */
const Title = ({ center = false, y = 10, w = 50 }: { center?: boolean; y?: number; w?: number }) => {
  const x = center ? 60 - w / 2 : 10
  return (
    <>
      <Eyebrow x={center ? 52 : 10} y={y} />
      <Head x={x} y={y + 5} w={w} />
    </>
  )
}

// ── sketches ──────────────────────────────────────────────────────────────────

export const SECTION_PREVIEWS: Record<string, () => ReactNode> = {
  heroSection: () => (
    <>
      <Eyebrow x={10} y={18} />
      <Head x={10} y={23} w={58} h={6} />
      <Head x={10} y={32} w={44} h={6} />
      <Lines x={10} y={44} w={52} n={2} />
      <Btn x={10} y={57} w={22} />
      <Btn x={35} y={57} w={22} outline />
      <Img x={76} y={12} w={34} h={56} />
    </>
  ),
  heroLensSection: () => (
    <>
      <Eyebrow x={10} y={20} />
      <Head x={10} y={25} w={50} h={6} />
      <Head x={10} y={34} w={38} h={6} />
      <Lines x={10} y={46} w={46} n={2} />
      <Btn x={10} y={58} w={22} />
      <circle cx={90} cy={40} r={22} fill="currentColor" opacity={FILL} />
      <Phone x={84} y={26} w={14} h={28} />
    </>
  ),
  heroLiveCaptureSection: () => (
    <>
      <rect x={0} y={0} width={120} height={80} fill="currentColor" opacity={FILL} />
      <Eyebrow x={10} y={20} />
      <Head x={10} y={25} w={52} h={6} />
      <Head x={10} y={34} w={40} h={6} />
      <Lines x={10} y={46} w={46} n={2} />
      <Btn x={10} y={58} w={22} />
      <Phone x={84} y={14} w={20} h={40} />
      <circle cx={89} cy={20} r={1.8} fill="currentColor" />
    </>
  ),
  textSection: () => (
    <>
      <Title />
      <Lines x={10} y={27} w={100} n={7} gap={5} />
    </>
  ),
  statementSection: () => (
    <>
      <Eyebrow x={52} y={22} />
      <Head x={16} y={29} w={88} h={7} />
      <Head x={26} y={39} w={68} h={7} />
      <Lines x={36} y={53} w={48} n={1} />
    </>
  ),
  contentSection: () => (
    <>
      <Img x={10} y={12} w={46} h={56} />
      <Eyebrow x={64} y={20} />
      <Head x={64} y={25} w={40} />
      <Lines x={64} y={35} w={46} n={4} />
      <Btn x={64} y={55} w={22} />
    </>
  ),
  mediaFeatureSection: () => (
    <>
      <Img x={10} y={12} w={44} h={56} />
      <Head x={62} y={12} w={38} />
      {[24, 38, 52].map((y) => (
        <g key={y}>
          <rect x={62} y={y} width={7} height={7} rx={1.5} fill="currentColor" opacity={HEAD} />
          <rect x={73} y={y} width={26} height={3} rx={1} fill="currentColor" opacity={HEAD} />
          <rect x={73} y={y + 5} width={34} height={2} rx={1} fill="currentColor" opacity={BODY} />
        </g>
      ))}
    </>
  ),
  videoSection: () => (
    <>
      <rect x={10} y={10} width={100} height={60} rx={2} fill="currentColor" opacity={FILL} />
      <circle cx={60} cy={40} r={10} fill="currentColor" />
      <path d="M57 34.5 L65.5 40 L57 45.5 Z" fill="var(--card-bg-color, #fff)" />
    </>
  ),
  treatmentsSection: () => (
    <>
      <Title />
      {[10, 46, 82].map((x) => (
        <g key={x}>
          <Box x={x} y={28} w={30} h={42} />
          <rect x={x + 4} y={33} width={18} height={3} rx={1} fill="currentColor" opacity={HEAD} />
          <rect x={x + 4} y={39} width={14} height={2} rx={1} fill="currentColor" opacity={HEAD} />
          <Lines x={x + 4} y={46} w={22} n={3} />
        </g>
      ))}
    </>
  ),
  featureGridSection: () => (
    <>
      <Title />
      {[0, 1].map((r) =>
        [10, 46, 82].map((x) => (
          <g key={`${r}-${x}`}>
            <Box x={x} y={28 + r * 22} w={30} h={19} />
            <rect x={x + 3.5} y={31.5 + r * 22} width={5} height={5} rx={1} fill="none" stroke="currentColor" strokeWidth={1} />
            <rect x={x + 3.5} y={39 + r * 22} width={16} height={2} rx={1} fill="currentColor" opacity={HEAD} />
            <rect x={x + 3.5} y={43 + r * 22} width={21} height={1.5} rx={0.75} fill="currentColor" opacity={BODY} />
          </g>
        )),
      )}
    </>
  ),
  stepsSection: () => (
    <>
      <Title />
      <Rule x1={18} x2={102} y={37} />
      {[18, 46, 74, 102].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={37} r={5} fill="var(--card-bg-color, #fff)" stroke="currentColor" strokeWidth={1.2} />
          <rect x={cx - 9} y={47} width={18} height={2.5} rx={1} fill="currentColor" opacity={HEAD} />
          <rect x={cx - 10} y={52} width={20} height={2} rx={1} fill="currentColor" opacity={BODY} />
          <rect x={cx - 7} y={56} width={14} height={2} rx={1} fill="currentColor" opacity={BODY} />
        </g>
      ))}
      <Btn x={49} y={65} w={22} outline />
    </>
  ),
  categoryListSection: () => (
    <>
      <Title />
      <Btn x={88} y={13} w={22} outline />
      {[28, 38, 48].map((y) => (
        <g key={y}>
          <rect x={10} y={y} width={36} height={3} rx={1} fill="currentColor" opacity={HEAD} />
          <path d={`M104 ${y - 0.5} L107 ${y + 1.5} L104 ${y + 3.5}`} stroke="currentColor" fill="none" strokeWidth={1} />
          <Rule x1={10} x2={110} y={y + 7} />
        </g>
      ))}
      <rect x={10} y={60} width={100} height={11} rx={2} fill="currentColor" opacity={FILL} />
      <rect x={14} y={64.5} width={40} height={2} rx={1} fill="currentColor" opacity={HEAD} />
      <Btn x={88} y={62} w={18} />
    </>
  ),
  teamSection: () => (
    <>
      <Title center />
      {[22, 47, 72, 97].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={42} r={9} fill="currentColor" opacity={FILL + 0.04} />
          <rect x={cx - 8} y={56} width={16} height={2.5} rx={1} fill="currentColor" opacity={HEAD} />
          <rect x={cx - 6} y={61} width={12} height={2} rx={1} fill="currentColor" opacity={BODY} />
        </g>
      ))}
    </>
  ),
  metricsSection: () => (
    <>
      <Title />
      {[10, 36, 62, 88].map((x, i) => (
        <g key={x}>
          {i > 0 && <line x1={x - 4} x2={x - 4} y1={36} y2={60} stroke="currentColor" opacity={RULE} />}
          <rect x={x} y={38} width={18} height={10} rx={1.5} fill="currentColor" opacity={0.75} />
          <rect x={x} y={53} width={20} height={2} rx={1} fill="currentColor" opacity={BODY} />
        </g>
      ))}
    </>
  ),
  blogListingSection: () => (
    <>
      <Title />
      {[10, 46, 82].map((x) => (
        <g key={x}>
          <Img x={x} y={28} w={28} h={20} />
          <rect x={x} y={52} width={24} height={3} rx={1} fill="currentColor" opacity={HEAD} />
          <Lines x={x} y={58} w={28} n={2} />
        </g>
      ))}
    </>
  ),
  eventsListingSection: () => (
    <>
      <Title />
      {[28, 43, 58].map((y) => (
        <g key={y}>
          <Box x={10} y={y} w={11} h={11} />
          <rect x={13} y={y + 4} width={5} height={3} rx={0.5} fill="currentColor" opacity={HEAD} />
          <rect x={27} y={y + 1.5} width={44} height={3} rx={1} fill="currentColor" opacity={HEAD} />
          <rect x={27} y={y + 7} width={30} height={2} rx={1} fill="currentColor" opacity={BODY} />
          <Btn x={92} y={y + 2} w={18} outline />
        </g>
      ))}
    </>
  ),
  liveLatestSection: () => (
    <>
      <Img x={10} y={12} w={58} h={56} />
      <rect x={14} y={16} width={16} height={6} rx={3} fill="currentColor" />
      <circle cx={18} cy={19} r={1.4} fill="var(--card-bg-color, #fff)" />
      <Eyebrow x={76} y={22} />
      <Head x={76} y={27} w={34} />
      <Lines x={76} y={37} w={34} n={3} />
      <Btn x={76} y={54} w={24} />
    </>
  ),
  photoGallerySection: () => (
    <>
      <rect x={10} y={11} width={16} height={2.5} rx={1} fill="currentColor" opacity={HEAD} />
      <rect x={10} y={15.5} width={16} height={1} fill="currentColor" />
      <rect x={31} y={11} width={14} height={2.5} rx={1} fill="currentColor" opacity={BODY} />
      <rect x={50} y={11} width={14} height={2.5} rx={1} fill="currentColor" opacity={BODY} />
      <Img x={10} y={22} w={62} h={48} />
      <Img x={75} y={22} w={35} h={22.5} />
      <Img x={75} y={47.5} w={35} h={22.5} />
    </>
  ),
  faqSection: () => (
    <>
      <Title />
      {[28, 39, 50, 61].map((y, i) => (
        <g key={y}>
          <rect x={10} y={y} width={i === 0 ? 60 : 50 + i * 4} height={3} rx={1} fill="currentColor" opacity={HEAD} />
          <path d={`M104 ${y + 1.5} H110 M107 ${y - 1.5} V${y + 4.5}`} stroke="currentColor" strokeWidth={1.2} />
          <Rule x1={10} x2={110} y={y + 7.5} />
        </g>
      ))}
    </>
  ),
  catalogueListingSection: () => (
    <>
      <Title />
      {[10, 64].map((x) =>
        [30, 41, 52, 63].map((y) => (
          <g key={`${x}-${y}`}>
            <rect x={x} y={y} width={18} height={3} rx={1} fill="currentColor" opacity={HEAD} />
            <line x1={x + 21} x2={x + 37} y1={y + 2.5} y2={y + 2.5} stroke="currentColor" strokeDasharray="1 2" opacity={RULE} />
            <rect x={x + 39} y={y} width={7} height={3} rx={1} fill="currentColor" opacity={0.75} />
            <rect x={x} y={y + 5} width={26} height={1.5} rx={0.75} fill="currentColor" opacity={BODY} />
          </g>
        )),
      )}
    </>
  ),
  contactSection: () => (
    <>
      <Head x={10} y={12} w={36} />
      {[26, 35, 44].map((y) => (
        <g key={y}>
          <circle cx={12.5} cy={y + 1.5} r={2.5} fill="currentColor" opacity={HEAD} />
          <rect x={18} y={y} width={30} height={3} rx={1} fill="currentColor" opacity={BODY + 0.1} />
        </g>
      ))}
      <Btn x={10} y={58} w={28} />
      <MapTile x={60} y={12} w={50} h={56} />
    </>
  ),
  locationsSection: () => (
    <>
      <Title />
      {[10, 62].map((x) => (
        <g key={x}>
          <Box x={x} y={27} w={48} h={45} />
          <MapTile x={x + 3} y={30} w={42} h={20} pin={0.7} />
          <rect x={x + 4} y={54} width={26} height={3} rx={1} fill="currentColor" opacity={HEAD} />
          <rect x={x + 4} y={60} width={34} height={2} rx={1} fill="currentColor" opacity={BODY} />
          <rect x={x + 4} y={65} width={20} height={2} rx={1} fill="currentColor" opacity={0.75} />
        </g>
      ))}
    </>
  ),
  formSection: () => (
    <>
      <Title />
      <Box x={10} y={27} w={48} h={9} />
      <Box x={62} y={27} w={48} h={9} />
      <Box x={10} y={40} w={100} h={9} />
      <Box x={10} y={53} w={100} h={9} />
      <Btn x={10} y={66} w={24} />
    </>
  ),
  formOverlayButtonSection: () => (
    <>
      <Lines x={10} y={14} w={60} n={3} gap={5} />
      <Btn x={10} y={34} w={30} />
      <rect x={62} y={8} width={50} height={64} rx={3} fill="var(--card-bg-color, #fff)" stroke="currentColor" strokeWidth={1} opacity={1} />
      <rect x={67} y={14} width={26} height={3} rx={1} fill="currentColor" opacity={HEAD} />
      <Box x={67} y={22} w={40} h={8} />
      <Box x={67} y={34} w={40} h={8} />
      <Box x={67} y={46} w={40} h={12} />
      <Btn x={67} y={62} w={18} />
      <path d="M44 37 L52 25" stroke="currentColor" strokeWidth={1} strokeDasharray="2 2" opacity={HEAD} />
    </>
  ),
  ctaBannerSection: () => (
    <>
      <rect x={10} y={12} width={100} height={56} rx={4} fill="currentColor" opacity={FILL} />
      <Eyebrow x={52} y={22} />
      <Head x={26} y={28} w={68} h={6} />
      <Head x={36} y={37} w={48} h={6} />
      <Btn x={36} y={51} w={22} />
      <Btn x={62} y={51} w={22} outline />
    </>
  ),
  ventureListSection: () => (
    <>
      <Title />
      {[28, 41, 54].map((y) => (
        <g key={y}>
          <rect x={10} y={y} width={40} height={3.5} rx={1} fill="currentColor" opacity={HEAD} />
          <rect x={10} y={y + 6} width={26} height={2} rx={1} fill="currentColor" opacity={BODY} />
          <rect x={92} y={y} width={18} height={4} rx={2} fill="currentColor" />
          <Rule x1={10} x2={110} y={y + 11} />
        </g>
      ))}
    </>
  ),
  clientsFlowSection: () => {
    const rows: Array<[number, number[]]> = [
      [26, [22, 14, 26, 18]],
      [38, [16, 28, 12, 22]],
      [50, [26, 18, 20, 14]],
      [62, [18, 24]],
    ]
    return (
      <>
        {rows.map(([y, widths]) => {
          let x = 10
          return (
            <g key={y}>
              {widths.map((w, i) => {
                const el = (
                  <g key={i}>
                    <rect x={x} y={y} width={w} height={5} rx={1} fill="currentColor" opacity={HEAD} />
                    {i < widths.length - 1 && <line x1={x + w + 2} x2={x + w + 4} y1={y + 5} y2={y} stroke="currentColor" />}
                  </g>
                )
                x += w + 6
                return el
              })}
            </g>
          )
        })}
        <Eyebrow x={10} y={14} />
      </>
    )
  },
  careerTimelineSection: () => (
    <>
      <Title />
      {[28, 42, 56].map((y) => (
        <g key={y}>
          <rect x={10} y={y} width={18} height={2.5} rx={1} fill="currentColor" opacity={BODY + 0.1} />
          <circle cx={38} cy={y + 1.5} r={2} fill="currentColor" />
          <rect x={46} y={y} width={36} height={3} rx={1} fill="currentColor" opacity={HEAD} />
          <rect x={46} y={y + 5} width={50} height={2} rx={1} fill="currentColor" opacity={BODY} />
        </g>
      ))}
      <line x1={38} x2={38} y1={29} y2={68} stroke="currentColor" opacity={RULE} />
    </>
  ),
}

/** The sketch for a section type, at any width (3:2). Falls back to a blank frame. */
export function SectionPreview({ type }: { type: string }) {
  const draw = SECTION_PREVIEWS[type]
  return (
    <svg viewBox="0 0 120 80" width="100%" style={{ display: 'block' }} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {draw ? draw() : <Lines x={10} y={30} w={100} n={4} gap={6} />}
    </svg>
  )
}
