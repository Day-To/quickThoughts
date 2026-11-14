// Proves which model writes a thought up, and that a rerun can be requested by name.
// Uses a throwaway account. Skips web lookups unless run with --lookups, because those
// are the expensive part.
//   node --env-file=.env scripts/test-writers.mjs [--lookups] [--expect=<model>]
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const expected = process.argv.find((a) => a.startsWith("--expect="))?.slice(9) ?? "claude-opus-5-5"
const lookups = process.argv.includes("--lookups")
let failures = 0
const check = (name, ok, detail = "") => {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : " -> " + detail}`)
}

const email = `writers-test-${randomUUID()}@example.com`
const password = randomUUID()
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (created.error) throw created.error
const userId = created.data.user.id
const user = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
await user.auth.signInWithPassword({ email, password })
const get = async (id) => (await admin.from("notes").select("title, snippet, text, content, enrichment, enrich_status, enrich_request").eq("id", id).single()).data
const settled = (row) => row.enrich_status === "done" && row.enrichment?.written_at && !(row.enrichment.actions ?? []).some((a) => a.status === "running")
async function until(id, done, label) {
  const t0 = Date.now()
  for (let i = 0; i < 90; i++) {
    await wait(2000)
    const row = await get(id)
    if (done(row)) return { row, seconds: ((Date.now() - t0) / 1000).toFixed(0) }
  }
  throw new Error("timed out: " + label)
}

try {
  const thoughts = randomUUID()
  await user.from("folders").insert({ id: thoughts, name: "Quick Thoughts", kind: "thoughts" })
  const add = async (text) => {
    const id = randomUUID()
    const { error } = await user.from("notes").insert({ id, folder_id: thoughts, title: text, text, content: `<p>${text}</p>` })
    if (error) throw error
    return id
  }

  // A thought with nothing to look up: just the write-up.
  const dentist = await add("Call the dentist on Monday morning about the chipped tooth")
  const first = await until(dentist, settled, "first write-up")
  console.log(`     (${first.seconds}s) "${first.row.title}" by ${first.row.enrichment.written_by}${first.row.enrichment.fallback ? " | fallback: " + first.row.enrichment.fallback : ""}`)
  check(`A new thought is written up by ${expected}`, first.row.enrichment.written_by === expected, first.row.enrichment.written_by)
  check("...into a proper note (title, summary, to-do)", Boolean(first.row.title && first.row.snippet && first.row.enrichment.checklist?.items.length >= 1))
  if (expected.startsWith("claude")) check("...with no fallback recorded", first.row.enrichment.fallback === null, first.row.enrichment.fallback)
  else check("...and the reason Claude wasn't used is recorded", Boolean(first.row.enrichment.fallback), String(first.row.enrichment.fallback))

  if (expected.startsWith("claude")) {
    // The button: ask for the whole flow again with Claude Fable 5.2.
    const before = first.row.enrichment.written_at
    const asked = await user.from("notes").update({ enrich_request: { model: "claude-fable-5-2", at: new Date().toISOString() } }).eq("id", dentist)
    check("The user can request a rerun on their own thought", !asked.error, asked.error?.message)
    const rerun = await until(dentist, (row) => settled(row) && row.enrichment.written_at !== before, "rerun")
    console.log(`     (${rerun.seconds}s) "${rerun.row.title}" by ${rerun.row.enrichment.written_by}`)
    check("The rerun is written by claude-fable-5-2", rerun.row.enrichment.written_by === "claude-fable-5-2", rerun.row.enrichment.written_by)
    check("...and the request is cleared afterwards", rerun.row.enrich_request === null, JSON.stringify(rerun.row.enrich_request))

    const bogus = await user.from("notes").update({ enrich_request: { model: "some-other-model", at: new Date().toISOString() } }).eq("id", dentist)
    await wait(20000)
    const after = await get(dentist)
    check("A request naming a model that isn't allowed changes nothing", !bogus.error && after.enrichment.written_at === rerun.row.enrichment.written_at)
  }

  if (lookups) {
    const link = await add("Read this later https://example.com")
    const read = await until(link, settled, "page fetch")
    const fetched = read.row.enrichment.actions.find((a) => a.type === "fetch_link")
    console.log(`     (${read.seconds}s) link: ${fetched?.status} by ${fetched?.by} | ${String(fetched?.result?.summary).slice(0, 90)}`)
    check("A linked page is read and its link added to the note", fetched?.status === "done" && read.row.content.includes('<a href="https://example.com'))

    const sunscreen = await add("If you are ever buying sunscreen, buy from these brands - lakme, minimalist, aqualogica(best), dermaco")
    const found = await until(sunscreen, settled, "product lookup")
    const action = found.row.enrichment.actions.find((a) => a.type === "research")
    const products = action?.result?.products ?? []
    console.log(`     (${found.seconds}s) lookup: ${action?.status} by ${action?.by}`)
    for (const p of products) console.log(`       ${p.brand} | ${p.name} | ${p.price} | image: ${p.image ? "yes" : "no"}`)
    check(`The product lookup is done by ${expected}`, action?.by === expected, String(action?.by))
    check("...and finds products with pictures, shown as a slider", products.length >= 3 && products.filter((p) => p.image).length >= 2 && found.row.content.includes('data-type="products"'))
  }
} finally {
  await admin.auth.admin.deleteUser(userId)
  const left = await admin.from("notes").select("id", { count: "exact", head: true }).eq("user_id", userId)
  check("Test account and its rows are cleaned up", left.count === 0, String(left.count))
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed")
process.exit(failures ? 1 : 0)
