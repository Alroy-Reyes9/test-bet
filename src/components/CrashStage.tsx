"use client"
import { useEffect, useRef, type ReactNode } from "react"

/**
 * The graph panel: grid background, scanline overlay, a canvas-drawn rising
 * curve up to `hundredths` (glowing green, red on bust), and the
 * "provably fair" corner badge. `children` is the centered multiplier
 * overlay (see `MultiplierReadout`) — kept as a sibling so this component
 * stays purely about the stage chrome. Cosmetic only.
 */
export function CrashStage({ hundredths, busted, children }: { hundredths: number; busted: boolean; children?: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext("2d")!
    const dpr = Math.min(devicePixelRatio || 1, 2)
    cv.width = cv.clientWidth * dpr
    cv.height = cv.clientHeight * dpr
    const W = cv.width, H = cv.height, padB = 44 * dpr, padL = 10 * dpr
    ctx.clearRect(0, 0, W, H)

    const x = hundredths / 100
    const topM = Math.max(2.0, x * 1.12)
    const k = Math.log(x) || 0.0001
    const steps = 120
    const X = (f: number) => padL + f * (W - padL - 8 * dpr)
    const Y = (mm: number) => H - padB - ((mm - 1) / (topM - 1)) * (H - padB - 28 * dpr)
    const rise = busted ? "#ffb4ab" : "#61ffb8"

    // filled area under the curve
    ctx.beginPath()
    for (let i = 0; i <= steps; i++) { const f = i / steps; const p = X(f), q = Y(Math.exp(k * f)); i ? ctx.lineTo(p, q) : ctx.moveTo(p, q) }
    ctx.lineTo(X(1), H - padB); ctx.lineTo(X(0), H - padB); ctx.closePath()
    const fill = ctx.createLinearGradient(0, 0, 0, H)
    fill.addColorStop(0, busted ? "rgba(255,180,171,.22)" : "rgba(36,227,155,.20)")
    fill.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = fill
    ctx.fill()

    // curve line with glow
    ctx.beginPath()
    for (let i = 0; i <= steps; i++) { const f = i / steps; const p = X(f), q = Y(Math.exp(k * f)); i ? ctx.lineTo(p, q) : ctx.moveTo(p, q) }
    const grad = ctx.createLinearGradient(0, 0, W, 0)
    grad.addColorStop(0, busted ? "#ff7a4c" : "#24e39b")
    grad.addColorStop(1, rise)
    ctx.strokeStyle = grad
    ctx.lineWidth = 3.5 * dpr
    ctx.lineJoin = "round"
    ctx.shadowColor = busted ? "rgba(255,180,171,.6)" : "rgba(36,227,155,.55)"
    ctx.shadowBlur = 18 * dpr
    ctx.stroke()
    ctx.shadowBlur = 0

    // head dot
    ctx.beginPath()
    ctx.arc(X(1), Y(x), 5.5 * dpr, 0, 7)
    ctx.fillStyle = busted ? "#ffb4ab" : "#ffffff"
    ctx.fill()
  }, [hundredths, busted])

  return (
    <div className="relative min-h-[400px] flex-1 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className="graph-grid absolute inset-0 opacity-30" />
      <div className="scanline absolute inset-0 opacity-20" />
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      {children}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container/60 px-3 py-1 backdrop-blur-sm">
        <span className="material-symbols-outlined text-[14px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
        <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">Provably fair - committed</span>
      </div>
    </div>
  )
}
