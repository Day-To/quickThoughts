"use client"

import { useEffect, useState } from "react"
import { Link2 } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { displayTitle, useNotes, type Note } from "@/lib/store"
import { supabase } from "@/lib/supabase"

/** Other notes the server linked to this one as related (plan.md §6), best match first. */
export function useRelatedNotes(note: Note): Note[] {
  const signedIn = useAuth((s) => Boolean(s.session))
  const notes = useNotes((s) => s.notes)
  const [links, setLinks] = useState<{ noteId: string; ids: string[] }>({ noteId: "", ids: [] })

  // Links are rewritten whenever the note is re-enriched, so refetch when that changes.
  const enrichment = note.enrichment
  useEffect(() => {
    if (!signedIn) return
    let current = true
    void supabase()
      .from("note_links")
      .select("to_id, score")
      .eq("from_id", note.id)
      .order("score", { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (current) setLinks({ noteId: note.id, ids: (data ?? []).map((row) => row.to_id as string) })
      })
    return () => {
      current = false
    }
  }, [signedIn, note.id, enrichment])

  if (!signedIn || links.noteId !== note.id) return []
  return links.ids.flatMap((id) => {
    const found = notes.find((n) => n.id === id)
    return found && !found.deletedAt ? [found] : []
  })
}

/** A strip under an ordinary note listing its related notes; tap one to open it. */
export function RelatedNotes({ note }: { note: Note }) {
  const openThought = useNotes((s) => s.openThought)
  const related = useRelatedNotes(note)
  if (related.length === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t px-4 py-2 print:hidden">
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <Link2 className="size-3.5" />
        Related
      </span>
      {related.map((other) => (
        <button
          key={other.id}
          type="button"
          onClick={() => openThought(other.id)}
          className="note-font max-w-56 shrink-0 truncate rounded-full bg-foreground/[0.06] px-3 py-1 text-[12.5px] transition-colors duration-150 hover:bg-foreground/[0.11] pointer-coarse:py-2 pointer-coarse:text-[14px]"
        >
          {displayTitle(other)}
        </button>
      ))}
    </div>
  )
}
