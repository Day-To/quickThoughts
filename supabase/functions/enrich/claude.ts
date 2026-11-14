// Claude as the writer for the thought pipeline: writing a thought up, summarising a
// linked page, and looking things up on the web. Uses the official Anthropic SDK.
// The caller (index.ts) decides which model to use and what to fall back to.
import Anthropic from "npm:@anthropic-ai/sdk"
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod"
import { z } from "npm:zod"

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") })

export type ClaudeModel = "claude-opus-5-5" | "claude-fable-5-2"

// Routine extraction and rewriting: both models think adaptively by default, and a
// lower effort keeps a note's write-up quick. Fable is the "take more care" option.
const EFFORT: Record<ClaudeModel, "low" | "medium"> = {
  "claude-opus-5-5": "low",
  "claude-fable-5-2": "medium",
}

/** Thrown when Claude declines or cannot be used, so the caller can move to the next writer. */
export class ClaudeUnavailable extends Error {
  /** True when the account has no credits left: worth remembering for a while. */
  outOfCredits: boolean
  constructor(message: string, outOfCredits = false) {
    super(message)
    this.outOfCredits = outOfCredits
  }
}

/** Turns SDK errors into one kind of error the pipeline understands. */
function unavailable(error: unknown): ClaudeUnavailable {
  if (error instanceof ClaudeUnavailable) return error
  if (error instanceof Anthropic.APIError) {
    // Anthropic reports an empty balance as a billing error, or as a 400 that says so.
    const outOfCredits = error.type === "billing_error" || /credit balance/i.test(error.message)
    return new ClaudeUnavailable(`Claude ${error.status ?? ""} ${error.type ?? ""}: ${error.message}`.trim(), outOfCredits)
  }
  return new ClaudeUnavailable(error instanceof Error ? error.message : String(error))
}

const textOf = (message: Anthropic.Message) =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")

function assertAnswered(message: Anthropic.Message) {
  if (message.stop_reason === "refusal") {
    throw new ClaudeUnavailable(`Claude declined (${message.stop_details?.category ?? "no category"})`)
  }
  if (message.stop_reason === "max_tokens") throw new ClaudeUnavailable("Claude's answer was cut off")
}

// ---------- writing a thought up ----------

const Enriched = z.object({
  title: z.string(),
  summary: z.string(),
  points: z.array(z.string()),
  checklist_heading: z.string().nullable(),
  checklist_items: z.array(z.string()),
  type: z.enum(["idea", "recommendation", "todo", "reminder", "fact", "journal", "link", "other"]),
  category: z.string(),
  tags: z.array(z.string()),
  entities: z.array(z.string()),
  has_todos: z.boolean(),
  research: z.object({ label: z.string(), query: z.string(), kind: z.enum(["products", "facts"]) }).nullable(),
})
export type ClaudeEnriched = z.infer<typeof Enriched>

export async function claudeEnrich(model: ClaudeModel, system: string, thought: string): Promise<ClaudeEnriched> {
  try {
    const message = await client.messages.parse({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: thought }],
      output_config: { effort: EFFORT[model], format: zodOutputFormat(Enriched) },
    })
    assertAnswered(message)
    if (!message.parsed_output) throw new ClaudeUnavailable("Claude's answer did not match the expected shape")
    return message.parsed_output
  } catch (error) {
    throw unavailable(error)
  }
}

// ---------- summarising a linked page ----------

export async function claudeSummarise(model: ClaudeModel, title: string, pageText: string): Promise<string> {
  try {
    const message = await client.messages.create({
      model,
      max_tokens: 16000,
      system: "Summarise this web page in two plain sentences for someone who saved the link to read later. Only what the page says. Reply with the two sentences and nothing else.",
      messages: [{ role: "user", content: `${title}\n\n${pageText}` }],
      output_config: { effort: "low" },
    })
    assertAnswered(message)
    const summary = textOf(message).trim()
    if (!summary) throw new ClaudeUnavailable("Claude returned no summary")
    return summary
  } catch (error) {
    throw unavailable(error)
  }
}

// ---------- looking things up on the web ----------

export type Source = { url: string; title: string }

/**
 * One web-search turn. The search runs on Anthropic's side; a long search can pause
 * part-way (`pause_turn`), in which case the same conversation is sent again to resume.
 */
async function search(model: ClaudeModel, prompt: string): Promise<{ text: string; sources: Source[] }> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }]
  let message: Anthropic.Message | undefined
  for (let attempt = 0; attempt < 4; attempt++) {
    // Streamed, because a turn with several searches can run for a while.
    message = await client.messages
      .stream({
        model,
        max_tokens: 16000,
        messages,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        output_config: { effort: EFFORT[model] },
      })
      .finalMessage()
    if (message.stop_reason !== "pause_turn") break
    messages.push({ role: "assistant", content: message.content })
  }
  if (!message) throw new ClaudeUnavailable("Claude returned nothing")
  assertAnswered(message)

  // Sources: what the answer cites first, then anything else the search returned.
  const sources = new Map<string, string>()
  for (const block of message.content) {
    if (block.type !== "text") continue
    for (const citation of block.citations ?? []) {
      if (citation.type === "web_search_result_location" && !sources.has(citation.url)) {
        sources.set(citation.url, citation.title ?? new URL(citation.url).hostname.replace(/^www\./, ""))
      }
    }
  }
  for (const block of message.content) {
    // A failed search returns an error object here rather than a list of results.
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue
    for (const result of block.content) {
      if (!sources.has(result.url)) sources.set(result.url, result.title)
    }
  }
  return { text: textOf(message), sources: [...sources].map(([url, title]) => ({ url, title })) }
}

export async function claudeFacts(model: ClaudeModel, query: string): Promise<{ answer: string; sources: Source[] }> {
  try {
    const { text, sources } = await search(
      model,
      `${query}\n\nAnswer with at most four short lines of facts, each starting with "- ". ` +
        "Plain text only: no links, no markdown, no introduction, no closing remark. If you can't find it, say so in one line."
    )
    const answer = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .join("\n")
    if (!answer) throw new ClaudeUnavailable("Claude found nothing")
    return { answer, sources: sources.slice(0, 4) }
  } catch (error) {
    throw unavailable(error)
  }
}

const Products = z.object({
  products: z.array(
    z.object({
      brand: z.string(),
      name: z.string(),
      price: z.string().nullable(),
      store: z.string(),
      url: z.string(),
    })
  ),
})
export type ClaudeProduct = z.infer<typeof Products>["products"][number]

export async function claudeProducts(model: ClaudeModel, query: string): Promise<{ products: ClaudeProduct[]; sources: Source[] }> {
  try {
    // Web search answers carry citations, which can't be combined with a fixed output
    // format, so the JSON is asked for in the prompt and checked here.
    const { text, sources } = await search(
      model,
      `Find products for: ${query}\n\n` +
        "Return ONE popular, currently sold product for each brand or item named (at most 6 in total). For each: the brand, " +
        "the product's short name (no marketing claims, at most 8 words), its current price with currency symbol or null if you " +
        "could not find it, the store's name, and the URL of that exact product page. Prefer the brand's own online store. " +
        "Only use pages you actually found in the search; never guess a URL.\n\n" +
        'Reply with a single JSON object and nothing else, in exactly this shape: ' +
        '{"products": [{"brand": "", "name": "", "price": "" or null, "store": "", "url": ""}]}'
    )
    const json = /\{[\s\S]*\}/.exec(text)?.[0]
    if (!json) throw new ClaudeUnavailable("Claude did not return a product list")
    const parsed = Products.safeParse(JSON.parse(json))
    if (!parsed.success || parsed.data.products.length === 0) throw new ClaudeUnavailable("Claude's product list was empty or malformed")
    return { products: parsed.data.products.slice(0, 6), sources }
  } catch (error) {
    throw unavailable(error)
  }
}
