"use client"

import { create } from "zustand"
import { del, get, set as idbSet } from "idb-keyval"
import { persist, type PersistStorage } from "zustand/middleware"
import { captureContext, type Enrichment, type NoteContext, type Original } from "./context"

export const ALL = "all"
export const TRASH = "trash"
/** A note that isn't filed in any folder; it shows under All Notes only. */
export const NO_FOLDER = ""
/** Where everything captured on the home screen lands. */
export const THOUGHTS = "thoughts"

export type SortBy = "updatedAt" | "createdAt" | "title"

export type Folder = {
  id: string
  name: string
  parentId: string | null
  expanded: boolean
}

export type Note = {
  id: string
  folderId: string
  title: string
  snippet: string
  text: string
  content: string
  empty: boolean
  pinned: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** The moment of capture: time, place, how it was captured. */
  context?: NoteContext
  /** Tags and so on, added by the server once the note has synced. */
  enrichment?: Enrichment | null
  /** Set by the server when several captures were merged into this thought. */
  originals?: Original[]
}

/** The title to show for a note: its first line. */
export const displayTitle = (note: Note) => note.title || "New Note"

/** The preview line shown under the title in lists. */
export const displaySnippet = (note: Note) => note.snippet || "No additional text"

export type Attachment = {
  id: string
  kind: "image" | "sketch" | "audio"
  src: string
  seconds?: number
}

type Draft = { content: string; empty: boolean; attachments: Attachment[] }

const emptyDraft: Draft = { content: "", empty: true, attachments: [] }

export type NotePatch = Pick<Note, "content" | "title" | "snippet" | "text" | "empty">

type State = {
  folders: Folder[]
  notes: Note[]
  selectedFolderId: string
  selectedNoteId: string | null
  sidebarOpen: boolean
  sidebarWidth: number
  listWidth: number
  sortBy: SortBy
  view: "home" | "library"
  /** Phone-sized screens show one library pane at a time; this is the one in view. */
  mobilePane: "folders" | "list" | "editor"
  /** The thought being composed on the home screen; persisted so it survives a reload. */
  draft: Draft
  /** Attach the device's location to new thoughts. On unless the user says no. */
  locationEnabled: boolean
  /** Whether this device has shown the "why we collect location" step and got an answer. */
  locationAsked: boolean

  answerLocation: (enabled: boolean) => void
  setLocationEnabled: (enabled: boolean) => void
  /**
   * Replaces the words a quick thought was captured as. The server then processes the
   * thought again and rewrites the note from them.
   */
  /** `reprocess: false` when only the formatting changed, so the write-up is kept. */
  setOriginals: (id: string, originals: Original[], reprocess?: boolean) => void
  setView: (view: State["view"]) => void
  setMobilePane: (pane: State["mobilePane"]) => void
  setDraftContent: (content: string, empty: boolean) => void
  addAttachment: (attachment: Omit<Attachment, "id">) => void
  removeAttachment: (id: string) => void
  /** Saves the draft as a note. `written` describes its text, or is null when there is none. */
  captureThought: (written: NotePatch | null) => void
  openThought: (id: string) => void

  createFolder: (name: string, parentId: string | null) => void
  renameFolder: (id: string, name: string) => void
  deleteFolder: (id: string) => void
  toggleFolder: (id: string) => void
  selectFolder: (id: string) => void

  createNote: () => void
  updateNote: (id: string, patch: NotePatch) => void
  deleteNote: (id: string) => void
  restoreNote: (id: string) => void
  togglePin: (id: string) => void
  moveNote: (id: string, folderId: string) => void
  selectNote: (id: string) => void
  emptyTrash: () => void

  setSortBy: (sortBy: SortBy) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setListWidth: (width: number) => void
}

type View = Pick<State, "notes" | "selectedFolderId" | "sortBy">

/** Notes shown in the middle column for the current folder and sort. */
export function visibleNotes({ notes, selectedFolderId, sortBy }: View): Note[] {
  let list: Note[]
  if (selectedFolderId === TRASH) {
    list = notes.filter((n) => n.deletedAt)
  } else if (selectedFolderId === ALL) {
    list = notes.filter((n) => !n.deletedAt)
  } else {
    list = notes.filter((n) => !n.deletedAt && n.folderId === selectedFolderId)
  }
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned && !a.deletedAt) return a.pinned ? -1 : 1
    if (sortBy === "title") return a.title.localeCompare(b.title)
    return b[sortBy] - a[sortBy]
  })
}

/** Folders in tree order with their depth, for menus. */
export function flattenFolders(
  folders: Folder[],
  parentId: string | null = null,
  depth = 0
): { folder: Folder; depth: number }[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .flatMap((folder) => [
      { folder, depth },
      ...flattenFolders(folders, folder.id, depth + 1),
    ])
}

/** A UUID. `crypto.randomUUID` only exists on https and localhost, so build one by hand elsewhere. */
export function uid(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const attachmentLabel = (a: Attachment) =>
  a.kind === "audio" ? "Voice note" : a.kind === "sketch" ? "Sketch" : "Image"

const thoughtsFolder: Folder = {
  id: THOUGHTS,
  name: "Quick Thoughts",
  parentId: null,
  expanded: true,
}

type Persisted = Pick<
  State,
  | "folders"
  | "notes"
  | "selectedFolderId"
  | "selectedNoteId"
  | "sidebarOpen"
  | "sidebarWidth"
  | "listWidth"
  | "sortBy"
  | "draft"
  | "locationEnabled"
  | "locationAsked"
>

/**
 * IndexedDB rather than localStorage: images, sketches and recordings are stored
 * inline and would blow through localStorage's ~5MB quota. Writes are debounced.
 */
function createStorage(): PersistStorage<Persisted> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: (() => void) | undefined
  const flush = () => {
    clearTimeout(timer)
    pending?.()
    pending = undefined
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush()
    })
  }
  return {
    getItem: async (name) => {
      const stored = await get(name)
      if (stored) return stored
      // Notes saved before the move to IndexedDB.
      const legacy = localStorage.getItem(name)
      return legacy ? JSON.parse(legacy) : null
    },
    setItem: (name, value) => {
      pending = () => void idbSet(name, value)
      clearTimeout(timer)
      timer = setTimeout(flush, 300)
    },
    removeItem: (name) => del(name),
  }
}

/** Like the real app, notes left empty are discarded once you navigate away. */
const dropEmpty = (notes: Note[], keepId?: string | null) =>
  notes.filter((n) => !n.empty || n.id === keepId)

/**
 * A new account starts empty: no sample notes and no folders of its own.
 * Quick Thoughts is the one fixed place, because everything captured on the home
 * screen has to land somewhere; it behaves like All Notes and can't be removed.
 */
function seed(): Pick<State, "folders" | "notes"> {
  return { folders: [thoughtsFolder], notes: [] }
}

/** What a device holds before anyone has used it. */
export function freshLocalState() {
  return {
    ...seed(),
    selectedFolderId: ALL,
    selectedNoteId: null as string | null,
    draft: emptyDraft,
  }
}

export const useNotes = create<State>()(
  persist(
    (set) => ({
      ...seed(),
      selectedFolderId: ALL,
      selectedNoteId: null,
      sidebarOpen: true,
      sidebarWidth: 220,
      listWidth: 280,
      sortBy: "updatedAt",
      view: "home",
      mobilePane: "list",
      draft: emptyDraft,
      locationEnabled: true,
      locationAsked: false,

      answerLocation: (locationEnabled) => set({ locationEnabled, locationAsked: true }),

      setLocationEnabled: (locationEnabled) => set({ locationEnabled }),

      setOriginals: (id, originals, reprocess = true) =>
        set((s) => ({
          notes: s.notes.map((n) => {
            if (n.id !== id) return n
            if (!reprocess) return { ...n, originals, updatedAt: Date.now() }
            // Dropping the enrichment marks the thought as waiting to be processed again.
            const rest = { ...n }
            delete rest.enrichment
            return { ...rest, originals, updatedAt: Date.now() }
          }),
        })),

      setView: (view) => set((s) => ({ view, notes: dropEmpty(s.notes) })),

      setMobilePane: (mobilePane) =>
        set((s) => ({ mobilePane, notes: dropEmpty(s.notes) })),

      setDraftContent: (content, empty) =>
        set((s) => ({ draft: { ...s.draft, content, empty } })),

      addAttachment: (attachment) =>
        set((s) => ({
          draft: {
            ...s.draft,
            attachments: [...s.draft.attachments, { ...attachment, id: uid() }],
          },
        })),

      removeAttachment: (id) =>
        set((s) => ({
          draft: {
            ...s.draft,
            attachments: s.draft.attachments.filter((a) => a.id !== id),
          },
        })),

      captureThought: (written) =>
        set((s) => {
          const { attachments } = s.draft
          const words = written && !written.empty ? written : null
          if (!words && attachments.length === 0) return s
          // A thought with no words still needs a title line, so name it after its first attachment.
          const title = words ? words.title : attachmentLabel(attachments[0])
          const media = attachments
            .map((a) =>
              a.kind === "audio"
                ? `<audio src="${a.src}" data-seconds="${a.seconds ?? 0}"></audio>`
                : `<img src="${a.src}">`
            )
            .join("")
          const now = Date.now()
          const note: Note = {
            id: uid(),
            folderId: THOUGHTS,
            title,
            snippet: words?.snippet || attachments.map(attachmentLabel).join(", "),
            text: words ? words.text : title,
            content: (words ? words.content : `<p>${title}</p>`) + media,
            empty: false,
            pinned: false,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            context: captureContext(
              words
                ? "typed"
                : attachments[0].kind === "audio"
                  ? "voice"
                  : attachments[0].kind,
              s.locationEnabled
            ),
          }
          return { notes: [note, ...s.notes], draft: emptyDraft }
        }),

      openThought: (id) =>
        set((s) => ({
          view: "library",
          // A search result can live in any folder, so open it where it actually is.
          selectedFolderId: s.notes.find((n) => n.id === id)?.folderId ?? THOUGHTS,
          selectedNoteId: id,
          mobilePane: "editor",
        })),

      createFolder: (name, parentId) =>
        set((s) => ({
          folders: [
            ...s.folders.map((f) =>
              f.id === parentId ? { ...f, expanded: true } : f
            ),
            { id: uid(), name, parentId, expanded: true },
          ],
        })),

      renameFolder: (id, name) =>
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        })),

      deleteFolder: (id) =>
        set((s) => {
          if (id === THOUGHTS) return s
          const removed = new Set([id])
          // Folders are stored parent-before-child only by convention, so loop until stable.
          for (let grew = true; grew; ) {
            grew = false
            for (const f of s.folders) {
              if (f.parentId && removed.has(f.parentId) && !removed.has(f.id)) {
                removed.add(f.id)
                grew = true
              }
            }
          }
          const now = Date.now()
          const notes = s.notes.map((n) =>
            removed.has(n.folderId) && !n.deletedAt
              ? { ...n, deletedAt: now, pinned: false }
              : n
          )
          const selectedFolderId = removed.has(s.selectedFolderId)
            ? ALL
            : s.selectedFolderId
          const stillVisible = visibleNotes({ ...s, notes, selectedFolderId })
          return {
            folders: s.folders.filter((f) => !removed.has(f.id)),
            notes,
            selectedFolderId,
            selectedNoteId: stillVisible.some((n) => n.id === s.selectedNoteId)
              ? s.selectedNoteId
              : (stillVisible[0]?.id ?? null),
          }
        }),

      toggleFolder: (id) =>
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, expanded: !f.expanded } : f
          ),
        })),

      selectFolder: (id) =>
        set((s) => {
          const notes = dropEmpty(s.notes)
          const next = { notes, selectedFolderId: id }
          return {
            ...next,
            mobilePane: "list",
            selectedNoteId: visibleNotes({ ...s, ...next })[0]?.id ?? null,
          }
        }),

      createNote: () =>
        set((s) => {
          const inFolder =
            s.selectedFolderId !== ALL && s.selectedFolderId !== TRASH
          const now = Date.now()
          const note: Note = {
            id: uid(),
            folderId: inFolder ? s.selectedFolderId : NO_FOLDER,
            title: "",
            snippet: "",
            text: "",
            content: "",
            empty: true,
            pinned: false,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            context: captureContext("typed", s.locationEnabled),
          }
          return {
            notes: [note, ...dropEmpty(s.notes)],
            selectedNoteId: note.id,
            mobilePane: "editor",
            selectedFolderId: inFolder ? s.selectedFolderId : ALL,
          }
        }),

      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id && n.content !== patch.content
              ? { ...n, ...patch, updatedAt: Date.now() }
              : n
          ),
        })),

      deleteNote: (id) =>
        set((s) => {
          const target = s.notes.find((n) => n.id === id)
          if (!target) return s
          // Deleting from Recently Deleted (or an empty note) removes it for good.
          const notes =
            target.deletedAt || target.empty
              ? s.notes.filter((n) => n.id !== id)
              : s.notes.map((n) =>
                  n.id === id
                    ? { ...n, deletedAt: Date.now(), pinned: false }
                    : n
                )
          if (s.selectedNoteId !== id) return { notes }
          const before = visibleNotes(s)
          const index = before.findIndex((n) => n.id === id)
          const after = visibleNotes({ ...s, notes })
          return {
            notes,
            selectedNoteId: after[Math.min(index, after.length - 1)]?.id ?? null,
          }
        }),

      restoreNote: (id) =>
        set((s) => {
          const notes = s.notes.map((n) =>
            n.id === id
              ? {
                  ...n,
                  deletedAt: null,
                  folderId: s.folders.some((f) => f.id === n.folderId)
                    ? n.folderId
                    : NO_FOLDER,
                }
              : n
          )
          if (s.selectedNoteId !== id) return { notes }
          return {
            notes,
            selectedNoteId: visibleNotes({ ...s, notes })[0]?.id ?? null,
          }
        }),

      togglePin: (id) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, pinned: !n.pinned } : n
          ),
        })),

      moveNote: (id, folderId) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, folderId, deletedAt: null } : n
          ),
        })),

      selectNote: (id) =>
        set((s) => ({
          notes: dropEmpty(s.notes, id),
          selectedNoteId: id,
          mobilePane: "editor",
        })),

      emptyTrash: () =>
        set((s) => {
          const notes = s.notes.filter((n) => !n.deletedAt)
          return {
            notes,
            selectedNoteId: notes.some((n) => n.id === s.selectedNoteId)
              ? s.selectedNoteId
              : null,
          }
        }),

      setSortBy: (sortBy) => set({ sortBy }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setListWidth: (listWidth) => set({ listWidth }),
    }),
    {
      name: "quick-thoughts-notes",
      storage: createStorage(),
      // IndexedDB is async and browser-only, so the app rehydrates explicitly once mounted.
      skipHydration: true,
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<Persisted>) }
        // Drafts saved before the composer became a rich editor were plain text.
        const legacy = merged.draft as Draft & { text?: string }
        if (typeof legacy.content !== "string") {
          const text = legacy.text ?? ""
          merged.draft = {
            content: text.split("\n").map((l) => `<p>${escapeHtml(l)}</p>`).join(""),
            empty: text.trim() === "",
            attachments: legacy.attachments ?? [],
          }
        }
        if (!merged.folders.some((f) => f.id === THOUGHTS)) {
          merged.folders = [thoughtsFolder, ...merged.folders]
        }
        return merged
      },
      partialize: ({ folders, notes, selectedFolderId, selectedNoteId, sidebarOpen, sidebarWidth, listWidth, sortBy, draft, locationEnabled, locationAsked }) => ({
        folders,
        notes,
        selectedFolderId,
        selectedNoteId,
        sidebarOpen,
        sidebarWidth,
        listWidth,
        sortBy,
        draft,
        locationEnabled,
        locationAsked,
      }),
    }
  )
)
