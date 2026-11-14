"use client"

import { useRef, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import {
  ArrowUpRight,
  ChevronDown,
  Globe,
  Layers,
  Link2,
  MapPin,
  PencilLine,
  Quote,
  Sparkles,
  Tag,
  TriangleAlert,
} from "lucide-react"
import { create } from "zustand"
import { cn } from "@/lib/utils"
import { RERUN_MODEL, modelName, type Original, type ThoughtAction } from "@/lib/context"
import { fullDate } from "@/lib/dates"
import { noteExtensions } from "@/lib/editor-kit"
import { displayTitle, useNotes, type Note } from "@/lib/store"
import { supabase } from "@/lib/supabase"
import { expectUpdates } from "@/lib/sync"
import { Button } from "@/components/ui/button"
import { useRelatedNotes } from "./related-notes"

// A hairline and a faint lift only: a wide, soft shadow would be cut off by the
// scrolling column and show up as a grey slab behind the boxes.
const PANEL =
  "rounded-[18px] p-4 shadow-[0_0_0_0.5px_rgb(0_0_0/0.1),0_1px_2px_rgb(0_0_0/0.05)] dark:shadow-[inset_0_0.5px_0_rgb(255_255_255/0.12),0_0_0_0.5px_rgb(0_0_0/0.6)]"

/**
 * Thoughts the user has asked to have processed again, with the write-up each had at
 * the time. A thought stays "in progress" until a newer write-up arrives.
 */
const useReruns = create<{ asked: Record<string, string> }>(() => ({ asked: {} }))

/**
 * The two boxes that float beside a quick thought's editor: the words the user
 * actually captured (editable; saving reprocesses the thought) and what was done with
 * them. On narrower screens they sit above the note behind a toggle instead.
 */
export function ThoughtPanels({ note }: { note: Note }) {
  const [open, setOpen] = useState(false)

  return (
    <aside
      data-thought-panels
      className="select-text xl:absolute xl:top-[64px] xl:right-4 xl:max-h-[calc(100%-80px)] xl:w-[300px] xl:overflow-y-auto xl:p-1 print:hidden"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mb-3 flex h-9 w-full items-center gap-2 rounded-xl bg-app-accent/15 px-3 text-[13px] font-medium select-none xl:hidden"
      >
        <Quote className="size-3.5 fill-current" />
        Original thought and actions
        <ChevronDown className={cn("ml-auto size-4 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div className={cn("grid gap-3 max-xl:pb-4", !open && "max-xl:hidden")}>
        <OriginalBoxes note={note} />
        <ActionsBox note={note} />
      </div>
    </aside>
  )
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** An original's formatted content. Captures from before formatting was kept only have plain text. */
const originalHtml = (original: Original) =>
  // The composer leaves an empty line after a list; it is not part of the thought.
  original.html?.trim().replace(/(?:<p><\/p>)+$/, "") ||
  original.text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("")

/** Splits the combined editor's content back into one original per divider-separated part. */
function splitOriginals(html: string): { html: string; text: string }[] {
  const parts: Element[][] = [[]]
  for (const element of new DOMParser().parseFromString(html, "text/html").body.children) {
    if (element.tagName === "HR") parts.push([])
    else parts[parts.length - 1].push(element)
  }
  const blank = (element?: Element) => element?.tagName === "P" && !element.textContent?.trim()
  return parts
    .map((elements) => {
      while (blank(elements[elements.length - 1])) elements.pop()
      return elements
    })
    .map((elements) => ({
      html: elements.map((element) => element.outerHTML).join(""),
      // One line per block of text, as the pipeline expects.
      text: elements
        .flatMap((element) => {
          const blocks = element.matches("p, h1, h2, h3, pre") ? [element] : [...element.querySelectorAll("p, h1, h2, h3, pre")]
          return (blocks.length > 0 ? blocks : [element]).map((block) => block.textContent?.trim() ?? "")
        })
        .filter(Boolean)
        .join("\n"),
    }))
    .filter((part) => part.text)
}

/** One capture, shown with the formatting it was entered with. */
function OriginalView({ html }: { html: string }) {
  const editor = useEditor({
    immediatelyRender: true,
    extensions: noteExtensions(""),
    content: html,
    editable: false,
    editorProps: { attributes: { class: "note-prose note-prose-original" } },
  })
  return <EditorContent editor={editor} />
}

/** All the captures in one editor, separated by dividers, with the usual auto-formatting. */
function OriginalsEditor({ originals, onSave, onCancel }: { originals: Original[]; onSave: (parts: { html: string; text: string }[], changed: boolean) => void; onCancel: () => void }) {
  // What the editor made of the content it was given, to tell a real edit from none.
  const initial = useRef("")
  const editor = useEditor({
    immediatelyRender: true,
    extensions: noteExtensions("Your thought"),
    content: originals.map(originalHtml).join("<hr>"),
    autofocus: "end",
    editorProps: { attributes: { class: "note-prose note-prose-original", "aria-label": "Original thought" } },
    onCreate: ({ editor }) => {
      initial.current = editor.getHTML()
    },
  })

  return (
    <div className="grid gap-2.5 pt-2.5">
      <div className="rounded-xl bg-background/80 px-3 py-2 ring-1 ring-foreground/15 focus-within:ring-2 focus-within:ring-app-accent">
        <EditorContent editor={editor} />
      </div>
      <p className="text-[12px] leading-snug text-foreground/60">
        {originals.length > 1 && "Each line across separates one thought from the next. "}
        Saving writes this note again from the original, replacing any edits you made to it.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => editor && onSave(splitOriginals(editor.getHTML()), editor.getHTML() !== initial.current)}>
          Save and Reprocess
        </Button>
      </div>
    </div>
  )
}

const ORIGINAL_PANEL = cn(PANEL, "bg-[color-mix(in_oklch,var(--app-accent)_16%,var(--background))]/90 ring-1 ring-app-accent/25")

/**
 * The words the user actually captured. Thoughts that were merged each keep their own
 * box; editing brings them together in one editor.
 */
function OriginalBoxes({ note }: { note: Note }) {
  const setOriginals = useNotes((s) => s.setOriginals)
  // Until the thought has been processed, the note itself is the original.
  const originals: Original[] =
    note.originals && note.originals.length > 0
      ? note.originals
      : [{ at: new Date(note.createdAt).toISOString(), text: note.text, html: note.content.replace(/<(img|audio)\b[^>]*>(?:<\/audio>)?/g, "") }]
  const [editing, setEditing] = useState(false)

  const save = (parts: { html: string; text: string }[], changed: boolean) => {
    setEditing(false)
    if (!changed || parts.length === 0) return
    // Only a change to the words needs the note written again; new formatting is just kept.
    const words = (text: string) => text.split(/\s+/).filter(Boolean).join(" ")
    const reworded = parts.length !== originals.length || parts.some((part, i) => words(part.text) !== words(originals[i].text))
    const next = parts.map((part, i) => ({
      ...(originals[i] ?? { at: new Date().toISOString() }),
      ...(reworded ? part : { html: part.html }),
    }))
    setOriginals(note.id, next, reworded)
  }

  if (editing) {
    return (
      <section className={ORIGINAL_PANEL}>
        <h2 className="flex items-center gap-2 text-[13.5px] font-bold">
          <Quote className="size-3.5 fill-current" />
          {originals.length > 1 ? "Original thoughts" : "Original thought"}
        </h2>
        <OriginalsEditor originals={originals} onSave={save} onCancel={() => setEditing(false)} />
      </section>
    )
  }

  return (
    <>
      {originals.map((original, i) => (
        <section key={i} data-original className={ORIGINAL_PANEL}>
          <h2 className="flex items-center gap-2 text-[13.5px] font-bold">
            <Quote className="size-3.5 fill-current" />
            Original thought
            {originals.length > 1 && <span className="font-normal text-foreground/55">{i + 1} of {originals.length}</span>}
            <button
              type="button"
              aria-label={originals.length > 1 ? "Edit original thoughts" : "Edit original thought"}
              title="Edit: saving rewrites this note from the original"
              onClick={() => setEditing(true)}
              className="ml-auto grid size-7 place-items-center rounded-full text-foreground/60 transition-colors duration-150 hover:bg-foreground/[0.08] hover:text-foreground"
            >
              <PencilLine className="size-[15px]" />
            </button>
          </h2>
          <div className="pt-2">
            {/* Keyed by its content, so a changed original gets a fresh view. */}
            <OriginalView key={originalHtml(original)} html={originalHtml(original)} />
          </div>
          {originals.length > 1 && <p className="pt-1.5 text-[11.5px] text-foreground/55">{fullDate(Date.parse(original.at))}</p>}
        </section>
      ))}
    </>
  )
}

function ActionsBox({ note }: { note: Note }) {
  const openThought = useNotes((s) => s.openThought)
  const related = useRelatedNotes(note)
  const enrichment = note.enrichment ?? null
  const context = note.context ?? {}
  const merged = note.originals?.length ?? 0
  const actions = enrichment?.actions ?? []
  // `undefined` means the server hasn't processed this version of the thought yet.
  const pending = note.enrichment === undefined

  const askedAt = useReruns((s) => s.asked[note.id])
  const rerunning = askedAt !== undefined && askedAt === (enrichment?.written_at ?? "")
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const rerun = async () => {
    setConfirming(false)
    setProblem(null)
    const { data, error } = await supabase()
      .from("notes")
      .update({ enrich_request: { model: RERUN_MODEL, at: new Date().toISOString() } })
      .eq("id", note.id)
      .select("id")
    if (error) return setProblem("Couldn't reach the server. Try again when you're online.")
    if (data.length === 0) return setProblem("This thought hasn't finished syncing yet. Try again in a moment.")
    useReruns.setState((s) => ({ asked: { ...s.asked, [note.id]: enrichment?.written_at ?? "" } }))
    expectUpdates()
  }

  return (
    <section className={cn(PANEL, "bg-background")}>
      <h2 className="text-[13.5px] font-bold">Actions taken</h2>
      <ol className="pt-2.5">
        <Step icon={<MapPin />} title="Captured context">
          {[context.weekday && context.part_of_day ? `${context.weekday} ${context.part_of_day}` : fullDate(note.createdAt), context.lat !== undefined ? "place saved" : null, context.source && context.source !== "typed" ? `from a ${context.source === "voice" ? "voice note" : context.source}` : null]
            .filter(Boolean)
            .join(" · ")}
        </Step>
        {merged > 1 && (
          <Step icon={<Layers />} title="Merged similar thoughts">
            {merged} captures about the same thing, combined into this note.
          </Step>
        )}
        {enrichment?.title && (
          <Step icon={<PencilLine />} title="Wrote it up">
            {enrichment.written_by ? `By ${modelName(enrichment.written_by)}, from the original.` : "Title and body written from the original."}
            {enrichment.fallback && enrichment.written_by && !enrichment.written_by.startsWith("claude") && " Claude wasn't available."}
          </Step>
        )}
        {enrichment && (
          <Step icon={<Tag />} title="Added topics">
            <span className="capitalize">{enrichment.category}</span>
            {enrichment.tags
              .filter((tag) => tag !== enrichment.category)
              .slice(0, 4)
              .map((tag) => ` · ${tag}`)}
          </Step>
        )}
        {related.length > 0 && (
          <Step icon={<Link2 />} title={related.length > 1 ? "Linked memories" : "Linked a memory"}>
            <span className="grid gap-0.5">
              {related.map((other) => (
                <button
                  key={other.id}
                  type="button"
                  onClick={() => openThought(other.id)}
                  className="note-font flex items-center gap-1 text-left text-foreground underline decoration-app-accent decoration-2 underline-offset-3 hover:decoration-foreground/60"
                >
                  <span className="truncate">{displayTitle(other)}</span>
                  <ArrowUpRight className="size-3.5 shrink-0" />
                </button>
              ))}
            </span>
          </Step>
        )}
        {actions.map((action, i) => (
          <Step
            key={i}
            icon={action.status === "failed" ? <TriangleAlert /> : action.type === "fetch_link" ? <Globe /> : <Sparkles />}
            title={actionTitle(action)}
            busy={action.status === "running"}
          >
            {actionDetail(action)}
          </Step>
        ))}
        {pending && (
          <Step icon={<Sparkles />} title="Organising" busy>
            Checking for similar thoughts, then writing this up.
          </Step>
        )}
        {rerunning && !pending && (
          <Step icon={<Sparkles />} title="Reprocessing with extra thinking effort" busy>
            The note will be rewritten here when it&apos;s done.
          </Step>
        )}
      </ol>

      <div className="mt-3.5 border-t border-foreground/10 pt-3 select-none">
        {confirming ? (
          <>
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              This rewrites the whole note from the original with extra thinking effort, replacing any edits you made to it.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={rerun}>
                Reprocess
              </Button>
            </div>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={pending || rerunning}
            onClick={() => setConfirming(true)}
          >
            <Sparkles />
            Reprocess with extra thinking effort
          </Button>
        )}
        {problem && (
          <p role="alert" className="pt-2 text-[12.5px] leading-snug text-destructive">
            {problem}
          </p>
        )}
      </div>
    </section>
  )
}

function actionTitle(action: ThoughtAction): string {
  if (action.type === "fetch_link") return action.status === "failed" ? "Couldn't read the link" : action.status === "running" ? "Reading the link" : "Read the linked page"
  return action.status === "failed" ? "Web lookup failed" : action.status === "running" ? "Looking it up" : "Looked it up on the web"
}

function actionDetail(action: ThoughtAction): string {
  if (action.status === "failed") return action.result?.error ?? "Something went wrong."
  if (action.type === "fetch_link") return action.result?.title ?? action.input
  if (action.status !== "done") return action.label
  const found = action.result?.products?.length
  return found
    ? `Found ${found} ${found === 1 ? "product" : "products"}. Added to the note; check prices before relying on them.`
    : `${action.label}. Added to the note; check before relying on it.`
}

/** One entry in the "Actions taken" timeline. */
function Step({ icon, title, busy, children }: { icon: React.ReactNode; title: string; busy?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-2.5 pb-3.5 last:pb-0 [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:top-7 [&:not(:last-child)]:before:bottom-0 [&:not(:last-child)]:before:left-[13px] [&:not(:last-child)]:before:w-px [&:not(:last-child)]:before:bg-app-accent/35">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-app-accent/15 text-foreground/70 [&_svg]:size-[14px]">
        {busy ? <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-foreground/15 border-t-app-accent" /> : icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-[13px] leading-tight font-semibold">{title}</p>
        <div className="pt-0.5 text-[12.5px] leading-snug text-muted-foreground">{children}</div>
      </div>
    </li>
  )
}
