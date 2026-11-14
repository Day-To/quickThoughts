// Smart search (plan.md §7). Called by the signed-in app with what the user typed.
//
//   1. Understand: only when the query mentions time or a kind of note ("sunscreen last
//      week", "my todos"), an LLM splits it into a topic, a date range and a kind,
//      and adds related words. Plain topics skip this step, which saves two seconds.
//   2. Gather: the database shortlists notes close in meaning or sharing any of those
//      words. This step is deliberately generous.
//   3. Judge: the LLM reads the shortlist and scores how well each note answers the
//      search. Only notes that really relate are returned, best first.
//
// Step 3 is what makes loose queries work: a note listing "wedding at 28, house at 32"
// never says "life" or "future", and its embedding sits far from those words, but
// anyone reading it can see it is about both.
import { createClient } from "npm:@supabase/supabase-js@2"

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!
// The same model the pipeline uses for judging similarity; these calls are small.
const MODEL = Deno.env.get("OPENAI_JUDGE_MODEL") || "gpt-6-luna"
// The lightest reasoning setting each model family accepts ("minimal" on GPT-5, "none" on GPT-6).
const LIGHTEST = MODEL.startsWith("gpt-5") ? "minimal" : "none"
const TYPES = ["idea", "recommendation", "todo", "reminder", "fact", "journal", "link"]
const SHORTLIST = 18
const SHORTLIST_SIMILARITY = 0.12
const RELEVANT_AT = 65

// Queries that mention time or a kind of note need taking apart; the rest are a topic as they stand.
const NEEDS_UNDERSTANDING = new RegExp(
  "\\b(today|yesterday|tonight|week|weekend|month|year|day|days|ago|since|before|after|between|recent|recently|latest|earlier|" +
    "morning|afternoon|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
    "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|" +
    "todo|todos|to-do|reminder|reminders|idea|ideas|recommendation|recommendations|link|links|\\d{4}|\\d{1,2}(st|nd|rd|th)|\\d{1,2}[/-]\\d{1,2})\\b",
  "i"
)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

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

async function structured<T>(name: string, schema: unknown, system: string, user: string): Promise<T> {
  const completion = await openai("chat/completions", {
    model: MODEL,
    // Speed matters here: someone is waiting for results.
    reasoning_effort: LIGHTEST,
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  })
  return JSON.parse(completion.choices[0].message.content) as T
}

// ---------- 1. understand ----------

type Filters = { topic: string | null; from_date: string | null; to_date: string | null; type: string | null; related: string[] }
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)

async function understand(query: string, today: string, weekday: string): Promise<Filters> {
  const parsed = await structured<Filters>(
    "search",
    {
      type: "object",
      additionalProperties: false,
      required: ["topic", "from_date", "to_date", "type", "related"],
      properties: {
        topic: { type: ["string", "null"] },
        from_date: { type: ["string", "null"] },
        to_date: { type: ["string", "null"] },
        type: { type: ["string", "null"], enum: [...TYPES, null] },
        related: { type: "array", items: { type: "string" } },
      },
    },
    [
      `Today is ${weekday} ${today}. Someone is searching their own personal notes. Work out what they want.`,
      "topic: what the notes should be about, as a short phrase, with time words and filler (\"what did I think\", \"do I have anything about\", \"notes\", \"my\") removed. null if the query is only about time or a kind of note.",
      "related: 5 to 8 other words or short phrases that notes on this topic are likely to contain: synonyms, narrower terms and typical examples. For \"prophecy\": prediction, forecast, fortune, future, astrology, destiny. For \"life\": future plans, goals, milestones, career, marriage, family, health, home. Empty when topic is null.",
      "from_date / to_date: the inclusive date range the user means, as YYYY-MM-DD, or null if no time is mentioned. \"last 7 days\" = the 7 days ending today. \"last week\" = the previous Monday-to-Sunday week. \"yesterday\", \"this month\", \"in October\", \"on 3 Nov\" likewise. A single day has the same from and to. Assume the most recent past occurrence; never a future date. Words like \"future\" or \"someday\" are topics, not dates.",
      `type: one of ${TYPES.join(", ")} only if the user explicitly asks for that kind of note (e.g. "my todos", "recommendations"); otherwise null.`,
    ].join("\n"),
    query
  )
  // The model sometimes repeats the kind of note as the topic ("my todos" -> topic "todos").
  const generic = /^(my |all |the )*(to-?dos?|reminders?|ideas?|recommendations?|links?|notes?|thoughts?|facts?|journals?)$/i
  const topic = parsed.topic?.trim() || null
  const kept = topic && !generic.test(topic) ? topic : null
  return {
    topic: kept,
    from_date: isDate(parsed.from_date) ? parsed.from_date : null,
    to_date: isDate(parsed.to_date) ? parsed.to_date : null,
    type: parsed.type && TYPES.includes(parsed.type) ? parsed.type : null,
    related: kept ? parsed.related.map((word) => word.trim()).filter(Boolean).slice(0, 8) : [],
  }
}

// ---------- 3. judge ----------

type Candidate = { id: string; title: string; snippet: string; text: string; enrichment: { tags?: string[]; category?: string } | null; created_at: string }

async function judge(query: string, candidates: Candidate[]): Promise<number[]> {
  const listing = candidates
    .map((note, i) => {
      const tags = [note.enrichment?.category, ...(note.enrichment?.tags ?? [])].filter(Boolean).join(", ")
      return `${i + 1}. ${note.text.replace(/\s+/g, " ").slice(0, 240)}${tags ? ` (tags: ${tags})` : ""}`
    })
    .join("\n")
  const { scores } = await structured<{ scores: number[] }>(
    "relevance",
    {
      type: "object",
      additionalProperties: false,
      required: ["scores"],
      properties: { scores: { type: "array", items: { type: "integer" } } },
    },
    [
      "Someone is searching their own personal notes. Score each note 0 to 100 for whether they would want it in the results.",
      "80-100: it is about what they asked for.",
      "65-79: it clearly relates, or is a specific instance of something broader they asked about. A note about getting married at 28 and buying a house at 32 IS about \"life\", \"the future\" and \"plans\"; a note of predictions IS about \"prophecy\"; taking out insurance IS about \"money\".",
      "0-64: it would be noise. Sharing a word, or merely being part of everyday life, is not enough.",
      "For broad searches (\"life\", \"anything about my life\", \"future\") include notes about the person's direction: plans, goals, milestones, predictions, big decisions, money, relationships, health in general. Leave out day-to-day errands and one-off items (a dinner idea, a dentist call, a product to buy, a work task this week).",
      "For specific searches (\"sunscreen\", a name) be strict.",
      "Return one integer per note, in the same order.",
    ].join("\n"),
    `Search: ${query}\n\nNotes:\n${listing}`
  )
  return candidates.map((_, i) => Math.max(0, Math.min(100, Math.round(Number(scores[i] ?? 0)))))
}

// ---------- the request ----------

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS })
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS })
  try {
    // Act as the caller: every query below is limited to their own notes by row-level security.
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    })
    const { data: who } = await db.auth.getUser()
    if (!who.user) return reply({ error: "Sign in to search." }, 401)

    const { query, timezone = "UTC", today, weekday } = await request.json()
    const text = String(query ?? "").trim().slice(0, 300)
    if (!text) return reply({ filters: null, results: [] })

    const started = Date.now()
    const timing: Record<string, number> = {}
    const lap = (name: string) => (timing[name] = Date.now() - started)
    const filters: Filters = NEEDS_UNDERSTANDING.test(text)
      ? await understand(text, String(today), String(weekday))
      : { topic: text, from_date: null, to_date: null, type: null, related: [] }
    lap("understood")
    // Nothing usable came out: treat the whole query as the topic.
    if (!filters.topic && !filters.from_date && !filters.to_date && !filters.type) filters.topic = text

    let embedding: string | null = null
    if (filters.topic) {
      const embedded = await openai("embeddings", {
        model: "text-embedding-3-small",
        input: [filters.topic, filters.related.join(", ")].filter(Boolean).join("\n"),
      })
      embedding = JSON.stringify(embedded.data[0].embedding)
    }
    lap("embedded")

    const shortlist = await db.rpc("search_notes", {
      // Any of these words counts as a keyword hit.
      query_text: filters.topic ? [filters.topic, ...filters.related].join(" ") : null,
      query_embedding: embedding,
      from_date: filters.from_date,
      to_date: filters.to_date,
      tz: timezone,
      note_type: filters.type,
      match_count: filters.topic ? SHORTLIST : 50,
      min_similarity: SHORTLIST_SIMILARITY,
    })
    if (shortlist.error) throw shortlist.error
    const found = shortlist.data as { id: string; score: number; similarity: number | null }[]
    lap("shortlisted")

    // A search by date or kind alone has nothing to judge: everything in range is wanted.
    if (!filters.topic || found.length === 0) return reply({ filters, results: found, timing })

    const { data: notes, error } = await db
      .from("notes")
      .select("id, title, snippet, text, enrichment, created_at")
      .in("id", found.map((row) => row.id))
    if (error) throw error
    const candidates = found.flatMap((row) => (notes as Candidate[]).filter((note) => note.id === row.id))
    lap("loaded")
    const relevance = await judge(text, candidates)
    lap("judged")
    const results = candidates
      .map((note, i) => ({ id: note.id, score: relevance[i] / 100, similarity: found.find((row) => row.id === note.id)?.similarity ?? null }))
      .filter((row) => row.score * 100 >= RELEVANT_AT)
      .sort((a, b) => b.score - a.score)
    return reply({ filters, results, timing })
  } catch (error) {
    console.error("search failed", error)
    return reply({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
