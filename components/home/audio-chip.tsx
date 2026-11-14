"use client"

import { useEffect, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDuration } from "@/lib/media"

/** Compact player for a voice note. */
export function AudioChip({
  src,
  seconds,
  className,
}: {
  src: string
  seconds: number
  className?: string
}) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => () => audio.current?.pause(), [])

  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!audio.current) {
      const element = new Audio(src)
      // Recorded files often report no duration, so progress uses the length we measured.
      element.ontimeupdate = () =>
        setProgress(Math.min(1, element.currentTime / Math.max(seconds, 0.1)))
      element.onended = () => {
        setPlaying(false)
        setProgress(0)
      }
      audio.current = element
    }
    if (audio.current.paused) {
      void audio.current.play()
      setPlaying(true)
    } else {
      audio.current.pause()
      setPlaying(false)
    }
  }

  return (
    <div
      className={cn(
        "flex h-10 w-56 items-center gap-2.5 rounded-full bg-foreground/[0.06] pr-3.5 pl-1.5 pointer-coarse:h-11",
        className
      )}
    >
      <button
        type="button"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        onClick={toggle}
        className="grid size-7 shrink-0 place-items-center rounded-full bg-app-accent pointer-coarse:size-8 text-white transition-transform duration-150 active:scale-90"
      >
        {playing ? (
          <Pause className="size-3.5 fill-current" />
        ) : (
          <Play className="ml-0.5 size-3.5 fill-current" />
        )}
      </button>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/15">
        <div
          className="h-full rounded-full bg-app-accent transition-[width] duration-200 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className="text-[12px] text-muted-foreground tabular-nums">
        {formatDuration(seconds)}
      </span>
    </div>
  )
}
