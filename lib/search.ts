"use client"

import { create } from "zustand"
import { supabase } from "./supabase"
import type { Note } from "./store"

/** Whether the Spotlight-style search panel is open. Opened from the search icons or with Cmd+K. */
export const useSpotlight = create<{ open: boolean }>(() => ({ open: false }))
export const openSpotlight = () => useSpotlight.setState({ open: true })
export const closeSpotlight = () => useSpotlight.setState({ open: false })

type Filters = { topic: string | null; from_date: string | null; to_date: string | null; type: string | null }

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { day: "numeric", month: "short" })
}

/** "8 Nov – 14 Nov · todos": how the query was understood. */
function describe(filters: Filters | null): string | null {
  if (!filters) return null
  const parts: string[] = []
  if (filters.from_date && filters.to_date) {
    parts.push(filters.from_date === filters.to_date ? day(filters.from_date) : `${day(filters.from_date)} – ${day(filters.to_date)}`)
  } else if (filters.from_date) parts.push(`since ${day(filters.from_date)}`)
  else if (filters.to_date) parts.push(`until ${day(filters.to_date)}`)
  if (filters.type) parts.push(`${filters.type}s`)
  return parts.length > 0 ? parts.join(" · ") : null
}

export type CloudResults = { query: string; ids: string[]; label: string | null }

/**
 * Smart search in the cloud (plan.md §7): understands meaning and dates and returns
 * note ids, best first. Resolves to null when offline or if the request fails, in
 * which case the caller keeps showing plain-text matches.
 */
export async function cloudSearch(query: string): Promise<CloudResults | null> {
  if (!navigator.onLine) return null
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const { data, error } = await supabase().functions.invoke("search", {
    body: {
      query,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      weekday: now.toLocaleDateString("en", { weekday: "long" }),
    },
  })
  if (error || !data || data.error) return null
  return { query, ids: (data.results as { id: string }[]).map((r) => r.id), label: describe(data.filters) }
}

/** Instant plain-text matches from the notes already on the device, newest first. */
export function localSearch(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return notes
    .filter((n) => !n.deletedAt && !n.empty && `${n.title}\n${n.text}`.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
