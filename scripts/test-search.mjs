// Proves search (plan.md phase 4) against the live project with a throwaway account.
//   node --env-file=.env scripts/test-search.mjs
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = "") => {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : " -> " + detail}`)
}
async function account() {
  const email = `search-test-${randomUUID()}@example.com`
  const password = randomUUID()
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
  await client.auth.signInWithPassword({ email, password })
  return { id: created.data.user.id, client }
}

const DAY = 86_400_000
const now = new Date()
const clock = {
  timezone: "Asia/Kolkata",
  today: now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  weekday: now.toLocaleDateString("en", { weekday: "long", timeZone: "Asia/Kolkata" }),
}
const a = await account()
const b = await account()
try {
  const note = (key, daysAgo, title, text = "") => ({ key, row: { id: randomUUID(), title, text: `${title}\n${text}`.trim(), content: "", created_at: new Date(now - daysAgo * DAY).toISOString(), updated_at: new Date(now - daysAgo * DAY).toISOString() } })
  const notes = [
    note("sunscreen", 2, "If you are ever buying sunscreen, buy from these brands", "lakme, minimalist, aqualogica (best), dermaco"),
    note("spf", 20, "SPF tip", "Reapply SPF 50 every two hours outdoors; Aqualogica doesn't leave a white cast"),
    note("dentist", 1, "Book dentist appointment", "Call the clinic on Monday morning about the chipped tooth"),
    note("lisbon", 10, "Book flights to Lisbon for the March trip", "Check TAP and compare with a stopover in Dubai"),
    note("pasta", 40, "Dinner idea: lemon pasta with garlic and chilli"),
    note("billing", 3, "Standup: ship the billing dashboard before Friday"),
    note("predictions", 12, "Check if predictions are true - 26- new business, 27 - wealth accumulation, 28 - wedding, 28 - house , 32 - big house"),
    note("insurance", 15, "Take term insurance after your salary hike."),
  ]
  const keyOf = Object.fromEntries(notes.map((n) => [n.row.id, n.key]))
  const inserted = await a.client.from("notes").insert(notes.map((n) => n.row))
  check("Notes saved", !inserted.error, inserted.error?.message)
  for (let i = 0; i < 45; i++) {
    const { count } = await admin.from("notes").select("id", { count: "exact", head: true }).eq("user_id", a.id).eq("enrich_status", "done")
    if (count === notes.length) break
    await wait(2000)
  }

  const search = async (client, query) => {
    const t = Date.now()
    const { data, error } = await client.functions.invoke("search", { body: { query, ...clock } })
    if (error) return { error, keys: [], ms: Date.now() - t }
    return { ...data, keys: data.results.map((r) => keyOf[r.id]), ms: Date.now() - t }
  }
  const show = (label, r) => console.log(`     "${label}" (${r.ms}ms) topic=${JSON.stringify(r.filters?.topic)} dates=${r.filters?.from_date ?? "-"}..${r.filters?.to_date ?? "-"} type=${r.filters?.type ?? "-"} related=[${(r.filters?.related ?? []).join(", ")}]\n       timing ${JSON.stringify(r.timing ?? {})}\n       -> ${r.results?.map((x) => `${keyOf[x.id]} ${Math.round(x.score * 100)}`).join(", ") || "(nothing)"}`)

  let r = await search(a.client, "sunscreen"); show("sunscreen", r)
  check("A word finds the notes about it, ahead of anything else", r.keys.slice(0, 2).sort().join() === "spf,sunscreen", r.keys.join())
  check("...and leaves out unrelated notes", !r.keys.includes("pasta") && !r.keys.includes("billing") && !r.keys.includes("lisbon"), r.keys.join())

  r = await search(a.client, "protecting my skin from the sun"); show("protecting my skin from the sun", r)
  check("A description with none of the note's words still finds it (meaning)", ["sunscreen", "spf"].includes(r.keys[0]), r.keys.join())

  // Loose, abstract searches: none of these words appear in the predictions note.
  for (const query of ["life", "prophecy", "anything about my life?", "future"]) {
    r = await search(a.client, query); show(query, r)
    check(`"${query}" finds the note of life predictions`, r.keys.includes("predictions"), r.keys.join())
    check(`...without dragging in the pasta or the dentist`, !r.keys.includes("pasta") && !r.keys.includes("dentist"), r.keys.join())
  }
  r = await search(a.client, "money"); show("money", r)
  check("\"money\" finds the insurance and wealth notes", r.keys.includes("insurance") && r.keys.includes("predictions"), r.keys.join())

  r = await search(a.client, "last 7 days"); show("last 7 days", r)
  check("A date-only query returns exactly the notes in that range, newest first", r.keys.join() === "dentist,sunscreen,billing", r.keys.join())

  r = await search(a.client, "sunscreen in the last 7 days"); show("sunscreen in the last 7 days", r)
  check("Topic and date together", r.keys.join() === "sunscreen", r.keys.join())

  r = await search(a.client, "do I have any thoughts related to sunscreen"); show("do I have any thoughts related to sunscreen", r)
  check("A full question works like its topic", r.keys[0] === "sunscreen" && r.keys.includes("spf") && !r.keys.includes("pasta"), r.keys.join())

  r = await search(a.client, "travel plans this month"); show("travel plans this month", r)
  check("\"this month\" + topic", r.keys[0] === "lisbon", r.keys.join())

  r = await search(a.client, "my todos"); show("my todos", r)
  check("Asking for a kind of note filters by type", r.keys.includes("dentist") && !r.keys.includes("pasta"), r.keys.join())

  r = await search(a.client, "xyzzy flurbo quantum llama"); show("nonsense", r)
  check("Nonsense returns nothing rather than everything", r.keys.length === 0, r.keys.join())

  r = await search(b.client, "sunscreen")
  check("Another account searching the same word gets nothing", !r.error && r.keys.length === 0, JSON.stringify(r.keys))

  const anonymous = await fetch(`${url}/functions/v1/search`, { method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }, body: JSON.stringify({ query: "sunscreen" }) })
  check("A signed-out caller is refused", anonymous.status === 401, String(anonymous.status))
} finally {
  await admin.auth.admin.deleteUser(a.id)
  await admin.auth.admin.deleteUser(b.id)
  const left = await admin.from("notes").select("id", { count: "exact", head: true }).in("user_id", [a.id, b.id])
  check("Test accounts and their rows are cleaned up", left.count === 0, String(left.count))
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed")
process.exit(failures ? 1 : 0)
