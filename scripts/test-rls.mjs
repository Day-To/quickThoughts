// Proves that one account cannot see or touch another account's data (plan.md phase 1).
// Creates two throwaway accounts, runs the checks, and deletes them again.
//   node --env-file=.env scripts/test-rls.mjs
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options)

let failures = 0
const check = (name, ok, detail = "") => {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : " -> " + detail}`)
}

async function account() {
  const email = `rls-test-${randomUUID()}@example.com`
  const password = randomUUID()
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const client = createClient(url, publicKey, options)
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  return { id: data.user.id, client }
}

const a = await account()
const b = await account()
try {
  const folderId = randomUUID()
  const noteId = randomUUID()
  const inserted = await a.client.from("folders").insert({ id: folderId, name: "Private", kind: "thoughts" })
  check("A can create a folder", !inserted.error, inserted.error?.message)
  const note = await a.client.from("notes").insert({ id: noteId, folder_id: folderId, title: "Secret", text: "Secret sunscreen list" })
  check("A can create a note", !note.error, note.error?.message)
  const own = await a.client.from("notes").select("id, user_id")
  check("A sees their own note, stamped with their id", own.data?.length === 1 && own.data[0].user_id === a.id, JSON.stringify(own.error ?? own.data))

  const peek = await b.client.from("notes").select("id")
  check("B sees none of A's notes", !peek.error && peek.data.length === 0, JSON.stringify(peek.error ?? peek.data))
  const peekFolders = await b.client.from("folders").select("id")
  check("B sees none of A's folders", !peekFolders.error && peekFolders.data.length === 0)
  const forged = await b.client.from("notes").insert({ id: randomUUID(), user_id: a.id, title: "Planted" })
  check("B cannot create a note in A's name", Boolean(forged.error), "insert was accepted")
  const tamper = await b.client.from("notes").update({ title: "Hacked" }).eq("id", noteId).select("id")
  check("B cannot edit A's note", !tamper.error && tamper.data.length === 0, JSON.stringify(tamper.data))
  const wipe = await b.client.from("notes").delete().eq("id", noteId).select("id")
  check("B cannot delete A's note", !wipe.error && wipe.data.length === 0, JSON.stringify(wipe.data))
  const intact = await a.client.from("notes").select("title").eq("id", noteId).single()
  check("A's note is unchanged", intact.data?.title === "Secret", JSON.stringify(intact.data))

  const visitor = createClient(url, publicKey, options)
  const anonymous = await visitor.from("notes").select("id")
  check("A signed-out visitor reads nothing", Boolean(anonymous.error) || anonymous.data.length === 0, JSON.stringify(anonymous.data))

  const path = `${a.id}/${noteId}/test.txt`
  const upload = await a.client.storage.from("media").upload(path, new Blob(["hello"]), { contentType: "text/plain" })
  check("A can upload a file to their own folder", !upload.error, upload.error?.message)
  const steal = await b.client.storage.from("media").download(path)
  check("B cannot download A's file", Boolean(steal.error), "download succeeded")
  const plant = await b.client.storage.from("media").upload(`${a.id}/planted.txt`, new Blob(["x"]), { contentType: "text/plain" })
  check("B cannot upload into A's folder", Boolean(plant.error), "upload succeeded")
  const mine = await a.client.storage.from("media").download(path)
  check("A can download their own file", !mine.error && (await mine.data.text()) === "hello", mine.error?.message)
  await admin.storage.from("media").remove([path])
} finally {
  await admin.auth.admin.deleteUser(a.id)
  await admin.auth.admin.deleteUser(b.id)
  const left = await admin.from("notes").select("id", { count: "exact", head: true }).in("user_id", [a.id, b.id])
  check("Test accounts and their rows are cleaned up", left.count === 0, String(left.count))
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed")
process.exit(failures ? 1 : 0)
