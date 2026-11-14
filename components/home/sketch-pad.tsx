"use client"

import { useEffect, useRef, useState } from "react"
import { Undo2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const COLORS = ["#262626", "#e2a400", "#e5484d", "#3b82f6"]

type Stroke = { color: string; points: [x: number, y: number][] }

/** Sketches are always drawn on white paper so they look the same in light and dark mode. */
function paint(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  const ratio = window.devicePixelRatio || 1
  const { width, height } = canvas.getBoundingClientRect()
  if (canvas.width !== Math.round(width * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  const g = canvas.getContext("2d")!
  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.fillStyle = "#fff"
  g.fillRect(0, 0, width, height)
  g.lineCap = "round"
  g.lineJoin = "round"
  g.lineWidth = 2.5
  for (const { color, points } of strokes) {
    g.strokeStyle = color
    g.beginPath()
    g.moveTo(points[0][0], points[0][1])
    // Curve through midpoints so fast strokes stay smooth instead of polygonal.
    for (let i = 1; i < points.length - 1; i++) {
      const [x, y] = points[i]
      const [nextX, nextY] = points[i + 1]
      g.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2)
    }
    const [lastX, lastY] = points[points.length - 1]
    g.lineTo(lastX + 0.01, lastY)
    g.stroke()
  }
}

export function SketchPad({
  onDone,
  onCancel,
}: {
  onDone: (src: string) => void
  onCancel: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // The drawing lives in a ref and is painted straight from pointer events, so a
  // stroke can never be dropped by a render that hasn't caught up yet.
  const strokes = useRef<Stroke[]>([])
  const active = useRef<Stroke | null>(null)
  const [count, setCount] = useState(0)
  const [color, setColor] = useState(COLORS[0])

  const repaint = () => {
    if (!canvas.current) return
    paint(canvas.current, active.current ? [...strokes.current, active.current] : strokes.current)
    setCount(strokes.current.length)
  }

  useEffect(() => {
    if (canvas.current) paint(canvas.current, [])
  }, [])

  const point = (e: React.PointerEvent): [number, number] => [
    e.nativeEvent.offsetX,
    e.nativeEvent.offsetY,
  ]

  return (
    <div className="mx-3 mb-2">
      <canvas
        ref={canvas}
        aria-label="Sketch area"
        className="block h-[300px] w-full max-sm:h-[260px] cursor-crosshair touch-none rounded-2xl bg-white ring-1 ring-foreground/10"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          active.current = { color, points: [point(e)] }
          repaint()
        }}
        onPointerMove={(e) => {
          if (!active.current) return
          active.current.points.push(point(e))
          repaint()
        }}
        onPointerUp={() => {
          if (!active.current) return
          strokes.current.push(active.current)
          active.current = null
          repaint()
        }}
      />
      <div className="flex items-center gap-2 pt-2.5 pb-1 max-sm:gap-1.5">
        {COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`Pen colour ${option}`}
            aria-pressed={option === color}
            onClick={() => setColor(option)}
            style={{ backgroundColor: option }}
            className={cn(
              "size-6 shrink-0 rounded-full ring-offset-2 pointer-coarse:size-8 ring-offset-card transition-shadow duration-150 dark:ring-1 dark:ring-white/25",
              option === color && "ring-2 ring-foreground/50 dark:ring-2"
            )}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="ml-1"
          disabled={count === 0}
          onClick={() => {
            strokes.current.pop()
            repaint()
          }}
        >
          <Undo2 />
          <span className="max-sm:sr-only">Undo</span>
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={count === 0}
          onClick={() => onDone(canvas.current!.toDataURL("image/png"))}
        >
          Add<span className="max-sm:sr-only"> Sketch</span>
        </Button>
      </div>
    </div>
  )
}
