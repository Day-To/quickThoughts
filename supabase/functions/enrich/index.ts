// The thought pipeline (plan.md §6). Called by the database with queued notes. For each:
//
//   1. Similarity: find the user's closest earlier notes and score each 0-100.
//        90+   and both are quick thoughts -> merge the new thought into the earlier one
//        60-89 -> link the two
//   2. Enrich: the LLM writes a title, a body (summary, pointers, checklist) and
//      proposes actions, plus the tags used for search. For a quick thought the title
//      and body are written INTO the note, which the user can then edit freely; the
//      words they captured are kept in `originals`.
//   3. Actions: a small worker carries the actions out (fetch a linked page, look
//      something up on the web) and adds what it found to the note.
//   4. Embed the result for search.
//
// A quick thought is only processed again when its ORIGINALS change. Editing the
// written-up text just refreshes its search embedding. Ordinary notes are never
// rewritten: they only get tags, an embedding and links.
import { createClient } from "npm:@supabase/supabase-js@2"
import { claudeEnrich, claudeFacts, claudeProducts, claudeSummarise, ClaudeUnavailable, type ClaudeModel } from "./claude.ts"

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!
const MODEL = Deno.env.get("OPENAI_ENRICH_MODEL") || "gpt-6-luna"
// ---------- who does the writing ----------
//
// Writing a thought up, summarising a page and web lookups go to Claude first and fall
// back to the OpenAI model above when Claude can't be used (most importantly when the
// Anthropic account has run out of credits). The merge / link judge and embeddings are
// always OpenAI.
type Writer = ClaudeModel | "openai"
const CLAUDE_WRITER = (Deno.env.get("ANTHROPIC_WRITER_MODEL") || "claude-opus-5-5") as ClaudeModel
const DEFAULT_WRITERS: Writer[] = [CLAUDE_WRITER, "openai"]
/** Models a user may ask for by name when reprocessing a thought. */
const RERUN_MODELS: ClaudeModel[] = ["claude-fable-5-2"]
// Once Anthropic says the credits are gone, stop asking for a while instead of failing on every note.
let claudeOutOfCreditsUntil = 0

type Written<T> = { value: T; by: string; fallback: string | null }

/** Runs `run` with each writer in turn until one succeeds; reports who did it and why any were skipped. */
async function write<T>(writers: Writer[], run: (writer: Writer) => Promise<T>): Promise<Written<T>> {
  let fallback: string | null = null
  for (const writer of writers) {
    if (writer === "openai") return { value: await run(writer), by: MODEL, fallback }
    if (Date.now() < claudeOutOfCreditsUntil) {
      fallback ??= "Claude is out of credits"
      continue
    }
    try {
      return { value: await run(writer), by: writer, fallback }
    } catch (error) {
      if (error instanceof ClaudeUnavailable && error.outOfCredits) {
        claudeOutOfCreditsUntil = Date.now() + 10 * 60_000
        fallback ??= "Claude is out of credits"
      } else {
        fallback ??= `${writer} failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200)
      }
      console.error("writer unavailable, trying the next one", writer, error)
    }
  }
  throw new Error(fallback ?? "no writer available")
}

// The lightest reasoning setting each model family accepts: GPT-5 models call it
// "minimal"; GPT-6 models reject that and call it "none".
const lightest = (model: string) => (model.startsWith("gpt-5") ? "minimal" : "none")
// The model that decides whether two notes are the same thought. It can be set
// separately because that decision needs consistency more than speed.
const JUDGE_MODEL = Deno.env.get("OPENAI_JUDGE_MODEL") || "gpt-6-luna"
const EMBEDDING_MODEL = "text-embedding-3-small"
const MAX_ATTEMPTS = 5

// Similarity is judged by the LLM on a 0-100 scale. Embedding distance only shortlists
// candidates: its raw numbers don't behave like percentages (two notes plainly about
// the same subject score about 0.55), so thresholds of 90 and 60 can't be applied to it.
const MERGE_AT = 90
const LINK_AT = 60
const CANDIDATE_SIMILARITY = 0.4
const CANDIDATES = 3
// A second opinion for LINKS only. The judge is steady about merging and about
// unrelated notes, but wavers on "related" (the same pair scored 70 five times and
// 35 three times). Embeddings are steady there: related notes measured 0.54-0.59,
// unrelated ones 0.39 or less. So a strong embedding match links two notes even when
// the judge's score dips. It never causes a merge.
const LINK_SIMILARITY = 0.5

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
})

type Job = { msg_id: number; id: string; read_ct: number }
type NoteRow = {
  id: string
  user_id: string
  folder_id: string | null
  title: string
  text: string
  content: string
  context: Record<string, unknown> | null
  originals: { at: string; text: string; html?: string }[]
  enrich_request: { model?: string; at?: string } | null
  enriched_hash: string | null
  purged_at: string | null
  created_at: string
}
type Action = {
  type: "fetch_link" | "research"
  /** For research: whether to return products or plain facts. */
  kind?: "products" | "facts"
  label: string
  input: string
  status: "running" | "done" | "failed"
  /** The model that carried the action out. */
  by?: string
  result?: Record<string, unknown>
}

// ---------- OpenAI ----------

async function openai(path: string, body: unknown) {
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(`OpenAI ${path}: ${json.error?.message ?? response.status}`)
  return json
}

async function structured<T>(name: string, schema: unknown, system: string, user: string, effort?: string, model = MODEL): Promise<T> {
  const completion = await openai("chat/completions", {
    model,
    reasoning_effort: effort ?? lightest(model),
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  })
  return JSON.parse(completion.choices[0].message.content) as T
}

async function embed(input: string): Promise<string> {
  const embedded = await openai("embeddings", { model: EMBEDDING_MODEL, input })
  return JSON.stringify(embedded.data[0].embedding)
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// ---------- step 1: similarity ----------

async function judgeSimilarity(thought: string, others: string[]): Promise<number[]> {
  const { scores } = await structured<{ scores: number[] }>(
    "similarity",
    {
      type: "object",
      additionalProperties: false,
      required: ["scores"],
      properties: { scores: { type: "array", items: { type: "integer" } } },
    },
    [
      "A person keeps quick notes. Score how similar a NEW note is to each EARLIER note, 0 to 100.",
      "90-100: they belong in ONE note. The new note restates the earlier one, adds an item to the very same list, corrects it, or updates the same specific thing.",
      "60-89: about the same specific subject (the same kind of product, the same person, project, place or topic) but making a point of its own. Worth cross-referencing, not combining. If both notes are plainly about the same specific subject, score at least 65.",
      "0-59: different subjects, even if they share a broad area such as shopping or health, or are phrased alike.",
      "Being the same KIND of note is not enough to merge: two different links to read later, two different errands, two different people to call are separate notes (below 60 unless they share a subject).",
      "Examples:",
      'EARLIER "Good coffee beans: Blue Tokai, Subko" / NEW "add Third Wave to my coffee beans list" -> 95 (adds to the same list)',
      'EARLIER "Gift ideas for mum: scarf, tea set" / NEW "mum might also like a foot massager" -> 93 (same list)',
      'EARLIER "Good coffee beans: Blue Tokai, Subko" / NEW "grind coffee coarser for the french press" -> 70 (same subject, separate point)',
      'EARLIER "Good coffee beans: Blue Tokai, Subko. Also add Third Wave" / NEW "store coffee beans in an airtight jar" -> 70 (same subject, separate point)',
      'EARLIER "Read this later https://a.example/post" / NEW "check https://b.example/docs later" -> 30 (different links)',
      'EARLIER "Call the dentist on Monday" / NEW "Call the plumber on Monday" -> 20 (different errands)',
      'EARLIER "Good coffee beans: Blue Tokai, Subko" / NEW "buy oat milk and eggs" -> 15',
      "Return one integer per earlier note, in the same order.",
    ].join("\n"),
    `NEW note:\n${thought.slice(0, 1500)}\n\n` +
      others.map((text, i) => `EARLIER note ${i + 1}:\n${text.slice(0, 1500)}`).join("\n\n"),
    // Worth a little thought: this decides whether two notes are combined.
    "low",
    JUDGE_MODEL
  )
  return others.map((_, i) => Math.max(0, Math.min(100, Math.round(Number(scores[i] ?? 0)))))
}

// ---------- step 2: enrichment ----------

const ENRICH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "points", "checklist_heading", "checklist_items", "type", "category", "tags", "entities", "has_todos", "research"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    points: { type: "array", items: { type: "string" } },
    checklist_heading: { type: ["string", "null"] },
    checklist_items: { type: "array", items: { type: "string" } },
    type: { type: "string", enum: ["idea", "recommendation", "todo", "reminder", "fact", "journal", "link", "other"] },
    category: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    entities: { type: "array", items: { type: "string" } },
    has_todos: { type: "boolean" },
    research: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["label", "query", "kind"],
      properties: { label: { type: "string" }, query: { type: "string" }, kind: { type: "string", enum: ["products", "facts"] } },
    },
  },
}

type Enriched = {
  title: string
  summary: string
  points: string[]
  checklist_heading: string | null
  checklist_items: string[]
  type: string
  category: string
  tags: string[]
  entities: string[]
  has_todos: boolean
  research: { label: string; query: string; kind: "products" | "facts" } | null
}

/** The categories and tags this user already has, most used first, so the LLM reuses them. */
async function vocabulary(userId: string) {
  const { data } = await db
    .from("notes")
    .select("enrichment")
    .eq("user_id", userId)
    .not("enrichment", "is", null)
    .order("created_at", { ascending: false })
    .limit(300)
  const count = (values: string[]) => {
    const tally = new Map<string, number>()
    for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)
    return [...tally].sort((a, b) => b[1] - a[1]).map(([value]) => value)
  }
  // deno-lint-ignore no-explicit-any
  const rows = (data ?? []).map((row: any) => row.enrichment as { category?: string; tags?: string[] })
  return {
    categories: count(rows.map((r) => r.category ?? "").filter(Boolean)).slice(0, 30),
    tags: count(rows.flatMap((r) => r.tags ?? [])).slice(0, 80),
  }
}

function describeContext(context: Record<string, unknown>) {
  const parts = [
    context.weekday && context.part_of_day ? `Written on a ${context.weekday} ${context.part_of_day}` : null,
    context.place ? `at ${context.place}` : null,
    context.source && context.source !== "typed" ? `(captured as ${context.source})` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" ") + "." : ""
}

async function enrich(note: NoteRow, originals: { at: string; text: string }[], writers: Writer[]): Promise<Written<Enriched>> {
  const known = await vocabulary(note.user_id)
  const source =
    originals.length > 1
      ? "The person wrote these at different times about the same thing. Write ONE combined note covering all of them.\n\n" +
        originals.map((o) => `[${o.at.slice(0, 10)}] ${o.text}`).join("\n\n")
      : originals[0].text
  const system = [
      "You turn a person's quick, rough thought into a tidy note they will be glad to find later.",
      "Use only what the thought says. Never add facts, brands, numbers or advice that are not in it. Keep their meaning and preferences exactly.",
      "title: a short, specific, natural title, at most 7 words. No quotes, no trailing punctuation.",
      "summary: one or two plain sentences that say the thought clearly, in the person's own voice (\"I\", \"my\") where natural.",
      "points: 0 to 5 short pointers, only when the thought contains several distinct items or facts. Each pointer IS one of those items or facts, stated directly (for a list of brands: one brand per pointer, with any remark the person made about it). Never describe the thought itself (\"I mentioned...\"). Empty when there is just one idea.",
      "checklist_heading / checklist_items: whenever there is something the person will or might do later (a task, an errand, something to buy, try, book, call, check). A short heading (e.g. \"Next time I shop\", \"To do\") and 1 to 4 items. Every item must come straight from the thought; do not invent extra steps, questions or sub-tasks. One item is often enough. If has_todos is true there must be a checklist. Null and an empty list only for pure facts, reflections and observations.",
      "category: one broad lowercase area of life, 1-2 words (e.g. shopping, health, work, travel, food, money, ideas).",
      "tags: 2 to 5 lowercase tags, each 1-2 words, that this person would plausibly search for. No hashtags.",
      "entities: specific named things in the thought (brands, people, places, products), as written. Empty if none.",
      "has_todos: true if the thought contains things still to be done.",
      "research: set it when the thought names specific products, brands, places, books, films, apps or the like that the person means to buy, try, visit or look into; a quick web lookup of the key facts (what it is, typical price, where to get it) saves them the search. If the thought lists brands or products to buy, research MUST be set (e.g. thought \"good running shoes: Asics Novablast, Hoka Clifton\" -> label \"Running shoe prices\", query \"Asics Novablast and Hoka Clifton running shoes: current price and what each is known for\"). Null for personal reflections, plans, reminders, to-dos about their own life, private matters, people they know, and anything with nothing to look up. label: a short heading for the result (e.g. \"Sunscreens to look at\"). kind: \"products\" when the things are products or brands one can buy (the result will be one product per brand or item, with price and store), otherwise \"facts\". query: for products, the kind of product and every brand or item named, plus the country if the thought or its context suggests one (e.g. \"sunscreen from each of: Lakme, Minimalist, Aqualogica, Dermaco\"); for facts, one precise web search question.",
      known.categories.length ? `Reuse one of these categories when it fits: ${known.categories.join(", ")}.` : "",
      known.tags.length ? `Reuse these existing tags when they fit rather than inventing near-duplicates: ${known.tags.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n")
  const thought = [describeContext(note.context ?? {}), source.slice(0, 6000)].filter(Boolean).join("\n\n")
  const written = await write<Enriched>(writers, (writer) =>
    writer === "openai" ? structured<Enriched>("thought", ENRICH_SCHEMA, system, thought) : claudeEnrich(writer, system, thought)
  )
  const enriched = written.value
  enriched.title = enriched.title.trim().replace(/^["'“]|["'”.]$/g, "").slice(0, 80)
  enriched.tags = [...new Set(enriched.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))].slice(0, 5)
  enriched.category = enriched.category.toLowerCase().trim()
  enriched.points = enriched.points.map((p) => p.trim()).filter(Boolean).slice(0, 5)
  enriched.checklist_items = enriched.checklist_items.map((p) => p.trim()).filter(Boolean).slice(0, 4)
  return written
}

// ---------- step 3: the action worker ----------

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd])/i

const meta = (html: string, key: string) =>
  new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)?.[1] ??
  new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i").exec(html)?.[1] ??
  null
const decode = (text: string) =>
  text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")

/** Reads a page the thought links to and summarises it. */
async function fetchLink(url: string, writers: Writer[]): Promise<Written<Record<string, unknown>>> {
  const target = new URL(url)
  if (!/^https?:$/.test(target.protocol) || PRIVATE_HOST.test(target.hostname)) throw new Error("That address can't be fetched.")
  const response = await fetch(target, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; QuickThoughtsBot/1.0)", Accept: "text/html,*/*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`The page answered ${response.status}.`)
  if (!(response.headers.get("content-type") ?? "").includes("html")) throw new Error("That link isn't a web page.")
  const html = (await response.text()).slice(0, 600_000)
  const title = decode(meta(html, "og:title") ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim()
  const description = decode(meta(html, "og:description") ?? meta(html, "description") ?? "").trim()
  const image = meta(html, "og:image")
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  ).trim()

  let summary = description || text.slice(0, 240)
  let by = "none"
  let fallback: string | null = null
  if (text.length > 400) {
    const written = await write<string>(writers, async (writer) => {
      if (writer !== "openai") return claudeSummarise(writer, title, text.slice(0, 5000))
      const completion = await openai("chat/completions", {
        model: MODEL,
        reasoning_effort: lightest(MODEL),
        messages: [
          { role: "system", content: "Summarise this web page in two plain sentences for someone who saved the link to read later. Only what the page says." },
          { role: "user", content: `${title}\n\n${text.slice(0, 5000)}` },
        ],
      })
      return completion.choices[0].message.content.trim()
    })
    summary = written.value
    by = written.by
    fallback = written.fallback
  }
  const result = {
    url: response.url || url,
    site: decode(meta(html, "og:site_name") ?? target.hostname.replace(/^www\./, "")),
    title: title || target.hostname,
    summary,
    image: image ? new URL(decode(image), response.url || url).href : null,
  }
  return { value: result, by, fallback }
}

type Source = { url: string; title: string }

// deno-lint-ignore no-explicit-any
function readResponse(response: any): { text: string; sources: Source[] } {
  // deno-lint-ignore no-explicit-any
  const parts = ((response.output ?? []) as any[]).filter((o) => o.type === "message").flatMap((o) => o.content ?? [])
  const sources = new Map<string, string>()
  for (const part of parts) {
    for (const note of part.annotations ?? []) {
      if (note.type !== "url_citation" || !note.url) continue
      const clean = new URL(note.url)
      clean.searchParams.delete("utm_source")
      if (!sources.has(clean.href)) sources.set(clean.href, note.title || clean.hostname.replace(/^www\./, ""))
    }
  }
  return { text: parts.map((part) => part.text ?? "").join("\n"), sources: [...sources].map(([url, title]) => ({ url, title })) }
}

/** Looks something up on the web and returns a short answer with its sources. */
async function researchFacts(query: string): Promise<Record<string, unknown>> {
  const response = await openai("responses", {
    model: MODEL,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    input:
      `${query}\n\nAnswer with at most four short lines of facts, each starting with "- ". ` +
      "Plain text only: no links, no markdown, no introductions. If you can't find it, say so in one line.",
  })
  const { text, sources } = readResponse(response)
  const answer = text
    .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, "") // inline citations
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
  if (!answer) throw new Error("Nothing was found.")
  return { answer, sources: sources.slice(0, 4) }
}

type Product = { brand: string; name: string; price: string | null; store: string; url: string; image: string | null }

const PRODUCTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["products"],
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["brand", "name", "price", "store", "url"],
        properties: {
          brand: { type: "string" },
          name: { type: "string" },
          price: { type: ["string", "null"] },
          store: { type: "string" },
          url: { type: "string" },
        },
      },
    },
  },
}

/** Opens a product page to confirm it exists and to pick up its picture and price. */
async function inspectProductPage(url: string): Promise<{ url: string; image: string | null; price: string | null } | null> {
  try {
    const target = new URL(url)
    if (!/^https?:$/.test(target.protocol) || PRIVATE_HOST.test(target.hostname)) return null
    const response = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(9_000),
    })
    if (!response.ok) return null
    const html = (await response.text()).slice(0, 600_000)
    const image = meta(html, "og:image")
    const amount = meta(html, "product:price:amount") ?? meta(html, "og:price:amount")
    const currency = meta(html, "product:price:currency") ?? meta(html, "og:price:currency")
    const symbol: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" }
    return {
      url: response.url || url,
      image: image ? new URL(decode(image), response.url || url).href.replace(/^http:/, "https:") : null,
      price: amount ? `${symbol[currency ?? ""] ?? (currency ? currency + " " : "")}${amount.replace(/\.00$/, "")}` : null,
    }
  } catch {
    return null
  }
}

type FoundProduct = Omit<Product, "image">

/** OpenAI's version of the product search. */
async function openaiProducts(query: string): Promise<{ products: FoundProduct[]; sources: Source[] }> {
  const response = await openai("responses", {
    model: MODEL,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    text: { format: { type: "json_schema", name: "products", strict: true, schema: PRODUCTS_SCHEMA } },
    input:
      `Find products for: ${query}\n\n` +
      "Return ONE popular, currently sold product for each brand or item named (at most 6 in total). For each: the brand, " +
      "the product's short name (no marketing claims, at most 8 words), its current price with currency symbol or null if you " +
      "could not find it, the store's name, and the URL of that exact product page. Prefer the brand's own online store. " +
      "Only use pages you actually found in the search; never guess a URL.",
  })
  const { text, sources } = readResponse(response)
  const products = (JSON.parse(text).products as FoundProduct[]).slice(0, 6)
  if (products.length === 0) throw new Error("No products were found.")
  return { products, sources }
}

/** Finds one real product per brand or item, then opens each page for its picture and price. */
async function researchProducts(query: string, writers: Writer[]): Promise<Written<Record<string, unknown>>> {
  const written = await write(writers, async (writer) => {
    if (writer !== "openai") return claudeProducts(writer, query)
    // The OpenAI model sometimes returns an empty list on the first go; a second try usually works.
    try {
      return await openaiProducts(query)
    } catch (error) {
      console.error("product lookup failed, trying once more", error)
      return openaiProducts(query)
    }
  })
  const { products: found, sources } = written.value
  const pages = await Promise.all(found.map((product) => inspectProductPage(product.url)))
  const products: Product[] = found.map((product, i) => {
    const page = pages[i]
    return {
      brand: product.brand.trim(),
      name: product.name.trim().slice(0, 90),
      // The page's own price beats the model's reading of it.
      price: page?.price ?? product.price,
      store: product.store.replace(/\s*\(.*\)$/, "").trim(),
      // A page that didn't load may not exist; send the user to a search for it instead.
      url: page?.url ?? `https://www.google.com/search?q=${encodeURIComponent(`${product.brand} ${product.name}`)}`,
      image: page?.image ?? null,
    }
  })
  const pageSources = products.filter((_, i) => pages[i]).map((product) => ({ url: product.url, title: `${product.brand}: ${product.name}` }))
  const all = [...pageSources, ...sources.filter((source) => !pageSources.some((page) => page.url === source.url))]
  return { ...written, value: { products, sources: all.slice(0, 8) } }
}

async function research(action: Action, writers: Writer[]): Promise<Written<Record<string, unknown>>> {
  if (action.kind === "products") {
    try {
      return await researchProducts(action.input, writers)
    } catch (error) {
      console.error("product lookup failed with every writer, falling back to plain facts", error)
    }
  }
  return write<Record<string, unknown>>(writers, (writer) =>
    writer === "openai" ? researchFacts(action.input) : claudeFacts(writer, action.input)
  )
}

function planActions(source: string, enriched: Enriched): Action[] {
  const actions: Action[] = []
  const links = [...new Set(source.match(URL_PATTERN) ?? [])].slice(0, 2)
  for (const url of links) {
    actions.push({ type: "fetch_link", label: `Read ${new URL(url).hostname.replace(/^www\./, "")}`, input: url, status: "running" })
  }
  // The small model is unreliable about when to look things up and in which form, so
  // the decision is made here: a thought that names things to buy always gets a
  // product lookup; otherwise the model's own proposal (if any) is used as given.
  const shopping =
    enriched.entities.length > 0 &&
    (enriched.type === "recommendation" || enriched.category === "shopping" || /\b(buy|buying|brands?|products?)\b/i.test(source))
  const research = shopping
    ? {
        kind: "products" as const,
        label: enriched.research?.kind === "products" ? enriched.research.label : "Products to look at",
        query: `${enriched.title} (${enriched.tags.slice(0, 3).join(", ")}). One product from each of: ${enriched.entities.slice(0, 6).join(", ")}`,
      }
    : enriched.research
  if (research && links.length === 0) {
    actions.push({ type: "research", kind: research.kind, label: research.label.trim().slice(0, 60), input: research.query.trim().slice(0, 300), status: "running" })
  }
  return actions
}

async function runAction(action: Action, writers: Writer[]): Promise<Action> {
  try {
    const written = action.type === "fetch_link" ? await fetchLink(action.input, writers) : await research(action, writers)
    return { ...action, status: "done", by: written.by, result: written.value }
  } catch (error) {
    return { ...action, status: "failed", result: { error: error instanceof Error ? error.message : String(error) } }
  }
}

// ---------- writing the note ----------

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeAttr = (text: string) => escapeHtml(text).replace(/"/g, "&quot;")
const paragraph = (text: string) => `<p>${escapeHtml(text)}</p>`

/** The user's own images and recordings, carried over whenever the note is rewritten. */
function ownMedia(content: string): string {
  const media = [...content.matchAll(/<(img|audio)\b[^>]*>(?:<\/audio>)?/g)]
    .map((match) => match[0])
    .filter((tag) => /src="(media:\/\/|data:)/.test(tag))
  // Drawings made in the note are the user's own too.
  const drawings = [...content.matchAll(/<div\b[^>]*data-type="drawing"[^>]*><\/div>/g)].map((match) => match[0])
  return [...media, ...drawings].join("")
}

/** A blank line, the way one is left between sections when writing a note by hand. */
const GAP = "<p></p>"
const widget = (type: string, name: string, value: unknown) =>
  `<div data-type="${type}" data-${name}="${escapeAttr(JSON.stringify(value))}"></div>`

/** The organised note as editor HTML: title line, summary, the user's media, pointers, checklist. */
function writeBody(enriched: Enriched, media: string): string {
  const sections = [
    paragraph(enriched.title) + paragraph(enriched.summary),
    media,
    enriched.points.length > 0
      ? `<ul data-type="dashed">${enriched.points.map((point) => `<li>${paragraph(point)}</li>`).join("")}</ul>`
      : "",
    enriched.checklist_heading && enriched.checklist_items.length > 0
      ? `<h3>${escapeHtml(enriched.checklist_heading)}</h3><ul data-type="taskList">` +
        enriched.checklist_items.map((item) => `<li data-type="taskItem" data-checked="false">${paragraph(item)}</li>`).join("") +
        "</ul>"
      : "",
  ]
  return sections.filter(Boolean).join(GAP)
}

/** What the action worker found, as sections appended to the note. */
function writeFindings(actions: Action[]): string {
  return actions
    .filter((action) => action.status === "done" && action.result)
    .map((action) => {
      const result = action.result as Record<string, unknown>
      if (action.type === "fetch_link") {
        const url = escapeAttr(String(result.url ?? action.input))
        return (
          GAP +
          `<h3>${escapeHtml(String(result.site ?? "Link"))}</h3>` +
          `<p><a href="${url}">${escapeHtml(String(result.title ?? url))}</a></p>` +
          (result.summary ? paragraph(String(result.summary)) : "") +
          (result.image ? `<img src="${escapeAttr(String(result.image))}">` : "")
        )
      }
      const sources = (result.sources as Source[] | undefined) ?? []
      // Sources go in their own section, folded away until asked for.
      const sourcesSection = sources.length > 0 ? widget("sources", "sources", sources) : ""
      if (Array.isArray(result.products)) {
        return GAP + `<h3>${escapeHtml(action.label)}</h3>` + widget("products", "products", result.products) + sourcesSection
      }
      const lines = String(result.answer ?? "").split("\n").map((line) => line.replace(/^[-•]\s*/, "").trim()).filter(Boolean)
      return (
        GAP +
        `<h3>${escapeHtml(action.label)}</h3>` +
        `<ul data-type="dashed">${lines.map((line) => `<li>${paragraph(line)}</li>`).join("")}</ul>` +
        sourcesSection
      )
    })
    .join("")
}

const decodeEntities = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")

/** Plain text of editor HTML, one line per block, the way the app derives it. */
function plainText(html: string): string {
  // A product slider reads as one line per product, so its contents are searchable.
  const withProducts = html.replace(/<div data-type="products" data-products="([^"]*)"><\/div>/g, (_, encoded) => {
    try {
      return (JSON.parse(decodeEntities(encoded)) as Product[])
        .map((product) => `<p>${escapeHtml([product.brand, product.name, product.price].filter(Boolean).join(" · "))}</p>`)
        .join("")
    } catch {
      return ""
    }
  })
  return decodeEntities(withProducts.replace(/<\/(p|h[1-6]|li)>/g, "\n").replace(/<[^>]+>/g, ""))
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n")
}

// ---------- the pipeline ----------

const COLUMNS = "id, user_id, folder_id, title, text, content, context, originals, enrich_request, enriched_hash, purged_at, created_at"

async function load(id: string): Promise<NoteRow | null> {
  const { data, error } = await db.from("notes").select(COLUMNS).eq("id", id).maybeSingle()
  if (error) throw error
  return data as NoteRow | null
}

/** Scores the closest earlier notes against `words`; highest first. */
async function closestNotes(note: NoteRow, words: string) {
  await db.from("notes").update({ embedding: await embed(words.slice(0, 6000)) }).eq("id", note.id)
  const shortlist = await db.rpc("related_notes", { target: note.id, min_similarity: CANDIDATE_SIMILARITY, max_results: CANDIDATES })
  if (shortlist.error) throw shortlist.error
  const near = shortlist.data as { id: string; similarity: number }[]
  const ids = near.map((c) => c.id)
  if (ids.length === 0) return []
  const { data: others, error } = await db.from("notes").select("id, folder_id, text, originals").in("id", ids)
  if (error) throw error
  // Compare like with like: a thought is judged by the words it was captured in, not by
  // its written-up text, whose extra sections (products, checklists) blur the comparison.
  const captured = (other: { text: string; originals: { text: string }[] | null }) =>
    other.originals && other.originals.length > 0 ? other.originals.map((o) => o.text).join("\n") : other.text
  const scores = await judgeSimilarity(words, others.map(captured))
  return others
    .map((other, i) => {
      const similarity = near.find((c) => c.id === other.id)?.similarity ?? 0
      const backstop = similarity >= LINK_SIMILARITY ? LINK_AT + 5 : 0
      return { id: other.id, folder_id: other.folder_id as string | null, score: Math.max(scores[i], Math.min(backstop, MERGE_AT - 1)) }
    })
    .sort((a, b) => b.score - a.score)
}

async function writeLinks(note: NoteRow, links: { id: string; score: number }[]) {
  await db.from("note_links").delete().or(`from_id.eq.${note.id},to_id.eq.${note.id}`)
  if (links.length === 0) return
  const rows = links.flatMap((other) => [
    { user_id: note.user_id, from_id: note.id, to_id: other.id, score: other.score / 100, reason: "similar" },
    { user_id: note.user_id, from_id: other.id, to_id: note.id, score: other.score / 100, reason: "similar" },
  ])
  const inserted = await db.from("note_links").upsert(rows)
  if (inserted.error) throw inserted.error
}

/** An ordinary note: tags, embedding and links. Its words are never touched. */
async function processOrdinaryNote(note: NoteRow): Promise<string> {
  const hash = await sha256(`${note.title}\n${note.text}`)
  if (hash === note.enriched_hash) return "skipped"
  const judged = await closestNotes(note, `${note.title}\n${note.text}`)
  const written = await enrich(note, [{ at: note.created_at, text: note.text }], DEFAULT_WRITERS)
  const { research: _research, checklist_heading: _heading, checklist_items: _items, points: _points, title: _title, ...tags } = written.value
  const saved = await db
    .from("notes")
    .update({
      enrichment: { ...tags, similarity: judged.map(({ id, score }) => ({ id, score })), written_by: written.by, written_at: new Date().toISOString() },
      embedding: await embed([note.title, note.text.slice(0, 6000), `Tags: ${tags.tags.join(", ")}`].join("\n")),
      enriched_hash: hash,
      enrich_status: "done",
    })
    .eq("id", note.id)
  if (saved.error) throw saved.error
  await writeLinks(note, judged.filter((other) => other.score >= LINK_AT))
  return "tagged"
}

async function processThought(note: NoteRow, thoughtsFolder: string): Promise<string> {
  // Until a thought has been processed, its own text IS the original.
  // Its formatting is kept too (without pictures and recordings, which stay in the note).
  let originals =
    note.originals.length > 0
      ? note.originals
      : [{ at: note.created_at, text: note.text, html: note.content.replace(/<(img|audio)\b[^>]*>(?:<\/audio>)?/g, "") }]
  const originalsHash = (list: { text: string }[]) => sha256(list.map((o) => o.text).join("\n\n"))

  // A request to redo the thought with a named model overrides "nothing has changed".
  const requested = RERUN_MODELS.find((model) => model === note.enrich_request?.model)
  const writers: Writer[] = requested ? [requested, ...DEFAULT_WRITERS.filter((w) => w !== requested)] : DEFAULT_WRITERS
  if (!requested && (await originalsHash(originals)) === note.enriched_hash) {
    // Only the written-up text was edited: keep it, and keep search in step with it.
    const embedding = await embed([note.title, note.text.slice(0, 6000)].join("\n"))
    await db.from("notes").update({ embedding }).eq("id", note.id)
    return "re-embedded"
  }
  const isNew = note.enriched_hash === null
  let outcome = requested ? `reorganised with ${requested}` : isNew ? "organised" : "reorganised"

  // Step 1: similarity.
  const words = originals.map((o) => o.text).join("\n\n")
  const judged = await closestNotes(note, words)
  const best = judged[0]
  let mergedInto: string | null = null
  if (isNew && best && best.score >= MERGE_AT && best.folder_id === thoughtsFolder) {
    // Only a newly added thought is merged, and only into an earlier quick thought.
    const merged = await db.rpc("merge_notes", { source: note.id, target: best.id })
    if (merged.error) throw merged.error
    mergedInto = best.id
    note = (await load(best.id))!
    originals = note.originals
    outcome = `merged into ${best.id} (score ${best.score})`
  }
  const links = judged.filter((other) => other.id !== mergedInto && other.id !== note.id && other.score >= LINK_AT)

  // Step 2: enrich, and write the organised note with any actions still running.
  const written = await enrich(note, originals, writers)
  const enriched = written.value
  let actions = planActions(originals.map((o) => o.text).join("\n"), enriched)
  const { research: _research, checklist_heading, checklist_items, ...rest } = enriched
  const writtenAt = new Date().toISOString()
  const enrichment = (current: Action[]) => ({
    ...rest,
    checklist: checklist_heading && checklist_items.length > 0 ? { heading: checklist_heading, items: checklist_items } : null,
    actions: current,
    // How the closest earlier notes were scored, kept for tuning the merge and link thresholds.
    similarity: judged.map(({ id, score }) => ({ id, score })),
    // Which model wrote this, when, and why the first choice wasn't used (if it wasn't).
    written_by: written.by,
    written_at: writtenAt,
    fallback: written.fallback,
  })
  // Links first, so they are already in place when the note is marked as done.
  await writeLinks(note, links)
  const body = writeBody(enriched, ownMedia(note.content))
  const text = plainText(body)
  const saved = await db
    .from("notes")
    .update({
      originals,
      content: body,
      text,
      title: enriched.title,
      snippet: enriched.summary,
      enrichment: enrichment(actions),
      embedding: await embed([words.slice(0, 3000), text.slice(0, 3000), `Tags: ${enriched.tags.join(", ")}`].join("\n")),
      enriched_hash: await originalsHash(originals),
      enrich_status: "done",
      enrich_request: null,
      // Newer than any device's copy, so every device takes the rewritten note.
      updated_at: new Date().toISOString(),
    })
    .eq("id", note.id)
  if (saved.error) throw saved.error

  // Step 3: the action worker. What it finds is appended to the note as it stands by then.
  if (actions.length > 0) {
    actions = await Promise.all(actions.map((action) => runAction(action, writers)))
    const findings = writeFindings(actions)
    const latest = await load(note.id)
    const update: Record<string, unknown> = { enrichment: enrichment(actions) }
    if (findings && latest && !latest.purged_at) {
      update.content = latest.content + findings
      update.text = plainText(latest.content + findings)
      update.updated_at = new Date().toISOString()
    }
    const updated = await db.from("notes").update(update).eq("id", note.id)
    if (updated.error) throw updated.error
  }
  return outcome
}

async function processNote(job: Job): Promise<string> {
  const note = await load(job.id)
  if (!note || note.purged_at || !note.text.trim()) return "skipped"
  const { data: thoughts } = await db.from("folders").select("id").eq("user_id", note.user_id).eq("kind", "thoughts").maybeSingle()
  return thoughts && note.folder_id === thoughts.id ? processThought(note, thoughts.id) : processOrdinaryNote(note)
}

Deno.serve(async (request) => {
  // Only the database's scheduled job knows this secret.
  if (request.headers.get("x-enrich-secret") !== Deno.env.get("ENRICH_SECRET")) {
    return new Response("forbidden", { status: 403 })
  }
  const jobs = (await request.json()) as Job[]
  const finished: number[] = []
  const results: Record<string, string> = {}
  for (const job of jobs) {
    try {
      results[job.id] = await processNote(job)
      finished.push(job.msg_id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results[job.id] = `error: ${message}`
      console.error("enrich failed", job.id, error)
      // An account problem at OpenAI (no credits, quota, rate limit) says nothing about
      // the note. Those jobs wait on the queue for as long as it takes, so nothing is
      // lost while the account is topped up. Any other error gives up after a few tries.
      const accountProblem = /credits|quota|billing|rate limit|429|insufficient/i.test(message)
      if (!accountProblem && job.read_ct >= MAX_ATTEMPTS) {
        await db.from("notes").update({ enrich_status: "failed" }).eq("id", job.id)
        finished.push(job.msg_id)
      }
      // Otherwise left on the queue: it becomes visible again and is retried.
    }
  }
  if (finished.length > 0) await db.rpc("finish_enrichment", { msg_ids: finished })
  return Response.json(results)
})
