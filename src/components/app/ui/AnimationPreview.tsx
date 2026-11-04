'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Plays a Lottie animation (`.lottie` or `.json`, ADR-046) in a box — the
 * Media Library tile, table cell and photo panel, and the Lab.
 *
 * - `play="hover"` (default): a still frame; plays while the pointer is over it.
 *   `play="loop"`: plays on its own, looping — unless the visitor asked their
 *   system for reduced motion, then it stays still.
 * - Loads only when it scrolls near the screen, and stops drawing off screen.
 * - The player is the open-source dotLottie web player, loaded on first use;
 *   its WebAssembly file is served by Abluo itself (`/vendor/dotlottie/…`),
 *   never from a CDN.
 * - Language-agnostic: the accessible name comes in as `label`; `label={null}`
 *   marks it decorative (hidden from screen readers).
 * - `colors` sets the animation's named colour slots (e.g. the brand colour).
 */

/** Must match the installed `@lottiefiles/dotlottie-web` version (animation-preview.test.ts checks it). */
export const DOTLOTTIE_VERSION = '0.81.0'
export const DOTLOTTIE_WASM_URL = `/vendor/dotlottie/${DOTLOTTIE_VERSION}/dotlottie-player.wasm`

type Player = {
  play(): void
  pause(): void
  setFrame(frame: number): void
  setColorSlot(slotId: string, value: number[]): boolean
  destroy(): void
  readonly totalFrames: number
  addEventListener(type: 'load' | 'loadError', listener: () => void): void
}

let wasmSet = false

export type AnimationPreviewProps = {
  /** URL of the animation file. */
  src?: string | null
  /** Or the animation itself (Lottie JSON as text / object). */
  data?: string | Record<string, unknown> | null
  /** Accessible name; null = decorative. */
  label: string | null
  play?: 'hover' | 'loop'
  /** Which frame shows while still. Default: the middle (a drawn-on animation is empty at its first frame). */
  still?: 'first' | 'middle' | 'last'
  /** Named colour slots, e.g. `{ accent: [0.1, 0.4, 0.9, 1] }` (RGBA 0–1; `hexToLottieColor`). */
  colors?: Record<string, number[]>
  /** Shown when the file cannot be played. */
  fallback?: ReactNode
  className?: string
}

export function AnimationPreview({ src, data, label, play = 'hover', still = 'middle', colors, fallback = null, className = '' }: AnimationPreviewProps) {
  const boxRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerRef = useRef<Player | null>(null)
  // Without IntersectionObserver (old browsers, tests) it loads at once. Only effects read `near`, so server and client render the same.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const [state, setState] = useState<'idle' | 'ready' | 'failed'>('idle')

  // Load only near the screen.
  useEffect(() => {
    const el = boxRef.current
    if (!el || near) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  const colorsKey = colors ? JSON.stringify(colors) : ''
  useEffect(() => {
    const canvas = canvasRef.current
    if (!near || !canvas || (!src && !data)) return
    let alive = true
    let player: Player | null = null
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const autoplay = play === 'loop' && !reduce
    void import('@lottiefiles/dotlottie-web')
      .then(({ DotLottie }) => {
        if (!alive) return
        if (!wasmSet) {
          DotLottie.setWasmUrl(DOTLOTTIE_WASM_URL)
          wasmSet = true
        }
        player = new DotLottie({
          canvas,
          ...(data ? { data } : { src: src ?? undefined }),
          autoplay,
          loop: true,
          renderConfig: { autoResize: true, freezeOnOffscreen: true },
        }) as unknown as Player
        playerRef.current = player
        player.addEventListener('load', () => {
          if (!alive || !player) return
          if (colorsKey) for (const [id, rgba] of Object.entries(JSON.parse(colorsKey) as Record<string, number[]>)) player.setColorSlot(id, rgba)
          if (!autoplay) player.setFrame(stillFrame(player.totalFrames, still))
          setState('ready')
        })
        player.addEventListener('loadError', () => alive && setState('failed'))
      })
      .catch(() => alive && setState('failed'))
    return () => {
      alive = false
      playerRef.current = null
      player?.destroy()
    }
  }, [near, src, data, play, still, colorsKey])

  const hover = play === 'hover' && state === 'ready'
  return (
    <span
      ref={boxRef}
      role={label ? 'img' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      data-state={state}
      className={`relative block overflow-hidden ${className}`}
      onPointerEnter={hover ? () => playerRef.current?.play() : undefined}
      onPointerLeave={
        hover
          ? () => {
              const p = playerRef.current
              if (!p) return
              p.pause()
              p.setFrame(stillFrame(p.totalFrames, still))
            }
          : undefined
      }
    >
      {state === 'failed' ? fallback : null}
      <canvas ref={canvasRef} className={`block size-full ${state === 'failed' ? 'hidden' : ''}`} />
    </span>
  )
}

/** The still frame's number. Pure (exported for tests). */
export function stillFrame(total: number, still: 'first' | 'middle' | 'last'): number {
  if (!Number.isFinite(total) || total <= 1) return 0
  return still === 'first' ? 0 : still === 'last' ? total - 1 : Math.floor((total - 1) / 2)
}
