"use client"

import { useEffect } from "react"
import type { Editor } from "@tiptap/react"
import { Eraser, Highlighter, PenTool, Undo2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { DRAWING_COLORS, finishDrawing, useDrawing, type DrawingTool } from "@/lib/drawing-node"

const TOOLS: [tool: DrawingTool, label: string, icon: React.ReactNode][] = [
  ["pen", "Pen", <PenTool key="pen" />],
  ["marker", "Marker", <Highlighter key="marker" />],
  ["eraser", "Eraser", <Eraser key="eraser" />],
]

/** The tools shown along the bottom of a note while it is being drawn on. */
export function DrawingPalette({ editor }: { editor: Editor }) {
  const { active, tool, color } = useDrawing()

  // Escape finishes; leaving the note finishes too.
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && finishDrawing(editor)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, editor])
  useEffect(() => () => finishDrawing(editor), [editor])

  if (!active) return null
  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      className="glass absolute bottom-5 left-1/2 z-20 flex h-12 -translate-x-1/2 items-center gap-1 rounded-full px-2 select-none max-md:bottom-3 print:hidden"
    >
      {TOOLS.map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={tool === value}
          onClick={() => useDrawing.setState({ tool: value })}
          className={cn(
            "grid size-9 place-items-center rounded-full text-foreground/75 transition-colors duration-150 hover:bg-foreground/[0.08] [&_svg]:size-[18px] [&_svg]:[stroke-width:1.75]",
            tool === value && "bg-foreground text-background hover:bg-foreground"
          )}
        >
          {icon}
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-foreground/15" />
      {DRAWING_COLORS.map((value) => (
        <button
          key={value}
          type="button"
          title={value === "auto" ? "Ink" : value}
          aria-label={value === "auto" ? "Ink colour" : `Colour ${value}`}
          aria-pressed={color === value}
          onClick={() => useDrawing.setState({ color: value, tool: tool === "eraser" ? "pen" : tool })}
          className={cn(
            "grid size-7 place-items-center rounded-full transition-transform duration-150 active:scale-90 max-md:size-6",
            color === value && "ring-2 ring-foreground/60"
          )}
        >
          <span
            className="size-5 rounded-full ring-1 ring-foreground/15 max-md:size-4"
            style={{ background: value === "auto" ? "var(--foreground)" : value }}
          />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-foreground/15" />
      <button
        type="button"
        title="Undo"
        aria-label="Undo"
        onClick={() => editor.commands.undo()}
        className="grid size-9 place-items-center rounded-full text-foreground/75 transition-colors duration-150 hover:bg-foreground/[0.08] [&_svg]:size-[18px] [&_svg]:[stroke-width:1.75]"
      >
        <Undo2 />
      </button>
      <button
        type="button"
        onClick={() => finishDrawing(editor)}
        className="h-9 rounded-full bg-app-accent px-3.5 text-[13px] font-semibold text-white transition-transform duration-150 active:scale-95"
      >
        Done
      </button>
    </div>
  )
}
