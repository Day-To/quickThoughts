"use client"

import { Lightbulb, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { openSpotlight } from "@/lib/search"
import { useNotes } from "@/lib/store"

const ROUND =
  "glass pointer-events-auto grid size-12 shrink-0 place-items-center rounded-full transition-transform duration-150 active:scale-90 [&_svg]:size-[22px] [&_svg]:[stroke-width:1.8]"

/** The lightbulb in the bottom right corner of a phone screen: straight back to the capture screen. */
export function HomeButton({ className }: { className?: string }) {
  const setView = useNotes((s) => s.setView)
  return (
    <button type="button" aria-label="Home" title="New thought" onClick={() => setView("home")} className={cn(ROUND, "text-app-accent", className)}>
      <Lightbulb />
    </button>
  )
}

/**
 * Floats along the bottom of the phone's folder and note lists, as in Notes on iPhone:
 * search, an optional action (new note, new folder), and the way home.
 */
export function MobileDock({ action }: { action?: { label: string; icon: React.ReactNode; run: () => void } }) {
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-10 flex items-center gap-2.5 print:hidden">
      <button
        type="button"
        aria-label="Search"
        onClick={openSpotlight}
        className="glass pointer-events-auto flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full px-4 text-[17px] text-muted-foreground transition-transform duration-150 active:scale-[0.98]"
      >
        <Search className="size-5 shrink-0 text-foreground/80" strokeWidth={2} />
        Search
      </button>
      {action && (
        <button type="button" aria-label={action.label} onClick={action.run} className={ROUND}>
          {action.icon}
        </button>
      )}
      <HomeButton />
    </div>
  )
}

/** The round button at the top of a phone screen (back, options). */
export const TOP_BUTTON =
  "glass grid size-11 shrink-0 place-items-center rounded-full transition-transform duration-150 active:scale-90 [&_svg]:size-[22px] [&_svg]:[stroke-width:2]"

/**
 * A phone screen with a large title that shrinks into the top bar as you scroll,
 * round buttons either side, and the dock at the bottom.
 */
export function MobileScreen({
  as: Tag = "section",
  title,
  subtitle,
  left,
  right,
  dock,
  compact,
  onCompact,
  children,
}: {
  as?: "section" | "aside"
  title: string
  subtitle?: string
  left?: React.ReactNode
  right?: React.ReactNode
  dock: React.ReactNode
  compact: boolean
  onCompact: (compact: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Tag className="relative flex h-full w-full flex-col bg-app-grouped print:hidden">
      <header
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex h-[60px] items-center gap-2 px-4 transition-[background-color,border-color] duration-200",
          compact ? "border-b bg-app-grouped/80 backdrop-blur-xl" : "border-b border-transparent"
        )}
      >
        <div className="flex min-w-11 flex-1 basis-0 justify-start gap-2">{left}</div>
        <div className={cn("min-w-0 shrink text-center transition-opacity duration-200", !compact && "opacity-0")} aria-hidden={!compact}>
          <div className="truncate text-[16px] leading-5 font-semibold">{title}</div>
          {subtitle && <div className="text-[13px] leading-4 text-muted-foreground">{subtitle}</div>}
        </div>
        <div className="flex min-w-11 flex-1 basis-0 justify-end gap-2">{right}</div>
      </header>
      <div
        data-mobile-scroll
        className="flex-1 overflow-x-hidden overflow-y-auto px-[18px] pt-[68px] pb-28"
        onScroll={(e) => {
          const past = e.currentTarget.scrollTop > 52
          if (past !== compact) onCompact(past)
        }}
      >
        <h1 className="note-font pt-3 text-[34px] leading-[41px] font-bold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="text-[15px] leading-5 text-muted-foreground">{subtitle}</p>}
        {children}
      </div>
      {dock}
    </Tag>
  )
}

/** The rounded card that groups rows on a phone list. */
export const GROUP_CARD = "overflow-hidden rounded-[26px] bg-app-group"

/** Hairlines between the rows of a card, inset to start under the row's text. */
export const ROW_LINES =
  "[&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:top-0 [&>*+*]:before:right-[18px] [&>*+*]:before:left-[54px] [&>*+*]:before:z-[1] [&>*+*]:before:border-t [&>*+*]:before:border-foreground/10"
