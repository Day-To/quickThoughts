"use client"

import { supabase } from "./supabase"

/**
 * On the device, a note's images, sketches and recordings sit inside its HTML as data
 * URLs, which keeps the app working offline. In the cloud they are separate files in
 * the private `media` bucket and the HTML only points at them:
 *
 *   device:  <img src="data:image/png;base64,....">
 *   cloud:   <img src="media://<note id>/<fingerprint>.png">
 *
 * These two functions convert between the forms as notes are pushed and pulled.
 */

const BUCKET = "media"
const INLINE = /(<(?:img|audio)\b[^>]*?\ssrc=")(data:[^"]+)(")/g
const REMOTE = /(<(?:img|audio)\b[^>]*?\ssrc=")media:\/\/([^"]+)(")/g

/** Files this session already knows are in the bucket, to avoid asking twice. */
const uploaded = new Set<string>()

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
}

/** The same file always gets the same name, so it is uploaded once however often the note syncs. */
function fingerprint(text: string): string {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 2654435761)
    b = Math.imul(b ^ code, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (b >>> 0).toString(16).padStart(8, "0") + (a >>> 0).toString(16).padStart(8, "0") + text.length.toString(16)
}

function fileNameFor(dataUrl: string): string {
  const mime = dataUrl.slice(5, dataUrl.search(/[;,]/))
  return `${fingerprint(dataUrl)}.${EXTENSIONS[mime] ?? "bin"}`
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export type UploadedFile = { path: string; kind: "image" | "audio"; seconds: number | null }

/** Uploads a note's embedded files and returns its HTML with them replaced by references. */
export async function contentForCloud(
  userId: string,
  noteId: string,
  content: string
): Promise<{ content: string; files: UploadedFile[] }> {
  const files: UploadedFile[] = []
  const names = new Map<string, string>()
  for (const [tag, , dataUrl] of content.matchAll(INLINE)) {
    if (names.has(dataUrl)) continue
    const name = fileNameFor(dataUrl)
    names.set(dataUrl, name)
    const path = `${userId}/${noteId}/${name}`
    if (!uploaded.has(path)) {
      const blob = await (await fetch(dataUrl)).blob()
      const { error } = await supabase().storage.from(BUCKET).upload(path, blob, { contentType: blob.type })
      // "Already exists" means an earlier sync uploaded this exact file.
      if (error && !/exists|duplicate/i.test(error.message)) throw error
      uploaded.add(path)
    }
    files.push({
      path,
      kind: tag.startsWith("<audio") ? "audio" : "image",
      seconds: Number(/data-seconds="([\d.]+)"/.exec(tag)?.[1]) || null,
    })
  }
  return {
    content: content.replace(INLINE, (_, before, dataUrl, after) => `${before}media://${noteId}/${names.get(dataUrl)}${after}`),
    files,
  }
}

/**
 * Downloads the files a cloud note points at and returns its HTML with them embedded.
 * `known` is the device's current copy of the note, whose files are reused rather than fetched again.
 */
export async function contentForDevice(userId: string, content: string, known = ""): Promise<string> {
  const references = [...content.matchAll(REMOTE)].map((match) => match[2])
  if (references.length === 0) return content

  const local = new Map<string, string>()
  for (const [, , dataUrl] of known.matchAll(INLINE)) local.set(fileNameFor(dataUrl), dataUrl)

  const resolved = new Map<string, string>()
  for (const reference of new Set(references)) {
    const name = reference.slice(reference.lastIndexOf("/") + 1)
    const reuse = local.get(name)
    if (reuse) {
      resolved.set(reference, reuse)
      continue
    }
    const { data, error } = await supabase().storage.from(BUCKET).download(`${userId}/${reference}`)
    if (error) throw error
    uploaded.add(`${userId}/${reference}`)
    resolved.set(reference, await blobToDataUrl(data))
  }
  return content.replace(REMOTE, (_, before, reference, after) => `${before}${resolved.get(reference)}${after}`)
}

/** Removes every file belonging to notes that were deleted for good. */
export async function removeNoteFiles(userId: string, noteIds: string[]): Promise<void> {
  const storage = supabase().storage.from(BUCKET)
  for (const noteId of noteIds) {
    const { data, error } = await storage.list(`${userId}/${noteId}`)
    if (error) throw error
    if (data.length > 0) {
      const removed = await storage.remove(data.map((file) => `${userId}/${noteId}/${file.name}`))
      if (removed.error) throw removed.error
    }
  }
}
