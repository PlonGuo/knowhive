// DotGrid from React Bits (reactbits.dev, DotGrid-TS-TW variant), adapted for KnowHive:
//   - theme-aware palette (watches the root .dark class instead of taking color props)
//   - idle pause: when the pointer has been still and all dots are settled, the rAF
//     loop skips drawing (WKWebView battery — a desktop app idles most of the time)
//   - prefers-reduced-motion: renders a static grid, no listeners, no loop
//   - devicePixelRatio capped at 2
// Upstream logic (grid build, inertia push, elastic return) is unchanged.
import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { gsap } from 'gsap'
import { InertiaPlugin } from 'gsap/InertiaPlugin'

gsap.registerPlugin(InertiaPlugin)

const THEME_COLORS = {
  light: { base: '#d9d9de', active: '#18181b' },
  dark: { base: '#3a3833', active: '#d97757' },
}

const IDLE_AFTER_MS = 2500

const throttle = <A extends unknown[]>(func: (...args: A) => void, limit: number) => {
  let lastCall = 0
  return (...args: A) => {
    const now = performance.now()
    if (now - lastCall >= limit) {
      lastCall = now
      func(...args)
    }
  }
}

interface Dot {
  cx: number
  cy: number
  xOffset: number
  yOffset: number
  _inertiaApplied: boolean
}

export interface DotGridProps {
  dotSize?: number
  gap?: number
  proximity?: number
  speedTrigger?: number
  shockRadius?: number
  shockStrength?: number
  maxSpeed?: number
  resistance?: number
  returnDuration?: number
  className?: string
}

function hexToRgb(hex: string) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!m) return { r: 0, g: 0, b: 0 }
  return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) }
}

/** Current theme from the root class — kept in sync via MutationObserver so the
 * grid recolors instantly when the StatusBar toggle flips .dark. */
function useRootTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

export default function DotGrid({
  dotSize = 3,
  gap = 24,
  proximity = 140,
  speedTrigger = 100,
  shockRadius = 220,
  shockStrength = 4,
  maxSpeed = 5000,
  resistance = 750,
  returnDuration = 1.4,
  className = '',
}: DotGridProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotsRef = useRef<Dot[]>([])
  const pointerRef = useRef({ x: -9999, y: -9999, vx: 0, vy: 0, speed: 0, lastTime: 0, lastX: 0, lastY: 0 })
  const activeUntilRef = useRef(0)

  const theme = useRootTheme()
  const { base: baseColor, active: activeColor } = THEME_COLORS[theme]
  const baseRgb = useMemo(() => hexToRgb(baseColor), [baseColor])
  const activeRgb = useMemo(() => hexToRgb(activeColor), [activeColor])

  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  )

  const circlePath = useMemo(() => {
    if (typeof window === 'undefined' || !window.Path2D) return null
    const p = new Path2D()
    p.arc(0, 0, dotSize / 2, 0, Math.PI * 2)
    return p
  }, [dotSize])

  const buildGrid = useCallback(() => {
    const wrap = wrapperRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const { width, height } = wrap.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(dpr, dpr)

    const cols = Math.floor((width + gap) / (dotSize + gap))
    const rows = Math.floor((height + gap) / (dotSize + gap))
    const cell = dotSize + gap
    const startX = (width - (cell * cols - gap)) / 2 + dotSize / 2
    const startY = (height - (cell * rows - gap)) / 2 + dotSize / 2

    const dots: Dot[] = []
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        dots.push({ cx: startX + x * cell, cy: startY + y * cell, xOffset: 0, yOffset: 0, _inertiaApplied: false })
      }
    }
    dotsRef.current = dots
    activeUntilRef.current = performance.now() + 500 // force a redraw after rebuild
  }, [dotSize, gap])

  useEffect(() => {
    if (!circlePath) return

    let rafId: number
    const proxSq = proximity * proximity

    const drawFrame = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const { x: px, y: py } = pointerRef.current
      for (const dot of dotsRef.current) {
        const dx = dot.cx - px
        const dy = dot.cy - py
        const dsq = dx * dx + dy * dy
        let style = baseColor
        if (dsq <= proxSq) {
          const t = 1 - Math.sqrt(dsq) / proximity
          const r = Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t)
          const g = Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t)
          const b = Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t)
          style = `rgb(${r},${g},${b})`
        }
        ctx.save()
        ctx.translate(dot.cx + dot.xOffset, dot.cy + dot.yOffset)
        ctx.fillStyle = style
        ctx.fill(circlePath)
        ctx.restore()
      }
    }

    if (reducedMotion) {
      // One static render; no loop, no listeners.
      drawFrame()
      return
    }

    let idleDrawn = false
    const loop = () => {
      const now = performance.now()
      const displaced = dotsRef.current.some((d) => d.xOffset !== 0 || d.yOffset !== 0)
      const active = displaced || now < activeUntilRef.current
      if (active) {
        drawFrame()
        idleDrawn = false
      } else if (!idleDrawn) {
        drawFrame() // final settled frame, then go quiet
        idleDrawn = true
      }
      rafId = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(rafId)
  }, [proximity, baseColor, activeRgb, baseRgb, circlePath, reducedMotion])

  useEffect(() => {
    buildGrid()
    let ro: ResizeObserver | null = null
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(buildGrid)
      if (wrapperRef.current) ro.observe(wrapperRef.current)
    } else {
      window.addEventListener('resize', buildGrid)
    }
    return () => {
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', buildGrid)
    }
  }, [buildGrid])

  useEffect(() => {
    if (reducedMotion) return

    const applyPush = (dot: Dot, pushX: number, pushY: number) => {
      dot._inertiaApplied = true
      gsap.killTweensOf(dot)
      gsap.to(dot, {
        inertia: { xOffset: pushX, yOffset: pushY, resistance },
        onComplete: () => {
          gsap.to(dot, { xOffset: 0, yOffset: 0, duration: returnDuration, ease: 'elastic.out(1,0.75)' })
          dot._inertiaApplied = false
        },
      })
    }

    const onMove = (e: MouseEvent) => {
      activeUntilRef.current = performance.now() + IDLE_AFTER_MS
      const pr = pointerRef.current
      const now = performance.now()
      const dt = pr.lastTime ? now - pr.lastTime : 16
      let vx = ((e.clientX - pr.lastX) / dt) * 1000
      let vy = ((e.clientY - pr.lastY) / dt) * 1000
      let speed = Math.hypot(vx, vy)
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed
        vx *= scale
        vy *= scale
        speed = maxSpeed
      }
      pr.lastTime = now
      pr.lastX = e.clientX
      pr.lastY = e.clientY
      pr.vx = vx
      pr.vy = vy
      pr.speed = speed

      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      pr.x = e.clientX - rect.left
      pr.y = e.clientY - rect.top

      for (const dot of dotsRef.current) {
        const dist = Math.hypot(dot.cx - pr.x, dot.cy - pr.y)
        if (speed > speedTrigger && dist < proximity && !dot._inertiaApplied) {
          applyPush(dot, dot.cx - pr.x + vx * 0.005, dot.cy - pr.y + vy * 0.005)
        }
      }
    }

    const onClick = (e: MouseEvent) => {
      activeUntilRef.current = performance.now() + IDLE_AFTER_MS
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      for (const dot of dotsRef.current) {
        const dist = Math.hypot(dot.cx - cx, dot.cy - cy)
        if (dist < shockRadius && !dot._inertiaApplied) {
          const falloff = Math.max(0, 1 - dist / shockRadius)
          applyPush(dot, (dot.cx - cx) * shockStrength * falloff, (dot.cy - cy) * shockStrength * falloff)
        }
      }
    }

    const throttledMove = throttle(onMove, 50)
    window.addEventListener('mousemove', throttledMove, { passive: true })
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('mousemove', throttledMove)
      window.removeEventListener('click', onClick)
    }
  }, [maxSpeed, speedTrigger, proximity, resistance, returnDuration, shockRadius, shockStrength, reducedMotion])

  return (
    <div ref={wrapperRef} data-testid="dot-grid" className={`h-full w-full ${className}`}>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  )
}
