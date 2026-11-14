"use client"

import { useRef, useState } from "react"
import { mergeAttributes, Node } from "@tiptap/core"
import { NodeViewWrapper, ReactNodeViewRenderer, type Editor, type NodeViewProps } from "@tiptap/react"
import { closeHistory } from "@tiptap/pm/history"
import { create } from "zustand"
import { cn } from "@/lib/utils"

/**
 * A drawing inside a note, as in Apple Notes: a block you draw on with a pen, a marker
 * or an eraser. It is stored as its strokes (not a picture), so it stays sharp at any
 * size, follows light and dark mode, and can be drawn on again later.
 */

export type DrawingTool = "pen" | "marker" | "eraser"
/** `points` is x, y, x, y… in the drawing's own units (`width` × `height`). */
export type Stroke = { tool: "pen" | "marker"; color: string; points: number[] }

/** "auto" is ink that follows the text colour: dark on light, light on dark. */
export const DRAWING_COLORS = ["auto", "#ff3b30", "#ff9f0a", "#34c759", "#0a84ff", "#bf5af2"]

/** Whether the open note is being drawn on, and with what. */
export const useDrawing = create<{ active: boolean; tool: DrawingTool; color: string }>(() => ({
  active: false,
  tool: "pen",
  color: "auto",
}))

const NEW_HEIGHT = 360
const GROW_BY = 240
const MIN_HEIGHT = 120

function pathOf(points: number[]): string {
  if (points.length < 4) return `M${points[0]} ${points[1]}l0.01 0`
  let d = `M${points[0]} ${points[1]}`
  // Curves through the midpoints, so a quick stroke is smooth rather than angular.
  for (let i = 2; i < points.length - 2; i += 2) {
    d += `Q${points[i]} ${points[i + 1]} ${(points[i] + points[i + 2]) / 2} ${(points[i + 1] + points[i + 3]) / 2}`
  }
  return d + `L${points[points.length - 2]} ${points[points.length - 1]}`
}

function touches(stroke: Stroke, x: number, y: number, reach: number): boolean {
  for (let i = 0; i < stroke.points.length; i += 2) {
    if (Math.hypot(stroke.points[i] - x, stroke.points[i + 1] - y) <= reach) return true
  }
  return false
}

function StrokePath({ stroke }: { stroke: Stroke }) {
  return (
    <path
      d={pathOf(stroke.points)}
      fill="none"
      stroke={stroke.color === "auto" ? "currentColor" : stroke.color}
      strokeWidth={stroke.tool === "marker" ? 16 : 2.4}
      strokeOpacity={stroke.tool === "marker" ? 0.35 : 1}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

function DrawingView({ node, getPos, selected, editor }: NodeViewProps) {
  const strokes = node.attrs.strokes as Stroke[]
  const width = node.attrs.width as number
  const height = node.attrs.height as number
  const drawing = useDrawing((s) => s.active) && editor.isEditable
  const svg = useRef<SVGSVGElement>(null)
  // The stroke under the pen, and strokes rubbed out so far in this pass of the eraser.
  const current = useRef<Stroke | null>(null)
  const [live, setLive] = useState<Stroke | null>(null)
  const [erased, setErased] = useState<Set<Stroke>>(new Set())

  // Each stroke is its own step for Undo, however quickly it follows the last one.
  const updateAttributes = (attrs: Record<string, unknown>) => {
    const pos = getPos()
    if (pos === undefined) return
    editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }))
  }

  const at = (event: { clientX: number; clientY: number }) => {
    const box = svg.current!.getBoundingClientRect()
    return [
      Math.round(((event.clientX - box.left) / box.width) * width * 10) / 10,
      Math.round(((event.clientY - box.top) / box.height) * height * 10) / 10,
    ]
  }

  const rub = (x: number, y: number) =>
    setErased((before) => {
      const hit = strokes.filter((stroke) => !before.has(stroke) && touches(stroke, x, y, 12))
      return hit.length > 0 ? new Set([...before, ...hit]) : before
    })

  const down = (event: React.PointerEvent) => {
    if (!drawing || event.button !== 0) return
    event.preventDefault()
    svg.current!.setPointerCapture(event.pointerId)
    const [x, y] = at(event)
    const { tool, color } = useDrawing.getState()
    if (tool === "eraser") return rub(x, y)
    current.current = { tool, color, points: [x, y] }
    setLive(current.current)
  }

  const move = (event: React.PointerEvent) => {
    if (!drawing || !svg.current?.hasPointerCapture(event.pointerId)) return
    const stroke = current.current
    // A fast pen reports several positions per frame; use them all for a true line.
    for (const sample of event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]) {
      const [x, y] = at(sample)
      if (!stroke) {
        rub(x, y)
        continue
      }
      const points = stroke.points
      if (Math.hypot(points[points.length - 2] - x, points[points.length - 1] - y) >= 1.5) points.push(x, y)
    }
    if (stroke) setLive({ ...stroke })
  }

  const up = (event: React.PointerEvent) => {
    if (!svg.current?.hasPointerCapture(event.pointerId)) return
    svg.current.releasePointerCapture(event.pointerId)
    const stroke = current.current
    current.current = null
    setLive(null)
    if (stroke) {
      let lowest = 0
      for (let i = 1; i < stroke.points.length; i += 2) lowest = Math.max(lowest, stroke.points[i])
      // Drawing near the bottom edge makes more room below, as the page does in Notes.
      updateAttributes({ strokes: [...strokes, stroke], height: lowest > height - 60 ? height + GROW_BY : height })
    } else if (erased.size > 0) {
      updateAttributes({ strokes: strokes.filter((s) => !erased.has(s)) })
    }
    setErased(new Set())
  }

  return (
    <NodeViewWrapper
      contentEditable={false}
      data-drawing
      onDoubleClick={() => editor.isEditable && useDrawing.setState({ active: true })}
      className={cn(
        "my-2 rounded-lg select-none",
        drawing ? "outline-1 outline-foreground/15 outline-dashed" : selected && "outline-3 outline-app-accent/60"
      )}
    >
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Drawing"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className={cn("block h-auto w-full max-w-full", drawing && "cursor-crosshair touch-none")}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {strokes.map((stroke, i) => !erased.has(stroke) && <StrokePath key={i} stroke={stroke} />)}
        {live && <StrokePath stroke={live} />}
      </svg>
    </NodeViewWrapper>
  )
}

function parseStrokes(value: string | null): Stroke[] {
  try {
    const parsed = JSON.parse(value ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((s) => Array.isArray(s?.points) && s.points.length >= 2) : []
  } catch {
    return []
  }
}

export const DrawingNode = Node.create({
  name: "drawing",
  group: "block",
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      strokes: {
        default: [],
        parseHTML: (element) => parseStrokes(element.getAttribute("data-strokes")),
        renderHTML: (attributes) => ({ "data-strokes": JSON.stringify(attributes.strokes) }),
      },
      width: {
        default: 720,
        parseHTML: (element) => Number(element.getAttribute("data-width")) || 720,
        renderHTML: (attributes) => ({ "data-width": attributes.width }),
      },
      height: {
        default: NEW_HEIGHT,
        parseHTML: (element) => Number(element.getAttribute("data-height")) || NEW_HEIGHT,
        renderHTML: (attributes) => ({ "data-height": attributes.height }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="drawing"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "drawing" })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawingView, {
      // While drawing, the pen belongs to the drawing, not to the text editor around it.
      stopEvent: ({ event }) => useDrawing.getState().active && /^(pointer|mouse|touch)/.test(event.type),
    })
  },
})

/**
 * Starts drawing in the note. Uses the drawing under the cursor if there is one;
 * otherwise adds a new drawing below the line the cursor is on.
 */
export function startDrawing(editor: Editor) {
  const { selection, doc } = editor.state
  const onDrawing = doc.nodeAt(selection.from)?.type.name === "drawing"
  if (!onDrawing) {
    const width = Math.round(Math.min(1400, Math.max(320, editor.view.dom.clientWidth)))
    const below = selection.$to.depth > 0 ? selection.$to.after(1) : selection.to
    editor.chain().insertContentAt(below, { type: "drawing", attrs: { width, height: NEW_HEIGHT, strokes: [] } }).run()
    requestAnimationFrame(() => editor.view.dom.querySelector<HTMLElement>("[data-drawing]:last-of-type")?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
  }
  useDrawing.setState({ active: true })
}

/** Ends drawing: unused drawings are removed, and empty space below the ink is trimmed. */
export function finishDrawing(editor: Editor | null) {
  useDrawing.setState({ active: false })
  if (!editor || editor.isDestroyed || !editor.isEditable) return
  const found: { pos: number; size: number; strokes: Stroke[]; height: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "drawing") found.push({ pos, size: node.nodeSize, strokes: node.attrs.strokes, height: node.attrs.height })
  })
  const tr = editor.state.tr
  // Last first, so earlier positions stay valid as blocks are removed.
  for (const { pos, size, strokes, height } of found.reverse()) {
    if (strokes.length === 0) {
      tr.delete(pos, pos + size)
      continue
    }
    let lowest = 0
    for (const stroke of strokes) for (let i = 1; i < stroke.points.length; i += 2) lowest = Math.max(lowest, stroke.points[i])
    const trimmed = Math.max(MIN_HEIGHT, Math.ceil(lowest + 24))
    if (trimmed < height) tr.setNodeAttribute(pos, "height", trimmed)
  }
  if (tr.docChanged) editor.view.dispatch(tr)
}
