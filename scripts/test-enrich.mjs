// Proves the thought pipeline against the live project with a throwaway account:
// similarity -> merge or link -> enrich (title, body, actions) -> action worker.
//   node --env-file=.env scripts/test-enrich.mjs
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

const email = `enrich-test-${randomUUID()}@example.com`
const password = randomUUID()
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (created.error) throw created.error
const userId = created.data.user.id
const user = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
await user.auth.signInWithPassword({ email, password })

const get = async (id) => (await admin.from("notes").select("id, title, text, content, snippet, enrichment, enrich_status, enriched_hash, originals, purged_at").eq("id", id).single()).data
/** Saves a thought the way the app does, then waits for the pipeline to finish with it. */
async function add(text, { folder, settleActions = true } = {}) {
  const id = randomUUID()
  const t0 = Date.now()
  const { error } = await user.from("notes").insert({ id, folder_id: folder ?? null, title: text.split("\n")[0], text, content: `<p>${text}</p>` })
  if (error) throw error
  for (let i = 0; i < 80; i++) {
    await wait(2000)
    const row = await get(id)
    if (row.purged_at) return { id, row, seconds: ((Date.now() - t0) / 1000).toFixed(0) }
    const running = (row.enrichment?.actions ?? []).some((a) => a.status === "running")
    if (row.enrich_status === "done" && !(settleActions && running)) return { id, row, seconds: ((Date.now() - t0) / 1000).toFixed(0) }
  }
  throw new Error("timed out waiting for: " + text.slice(0, 40))
}

try {
  const open = await fetch(`${url}/functions/v1/enrich`, { method: "POST", body: "[]", headers: { "Content-Type": "application/json" } })
  check("The function refuses callers without the shared secret", open.status === 403, String(open.status))

  const thoughts = randomUUID()
  await user.from("folders").insert({ id: thoughts, name: "Quick Thoughts", kind: "thoughts" })

  // --- a first thought: enrichment ---
  const a = await add("If you are ever buying sunscreen, buy from these brands - lakme, minimalist, aqualogica(best), dermaco", { folder: thoughts })
  const e = a.row.enrichment
  console.log(`     (${a.seconds}s) title: "${e.title}"`)
  console.log(`     summary: ${e.summary}`)
  console.log(`     points: ${JSON.stringify(e.points)}`)
  console.log(`     checklist: ${JSON.stringify(e.checklist)}`)
  console.log(`     actions: ${JSON.stringify(e.actions.map((x) => ({ type: x.type, label: x.label, status: x.status, answer: x.result?.answer?.slice(0, 160), sources: x.result?.sources?.length })))}`)
  console.log(`     note text now:\n${a.row.text.split("\n").map((l) => "       | " + l).join("\n")}`)
  check("The organised title and body are written into the note itself", a.row.title === e.title && a.row.content.startsWith(`<p>${e.title.replace(/&/g, "&amp;")}</p>`) && a.row.snippet === e.summary && /aqualogica/i.test(a.row.text))
  check("...and the words the user captured are kept as the original", a.row.originals.length === 1 && a.row.originals[0].text.startsWith("If you are ever buying sunscreen"))
  check("Sections are separated by blank lines", (a.row.content.match(/<p><\/p>/g) ?? []).length >= 2, a.row.content.slice(0, 300))
  check("Enrichment writes a title, a summary and tags", Boolean(e.title && e.title.split(" ").length <= 8 && e.summary && e.tags?.length >= 2))
  check("The body keeps the user's facts (all four brands, and which is best)", /aqualogica/i.test(JSON.stringify([e.summary, e.points, e.checklist])) && ["lakme", "minimalist", "dermaco"].every((b) => new RegExp(b, "i").test(JSON.stringify([e.summary, e.points, e.checklist, e.entities]))))
  check("No action is left running", e.actions.every((x) => x.status !== "running"))
  if (e.actions.some((x) => x.type === "research")) {
    const r = e.actions.find((x) => x.type === "research")
    const products = r.result?.products ?? []
    for (const p of products) console.log(`       product: ${p.brand} | ${p.name} | ${p.price} | ${p.store} | image: ${p.image ? "yes" : "no"} | ${p.url.slice(0, 60)}`)
    check("The web lookup found a product for most of the brands, each with a name, store and link", r.status === "done" && products.length >= 3 && products.every((p) => p.brand && p.name && p.store && /^https:\/\//.test(p.url)), JSON.stringify(r).slice(0, 300))
    check("...at least two of them with a picture and a price", products.filter((p) => p.image && p.price).length >= 2)
    check("...shown in the note as a product slider under its own heading", a.row.content.includes('<div data-type="products" data-products="') && a.row.content.includes(`<h3>${r.label}</h3>`))
    check("...with sources in a separate, folded section rather than in the text", a.row.content.includes('<div data-type="sources" data-sources="') && !/Sources:/.test(a.row.text) && r.result.sources.length >= 1)
    check("...and the products are part of the note's searchable text", products.slice(0, 2).every((p) => a.row.text.includes(p.name)))
  } else console.log("     (the model proposed no web lookup for this thought)")

  // --- case 1: very similar -> merged ---
  const b = await add("Also add Neutrogena Ultra Sheer to my list of sunscreen brands to buy", { folder: thoughts })
  // The later thought disappears first; the surviving one is rewritten a few seconds after.
  let merged = await get(a.id)
  for (let i = 0; i < 30 && !/neutrogena/i.test(JSON.stringify(merged.enrichment)); i++) {
    await wait(2000)
    merged = await get(a.id)
  }
  console.log(`     (${b.seconds}s) merged title: "${merged.enrichment.title}" | originals: ${merged.originals.length}`)
  if (!b.row.purged_at) console.log(`     scores for the Neutrogena thought: ${JSON.stringify(b.row.enrichment?.similarity?.map((x) => x.score))}`)
  check("Case 1: a thought about the same list is merged into the earlier one", Boolean(b.row.purged_at) && /Neutrogena/i.test(merged.text) && /lakme/i.test(merged.text), JSON.stringify({ purged: b.row.purged_at, text: merged.text.slice(0, 120) }))
  check("...both captures are kept as originals, oldest first", merged.originals.length === 2 && /lakme/i.test(merged.originals[0].text) && /Neutrogena/i.test(merged.originals[1].text))
  check("...and the merged thought is re-enriched to cover both", /neutrogena/i.test(JSON.stringify(merged.enrichment)) && /aqualogica/i.test(JSON.stringify(merged.enrichment)), JSON.stringify(merged.enrichment).slice(0, 300))

  // --- case 2: related -> linked ---
  const c = await add("Reapply sunscreen every two hours when outdoors, and use SPF 50 on beach days", { folder: thoughts })
  const linksOf = async (id) => (await admin.from("note_links").select("to_id, score").eq("from_id", id)).data
  const cLinks = await linksOf(c.id)
  console.log(`     (${c.seconds}s) scores: ${JSON.stringify(c.row.enrichment?.similarity?.map((x) => x.score))} links: ${JSON.stringify(cLinks.map((l) => l.score))}`)
  check("Case 2: a related thought is kept separate and linked, both ways", !c.row.purged_at && cLinks.some((l) => l.to_id === a.id && l.score >= 0.6 && l.score < 0.9) && (await linksOf(a.id)).some((l) => l.to_id === c.id), JSON.stringify(cLinks))

  // --- case 3: unrelated -> nothing ---
  const d = await add("Call the dentist on Monday morning about the chipped tooth", { folder: thoughts })
  console.log(`     dentist scores: ${JSON.stringify(d.row.enrichment?.similarity?.map((x) => x.score))} checklist: ${JSON.stringify(d.row.enrichment.checklist)}`)
  check("Case 3: an unrelated thought is neither merged nor linked", !d.row.purged_at && (await linksOf(d.id)).length === 0)
  check("...and it gets a checklist, being something to do", d.row.enrichment.checklist?.items.length >= 1 && d.row.enrichment.has_todos === true, JSON.stringify(d.row.enrichment.checklist))

  // --- editing the written-up text must not trigger a rewrite ---
  const edited = '<p>Dentist</p><p>My own words now, typed by hand.</p>'
  await user.from("notes").update({ content: edited, text: "Dentist\nMy own words now, typed by hand.", title: "Dentist", updated_at: new Date().toISOString() }).eq("id", d.id)
  await wait(25000)
  const afterEdit = await get(d.id)
  check("Editing the note's text is left alone (no reprocessing)", afterEdit.content === edited && afterEdit.enriched_hash === d.row.enriched_hash, afterEdit.content.slice(0, 120))

  // --- editing the original reprocesses the thought ---
  await user.from("notes").update({ originals: [{ at: afterEdit.originals[0].at, text: "Call the dentist on Tuesday afternoon about the wisdom tooth" }], updated_at: new Date().toISOString() }).eq("id", d.id)
  let reprocessed = afterEdit
  for (let i = 0; i < 30 && !/wisdom/i.test(reprocessed.text); i++) {
    await wait(2000)
    reprocessed = await get(d.id)
  }
  console.log(`     after editing the original: "${reprocessed.title}" / ${reprocessed.snippet}`)
  check("Editing the original thought reprocesses and rewrites the note", /wisdom/i.test(reprocessed.text) && /tuesday/i.test(reprocessed.text) && !/typed by hand/.test(reprocessed.text) && reprocessed.enriched_hash !== d.row.enriched_hash, reprocessed.text.slice(0, 200))

  // --- only quick thoughts merge ---
  const f = await add("Sunscreen brands to buy: lakme, minimalist, aqualogica (best), dermaco, neutrogena")
  check("A near-identical note outside Quick Thoughts is not merged", !f.row.purged_at && !(await get(a.id)).purged_at)
  check("...and an ordinary note's own words are never rewritten, though it is tagged", f.row.content === `<p>${f.row.text}</p>` && f.row.originals.length === 0 && f.row.enrichment.tags.length >= 2, f.row.content.slice(0, 120))

  // --- action worker: reading a linked page ---
  const g = await add("Read this later https://example.com", { folder: thoughts })
  const fetched = g.row.enrichment.actions.find((x) => x.type === "fetch_link")
  console.log(`     (${g.seconds}s) link action: ${JSON.stringify(fetched)?.slice(0, 260)}`)
  check("...and the page is added to the note as a link", g.row.content.includes('<a href="https://example.com'), g.row.content.slice(-300))
  check("A link in a thought is fetched and summarised by the action worker", fetched?.status === "done" && /example/i.test(fetched.result.title) && fetched.result.summary.length > 10)

  const h = await add("Check http://localhost:3000/admin and http://192.168.1.1/ later", { folder: thoughts })
  check("Two different links to read later are not merged into one thought", !h.row.purged_at && !(await get(g.id)).purged_at)
  check("Private and local addresses are refused", (h.row.enrichment?.actions ?? []).filter((x) => x.type === "fetch_link").length > 0 && h.row.enrichment.actions.filter((x) => x.type === "fetch_link").every((x) => x.status === "failed"), JSON.stringify(h.row.enrichment?.actions))

  const seen = await user.from("notes").select("enrichment, originals").eq("id", a.id).single()
  check("The user can read their own enrichment and originals", Boolean(seen.data?.enrichment?.title && seen.data.originals.length === 2))
} finally {
  await admin.auth.admin.deleteUser(userId)
  const left = await admin.from("notes").select("id", { count: "exact", head: true }).eq("user_id", userId)
  check("Test account and its rows are cleaned up", left.count === 0, String(left.count))
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed")
process.exit(failures ? 1 : 0)
