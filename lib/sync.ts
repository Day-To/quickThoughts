"use client"

import { del, get, set } from "idb-keyval"
import { create } from "zustand"
import { contentForCloud, contentForDevice, removeNoteFiles, type UploadedFile } from "./media-sync"
import { supabase } from "./supabase"
import { NO_FOLDER, THOUGHTS, freshLocalState, uid, useNotes, type Folder, type Note } from "./store"

/**
 * Keeps this device's notes and folders in step with the signed-in user's cloud copy
 * (plan.md §10). The screens only ever read the local store; this module pushes local
 * changes up and merges remote changes in.
 *
 * - Pull: rows written since the last pull, by the server's clock (`synced_at`).
 * - Push: everything changed locally since the last successful push.
 * - Conflicts: the copy with the newer `updated_at` wins, per note.
 *
 * Images, sketches and recordings are embedded in the note on the device but stored as
 * separate files in the cloud; see media-sync.ts.
 */

const STATE_KEY = "quick-thoughts-sync"
const EPOCH = "1970-01-01T00:00:00Z"
const PAGE = 500
const DEBOUNCE = 1500
const POLL = 60_000

/** The one folder every account has. Locally it has a fixed id; remotely, a per-user UUID. */
const BUILTIN: Record<string, "thoughts" | "default"> = {
  [THOUGHTS]: "thoughts",
}

type SyncState = {
  userId: string
  /** Server timestamp of the newest row already pulled. */
  cursor: string
  /** kind -> remote folder id */
  builtin: Partial<Record<"thoughts" | "default", string>>
  dirtyNotes: string[]
  dirtyFolders: string[]
  /** Deleted locally and not yet reported to the server. */
  goneNotes: string[]
  goneFolders: string[]
}

type Status = "off" | "syncing" | "synced" | "error"
export const useSync = create<{ status: Status; lastSynced: number | null }>(() => ({
  status: "off",
  lastSynced: null,
}))

let state: SyncState | null = null
let applyingRemote = false
let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | undefined

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())
const ms = (value: string | null) => (value === null ? null : Date.parse(value))
const save = () => (state ? set(STATE_KEY, state) : del(STATE_KEY))
const add = (list: string[], id: string) => void (list.includes(id) || list.push(id))
const drop = (list: string[], id: string) => {
  const index = list.indexOf(id)
  if (index >= 0) list.splice(index, 1)
}

// ---------- tracking local changes ----------

/** Notes and folders are replaced, never mutated, so a different object means an edit. */
function recordChanges<T extends { id: string }>(before: T[], after: T[], dirty: string[], gone: string[]) {
  const previous = new Map(before.map((item) => [item.id, item]))
  for (const item of after) {
    if (previous.get(item.id) !== item) add(dirty, item.id)
    previous.delete(item.id)
  }
  for (const id of previous.keys()) {
    drop(dirty, id)
    add(gone, id)
  }
}

// ---------- first sync on this device for this account ----------

/**
 * Sample notes and folders have short text ids, which the database (UUID keys) can't
 * hold. On an empty account they are given UUIDs and uploaded like any other note. On an
 * account that already has data they are dropped, so every new device doesn't add
 * another copy of the samples.
 */
function prepareLocalData(keepSamples: boolean) {
  const { notes, folders, selectedFolderId, selectedNoteId } = useNotes.getState()
  const isSample = (id: string) => !isUuid(id) && !(id in BUILTIN)
  const renamed = new Map<string, string>()
  const rename = (id: string) => {
    if (!isSample(id)) return id
    if (!renamed.has(id)) renamed.set(id, uid())
    return renamed.get(id)!
  }
  const keptFolders = folders.filter((f) => keepSamples || !isSample(f.id))
  const keptIds = new Set(keptFolders.map((f) => f.id))
  useNotes.setState({
    folders: keptFolders.map((f) => ({
      ...f,
      id: rename(f.id),
      parentId: f.parentId && keptIds.has(f.parentId) ? rename(f.parentId) : null,
    })),
    notes: notes
      .filter((n) => keepSamples || !isSample(n.id))
      .map((n) => ({
        ...n,
        id: rename(n.id),
        folderId: keptIds.has(n.folderId) ? rename(n.folderId) : NO_FOLDER,
      })),
    selectedFolderId: keptIds.has(selectedFolderId) ? rename(selectedFolderId) : selectedFolderId,
    selectedNoteId: selectedNoteId ? (renamed.get(selectedNoteId) ?? (isSample(selectedNoteId) ? null : selectedNoteId)) : null,
  })
}

async function begin(userId: string) {
  const saved = await get<SyncState>(STATE_KEY)
  const db = supabase()
  if (saved?.userId === userId) {
    state = saved
    // Safety net: if this device holds a different number of notes than the account
    // and has nothing waiting to upload, its copy has fallen out of step (cleared
    // storage, an interrupted sync, a bug). Fetch everything again rather than trust it.
    const nothingPending = [saved.dirtyNotes, saved.dirtyFolders, saved.goneNotes, saved.goneFolders].every((list) => list.length === 0)
    if (nothingPending && saved.cursor !== EPOCH) {
      const { count, error } = await db.from("notes").select("id", { count: "exact", head: true }).is("purged_at", null)
      const held = useNotes.getState().notes.filter((n) => !n.empty).length
      if (!error && count !== null && count !== held) {
        state.cursor = EPOCH
        await save()
      }
    }
    return
  }
  if (saved) {
    // This device last synced a different account. Its notes belong to that account
    // (and are safe in its cloud copy), so they must not be uploaded into this one.
    applyingRemote = true
    useNotes.setState(freshLocalState())
    applyingRemote = false
  }
  const [notes, folders] = await Promise.all([
    db.from("notes").select("id", { count: "exact", head: true }),
    db.from("folders").select("id", { count: "exact", head: true }).is("kind", null),
  ])
  if (notes.error || folders.error) throw notes.error ?? folders.error
  const accountHasData = (notes.count ?? 0) + (folders.count ?? 0) > 0

  applyingRemote = true
  prepareLocalData(!accountHasData)
  applyingRemote = false

  // Everything already on this device is new to the account.
  const local = useNotes.getState()
  state = {
    userId,
    cursor: EPOCH,
    builtin: {},
    dirtyNotes: local.notes.filter((n) => !n.empty).map((n) => n.id),
    dirtyFolders: local.folders.map((f) => f.id),
    goneNotes: [],
    goneFolders: [],
  }
  await save()
}

/** Finds, or creates, this account's built-in folder and remembers its remote id. */
async function ensureBuiltinFolders() {
  if (!state || state.builtin.thoughts) return
  const db = supabase()
  const read = async () => {
    const { data, error } = await db.from("folders").select("id, kind").not("kind", "is", null)
    if (error) throw error
    for (const row of data) state!.builtin[row.kind as "thoughts" | "default"] = row.id
  }
  await read()
  const local = useNotes.getState().folders
  const missing = Object.entries(BUILTIN).filter(([, kind]) => !state!.builtin[kind])
  if (missing.length > 0) {
    // Another device may be creating them at this very moment; the unique index makes
    // one of us lose, and re-reading picks up the winner's rows.
    for (const [localId, kind] of missing) {
      const { error } = await db.from("folders").insert({
        id: uid(),
        kind,
        name: local.find((f) => f.id === localId)?.name ?? kind,
      })
      // 23505 = the other device got there first, which is fine.
      if (error && error.code !== "23505") throw error
    }
    await read()
  }
  await save()
}

const remoteFolderId = (localId: string) => (localId in BUILTIN ? state!.builtin[BUILTIN[localId]]! : localId)

function localFolderId(remoteId: string | null): string | null {
  if (remoteId === null) return null
  if (remoteId === state!.builtin.thoughts) return THOUGHTS
  return remoteId
}

// ---------- pull ----------

type FolderRow = {
  id: string
  name: string
  kind: string | null
  parent_id: string | null
  expanded: boolean
  deleted_at: string | null
  synced_at: string
}
type NoteRow = {
  id: string
  folder_id: string | null
  content: string
  text: string
  title: string
  snippet: string
  pinned: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
  purged_at: string | null
  synced_at: string
  context: Note["context"] | null
  enrichment: Note["enrichment"]
  originals: Note["originals"] | null
}

async function fetchSince<T extends { synced_at: string }>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = []
  let after = state!.cursor
  for (;;) {
    const { data, error } = await supabase()
      .from(table)
      .select(columns)
      .gt("synced_at", after)
      .order("synced_at")
      .limit(PAGE)
    if (error) throw error
    rows.push(...(data as unknown as T[]))
    if (data.length < PAGE) return rows
    after = rows[rows.length - 1].synced_at
  }
}

async function pull() {
  const [folderRows, noteRows] = await Promise.all([
    fetchSince<FolderRow>("folders", "id, name, kind, parent_id, expanded, deleted_at, synced_at"),
    fetchSince<NoteRow>(
      "notes",
      "id, folder_id, content, text, title, snippet, pinned, created_at, updated_at, deleted_at, purged_at, synced_at, context, enrichment, originals"
    ),
  ])
  if (folderRows.length + noteRows.length === 0) return

  const current = useNotes.getState()
  const folders = new Map(current.folders.map((f) => [f.id, f]))
  for (const row of folderRows) {
    const id = localFolderId(row.id)!
    // A folder edited here and not yet pushed keeps its local version.
    if (state!.dirtyFolders.includes(id)) continue
    if (row.deleted_at) {
      if (!(id in BUILTIN)) folders.delete(id)
      continue
    }
    const existing = folders.get(id)
    folders.set(id, {
      id,
      name: row.name,
      parentId: localFolderId(row.parent_id),
      // Open or closed is a per-device preference once the folder exists here.
      expanded: existing?.expanded ?? row.expanded,
    })
  }

  const notes = new Map(current.notes.map((n) => [n.id, n]))
  for (const row of noteRows) {
    const existing = notes.get(row.id)
    const updatedAt = Date.parse(row.updated_at)
    // Newer local edits that haven't been pushed yet win over the incoming row.
    if (existing && state!.dirtyNotes.includes(row.id) && existing.updatedAt >= updatedAt) continue
    if (row.purged_at) {
      notes.delete(row.id)
      drop(state!.dirtyNotes, row.id)
      continue
    }
    const folderId = localFolderId(row.folder_id)
    // Content only changes together with updated_at, so an equal timestamp means the
    // device already has this version (typically our own push coming back).
    const content =
      existing && existing.updatedAt === updatedAt
        ? existing.content
        : await contentForDevice(state!.userId, row.content, existing?.content)
    notes.set(row.id, {
      id: row.id,
      folderId: folderId && folders.has(folderId) ? folderId : NO_FOLDER,
      content,
      text: row.text,
      title: row.title,
      snippet: row.snippet,
      empty: false,
      pinned: row.pinned,
      createdAt: Date.parse(row.created_at),
      updatedAt,
      deletedAt: ms(row.deleted_at),
      ...(row.context && Object.keys(row.context).length > 0 ? { context: row.context } : {}),
      ...(row.enrichment ? { enrichment: row.enrichment } : {}),
      ...(row.originals && row.originals.length > 0 ? { originals: row.originals } : {}),
    })
  }

  // Keep unchanged objects identical so nothing re-renders or is re-marked as edited.
  const same = (a: object | undefined, b: object) =>
    a !== undefined && JSON.stringify(a) === JSON.stringify(b)
  const mergedFolders = [...folders.values()].map((f) => {
    const before = current.folders.find((x) => x.id === f.id)
    return same(before, f) ? before! : f
  })
  const mergedNotes = [...notes.values()].map((n) => {
    const before = current.notes.find((x) => x.id === n.id)
    return same(before, n) ? before! : n
  })

  applyingRemote = true
  useNotes.setState({
    folders: mergedFolders,
    notes: mergedNotes,
    selectedNoteId: current.selectedNoteId && notes.has(current.selectedNoteId) ? current.selectedNoteId : null,
    selectedFolderId:
      isUuid(current.selectedFolderId) && !folders.has(current.selectedFolderId) ? "all" : current.selectedFolderId,
  })
  applyingRemote = false

  const newest = [...folderRows, ...noteRows].reduce((max, row) => (row.synced_at > max ? row.synced_at : max), state!.cursor)
  state!.cursor = newest
  await save()
}

// ---------- push ----------

async function push() {
  const sync = state!
  const batch = {
    dirtyFolders: sync.dirtyFolders,
    dirtyNotes: sync.dirtyNotes,
    goneFolders: sync.goneFolders,
    goneNotes: sync.goneNotes,
  }
  if (Object.values(batch).every((list) => list.length === 0)) return
  // Hand the batch over; edits made while it is in flight collect in fresh lists.
  sync.dirtyFolders = []
  sync.dirtyNotes = []
  sync.goneFolders = []
  sync.goneNotes = []

  try {
    const db = supabase()
    const local = useNotes.getState()
    const now = new Date().toISOString()
    const folderIds = new Set(local.folders.map((f) => f.id))

    const folderRows = local.folders
      .filter((f) => batch.dirtyFolders.includes(f.id))
      .map((f: Folder) => ({
        id: remoteFolderId(f.id),
        name: f.name,
        kind: BUILTIN[f.id] ?? null,
        parent_id: f.parentId && folderIds.has(f.parentId) ? remoteFolderId(f.parentId) : null,
        expanded: f.expanded,
        updated_at: now,
        deleted_at: null,
      }))
    if (folderRows.length > 0) {
      const { error } = await db.from("folders").upsert(folderRows)
      if (error) throw error
    }

    const noteRows = []
    const fileRows: (UploadedFile & { note_id: string })[] = []
    for (const n of local.notes.filter((n: Note) => batch.dirtyNotes.includes(n.id) && !n.empty)) {
      const cloud = await contentForCloud(sync.userId, n.id, n.content)
      fileRows.push(...cloud.files.map((file) => ({ ...file, note_id: n.id })))
      noteRows.push({
        id: n.id,
        folder_id: folderIds.has(n.folderId) ? remoteFolderId(n.folderId) : null,
        content: cloud.content,
        text: n.text,
        title: n.title,
        snippet: n.snippet,
        pinned: n.pinned,
        created_at: iso(n.createdAt),
        updated_at: iso(n.updatedAt),
        deleted_at: iso(n.deletedAt),
        purged_at: null,
        context: n.context ?? {},
        // Only sent once the device has them, so a fresh capture never blanks the server's copy.
        ...(n.originals ? { originals: n.originals } : {}),
      })
    }
    if (noteRows.length > 0) {
      // A batch is sent with one set of columns, and a row lacking `originals` would be
      // sent as null for it. So rows that carry originals go separately from rows that don't.
      for (const rows of [noteRows.filter((row) => "originals" in row), noteRows.filter((row) => !("originals" in row))]) {
        if (rows.length === 0) continue
        const { error } = await db.from("notes").upsert(rows)
        if (error) throw error
      }
    }
    if (noteRows.length > 0) {
      // The server tags a note a few seconds after it lands; come back for the result.
      // Organising takes ~10 s; a web lookup or page fetch can stretch it to ~45 s.
      for (const seconds of [8, 14, 20, 28, 36, 45, 55, 70, 90]) setTimeout(schedule, seconds * 1000)
    }
    if (fileRows.length > 0) {
      const { error } = await db.from("attachments").upsert(fileRows, { onConflict: "note_id,path" })
      if (error) throw error
    }

    const purged = batch.goneNotes.filter(isUuid)
    if (purged.length > 0) {
      // Keep the row as a marker so other devices remove the note too, but not its content.
      const { error } = await db
        .from("notes")
        .update({ purged_at: now, updated_at: now, content: "", text: "", title: "", snippet: "" })
        .in("id", purged)
      if (error) throw error
      await removeNoteFiles(sync.userId, purged)
      await db.from("attachments").delete().in("note_id", purged)
    }

    const removedFolders = batch.goneFolders.filter(isUuid)
    if (removedFolders.length > 0) {
      const { error } = await db.from("folders").update({ deleted_at: now, updated_at: now }).in("id", removedFolders)
      if (error) throw error
    }
  } catch (error) {
    // Put the batch back so it is retried.
    for (const key of Object.keys(batch) as (keyof typeof batch)[]) {
      for (const id of batch[key]) add(sync[key], id)
    }
    throw error
  } finally {
    await save()
  }
}

// ---------- running ----------

async function syncNow(): Promise<void> {
  if (!state) return
  if (running) {
    again = true
    return
  }
  running = true
  useSync.setState({ status: "syncing" })
  try {
    await ensureBuiltinFolders()
    await pull()
    await push()
    useSync.setState({ status: "synced", lastSynced: Date.now() })
  } catch (error) {
    // Usually just offline. Local changes stay queued and the next attempt retries them.
    console.warn("Sync failed; will retry.", error)
    useSync.setState({ status: "error" })
  }
  running = false
  if (again) {
    again = false
    schedule()
  }
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), DEBOUNCE)
}

/**
 * Call when the server has been asked to do something to a note (process it again,
 * say): checks back several times over the next minute and a half for the result.
 */
export function expectUpdates() {
  for (const seconds of [6, 12, 18, 26, 36, 48, 62, 90]) setTimeout(schedule, seconds * 1000)
}

/** Starts syncing for the signed-in user. Returns a function that stops it. */
export function startSync(userId: string): () => void {
  let stopped = false
  const unsubscribe = useNotes.subscribe((next, previous) => {
    if (!state || applyingRemote) return
    if (next.notes === previous.notes && next.folders === previous.folders) return
    recordChanges(previous.notes, next.notes, state.dirtyNotes, state.goneNotes)
    recordChanges(previous.folders, next.folders, state.dirtyFolders, state.goneFolders)
    void save()
    schedule()
  })
  const poll = setInterval(schedule, POLL)
  window.addEventListener("online", schedule)
  window.addEventListener("focus", schedule)

  void begin(userId)
    .then(() => {
      if (!stopped) return syncNow()
    })
    .catch((error) => {
      console.warn("Could not start sync; will retry on the next change.", error)
      useSync.setState({ status: "error" })
    })

  return () => {
    stopped = true
    unsubscribe()
    clearInterval(poll)
    clearTimeout(timer)
    window.removeEventListener("online", schedule)
    window.removeEventListener("focus", schedule)
    state = null
    useSync.setState({ status: "off" })
  }
}

/**
 * Signing out hands the device back: pending changes are pushed first, then the local
 * copy is cleared so the next person to sign in here doesn't inherit these notes.
 * Returns false (and does nothing) if changes could not be saved to the cloud.
 */
export async function signOutOfDevice(): Promise<boolean> {
  clearTimeout(timer)
  await syncNow()
  const unsaved = state && [state.dirtyNotes, state.dirtyFolders, state.goneNotes, state.goneFolders].some((l) => l.length > 0)
  if (unsaved || useSync.getState().status === "error") return false
  await supabase().auth.signOut()
  await del(STATE_KEY)
  applyingRemote = true
  useNotes.setState(freshLocalState())
  applyingRemote = false
  return true
}
