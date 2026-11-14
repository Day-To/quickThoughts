"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { CornerDownLeft, Folder as FolderIcon, Lightbulb, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { listDate } from "@/lib/dates"
import { closeSpotlight, cloudSearch, localSearch, openSpotlight, useSpotlight, type CloudResults } from "@/lib/search"
import { THOUGHTS, displayTitle, useNotes, type Note } from "@/lib/store"

const PAUSE = 450
const LIMIT = 30

/**
 * The one place to search: a floating panel in the style of macOS Spotlight.
 * Typing filters instantly by plain text; after a short pause the cloud's ranked
 * results (by meaning and date) take over.
 */
export function Spotlight() {
  const open = useSpotlight((s) => s.open)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        if (useSpotlight.getState().open) closeSpotlight()
        else openSpotlight()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && closeSpotlight()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/15 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 dark:bg-black/40" />
        <DialogPrimitive.Popup
          aria-label="Search"
          className="spotlight fixed top-[16vh] left-1/2 z-50 flex max-h-[min(68vh,560px)] w-[calc(100%-1.5rem)] max-w-[680px] -translate-x-1/2 flex-col overflow-hidden rounded-[20px] text-foreground outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 max-sm:top-[calc(0.75rem+env(safe-area-inset-top))]"
        >
          {/* Mounted only while open, so each opening starts with an empty query. */}
          <SpotlightBody />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function SpotlightBody() {
  const notes = useNotes((s) => s.notes)
  const folders = useNotes((s) => s.folders)
  const openThought = useNotes((s) => s.openThought)
  const [query, setQuery] = useState("")
  const [cloud, setCloud] = useState<CloudResults | null>(null)
  const [pendingFor, setPendingFor] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const q = query.trim()

  useEffect(() => {
    if (q.length < 2) return
    let stale = false
    const timer = setTimeout(async () => {
      setPendingFor(q)
      const results = await cloudSearch(q)
      if (stale) return
      setPendingFor(null)
      if (results) {
        setCloud(results)
        setCursor(0)
      }
    }, PAUSE)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [q])

  const ranked = cloud !== null && cloud.query === q
  const searching = pendingFor === q && !ranked
  const results = useMemo(() => {
    if (!q) return []
    if (ranked) {
      const byId = new Map(notes.map((n) => [n.id, n]))
      return cloud.ids.flatMap((id) => {
        const note = byId.get(id)
        return note && !note.deletedAt ? [note] : []
      })
    }
    return localSearch(notes, q).slice(0, LIMIT)
  }, [notes, q, ranked, cloud])

  const active = Math.min(cursor, Math.max(results.length - 1, 0))
  const choose = (note: Note) => {
    closeSpotlight()
    openThought(note.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const next = Math.min(Math.max(active + (e.key === "ArrowDown" ? 1 : -1), 0), results.length - 1)
      setCursor(next)
      list.current?.children[next]?.scrollIntoView({ block: "nearest" })
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault()
      choose(results[active])
    }
  }

  const folderName = (id: string) => folders.find((f) => f.id === id)?.name ?? "All Notes"

  return (
    <>
      <div className="flex h-[58px] shrink-0 items-center gap-3 px-5">
        <Search className="size-[22px] shrink-0 text-muted-foreground" strokeWidth={1.9} />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search your thoughts"
          aria-label="Search your thoughts"
          autoComplete="off"
          spellCheck={false}
          className="note-font min-w-0 flex-1 bg-transparent text-[21px] font-light outline-none placeholder:text-muted-foreground/70"
        />
        {searching && (
          <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/55" />
        )}
      </div>

      {q !== "" && (
        <div ref={list} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto border-t border-foreground/10 p-2">
          {results.length === 0 && !searching && (
            <p className="px-3 py-6 text-center text-[14px] text-muted-foreground">Nothing found.</p>
          )}
          {results.map((note, i) => (
            <div
              key={note.id}
              role="option"
              aria-selected={i === active}
              onClick={() => choose(note)}
              onMouseMove={() => i !== active && setCursor(i)}
              className={cn(
                "flex cursor-default items-start gap-3 rounded-xl px-3 py-2.5",
                i === active && "bg-app-accent/90 text-white dark:bg-app-accent/75"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
                  i === active ? "bg-white/20" : "bg-foreground/[0.06] text-app-accent"
                )}
              >
                {note.folderId === THOUGHTS ? (
                  <Lightbulb className="size-[17px]" strokeWidth={1.9} />
                ) : (
                  <FolderIcon className="size-[17px]" strokeWidth={1.9} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="note-font block truncate text-[14.5px] font-semibold">
                  {displayTitle(note)}
                </span>
                <span className={cn("note-font block truncate text-[13px]", i === active ? "text-white/85" : "text-muted-foreground")}>
                  {note.snippet || note.enrichment?.summary || folderName(note.folderId)}
                </span>
                {note.enrichment && note.enrichment.tags.length > 0 && (
                  <span className="flex flex-wrap gap-1 pt-1.5">
                    {note.enrichment.tags.map((tag) => (
                      <span
                        key={tag}
                        className={cn(
                          "rounded-full px-1.5 py-px text-[11px]",
                          i === active ? "bg-white/20" : "bg-foreground/[0.06] text-muted-foreground"
                        )}
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className={cn("shrink-0 pt-0.5 text-[12px] tabular-nums", i === active ? "text-white/85" : "text-muted-foreground")}>
                {listDate(note.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex h-9 shrink-0 items-center gap-3 border-t border-foreground/10 px-4 text-[12px] text-muted-foreground">
        {q === "" ? (
          <span className="truncate">Search by word, by meaning, or by date. Try “sunscreen” or “last week”.</span>
        ) : (
          <span className="truncate">
            {results.length} {results.length === 1 ? "result" : "results"}
            {ranked && cloud.label ? ` · ${cloud.label}` : ""}
          </span>
        )}
        <span className="flex-1" />
        <span className="flex shrink-0 items-center gap-1 max-sm:hidden">
          <CornerDownLeft className="size-3" /> open
        </span>
        <span className="shrink-0 max-sm:hidden">esc close</span>
      </div>
    </>
  )
}
