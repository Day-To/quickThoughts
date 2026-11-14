"use client"

/**
 * What the device knows about the moment a thought was captured (plan.md §6, step 2).
 * Stored with the note and given to the LLM when it organises the thought.
 */
export type NoteContext = {
  timezone?: string
  /** Wall-clock time where the user was, e.g. "2026-11-14T14:05". */
  local_time?: string
  weekday?: string
  part_of_day?: "morning" | "afternoon" | "evening" | "night"
  source?: "typed" | "voice" | "sketch" | "image"
  lat?: number
  lng?: number
  accuracy_m?: number
  /** A readable place name, when one is known. */
  place?: string
}

/** Written by the server after a note is saved; read-only on the device. */
export type Enrichment = {
  type: string
  category: string
  tags: string[]
  entities: string[]
  summary: string
  has_todos: boolean
  // Everything below is absent on notes enriched before the thought page existed.
  title?: string
  points?: string[]
  checklist?: { heading: string; items: string[] } | null
  actions?: ThoughtAction[]
  /** The model that wrote this up, when, and why the first-choice model wasn't used (if it wasn't). */
  written_by?: string
  written_at?: string
  fallback?: string | null
}

/** Models a user can ask for by name when reprocessing a thought. */
export const RERUN_MODEL = "claude-fable-5-2"

const MODEL_NAMES: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-fable-5-2": "Claude Fable 5.2",
  "gpt-6-luna": "GPT-6 Luna",
}
export const modelName = (id: string) => MODEL_NAMES[id] ?? id

/** Something the action worker did for a thought, and what it found. */
export type ThoughtAction = {
  label: string
  input: string
  status: "running" | "done" | "failed"
  /** The model that carried it out. */
  by?: string
} & (
  | { type: "fetch_link"; result?: { url?: string; site?: string; title?: string; summary?: string; image?: string | null; error?: string } }
  | { type: "research"; kind?: "products" | "facts"; result?: { answer?: string; products?: unknown[]; sources?: { url: string; title: string }[]; error?: string } }
)

/** One capture that went into a thought; a merged thought has several. */
/** One capture as the user entered it. `html` keeps its formatting (lists, checkboxes, bold...). */
export type Original = { at: string; text: string; html?: string }

const POSITION_MAX_AGE = 15 * 60_000
let position: { lat: number; lng: number; accuracy_m: number; at: number } | null = null

/**
 * Looks up where the device is and remembers it for a while, so that saving a thought
 * never has to wait for a GPS fix. Call when the home screen opens and after each capture.
 * The first call makes the browser ask for permission. Resolves false if it was refused.
 */
export function refreshPosition(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(false)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        position = {
          // About 11 m of precision; no need to store more than that.
          lat: Math.round(coords.latitude * 1e4) / 1e4,
          lng: Math.round(coords.longitude * 1e4) / 1e4,
          accuracy_m: Math.round(coords.accuracy),
          at: Date.now(),
        }
        resolve(true)
      },
      () => resolve(false),
      { maximumAge: 5 * 60_000, timeout: 10_000 }
    )
  })
}

export function captureContext(source: NoteContext["source"], withLocation: boolean): NoteContext {
  const now = new Date()
  const hour = now.getHours()
  const pad = (n: number) => String(n).padStart(2, "0")
  const context: NoteContext = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    local_time: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(hour)}:${pad(now.getMinutes())}`,
    weekday: now.toLocaleDateString("en", { weekday: "long" }),
    part_of_day: hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night",
    source,
  }
  if (withLocation && position && Date.now() - position.at < POSITION_MAX_AGE) {
    context.lat = position.lat
    context.lng = position.lng
    context.accuracy_m = position.accuracy_m
  }
  return context
}
