"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { EditorContent, useEditor } from "@tiptap/react"
import {
  ArrowUp,
  Image as ImageIcon,
  Check,
  Library,
  ListChecks,
  Mic,
  PenLine,
  Search,
  Square,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { refreshPosition } from "@/lib/context"
import { todayLabel } from "@/lib/dates"
import { describeNote, noteExtensions } from "@/lib/editor-kit"
import { formatDuration, imageToDataUrl } from "@/lib/media"
import { openSpotlight } from "@/lib/search"
import { useNotes } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { AccountButton } from "@/components/account/account-button"
import { Pill, ToolButton } from "@/components/notes/toolbar"
import { AudioChip } from "./audio-chip"
import { Doodles } from "./doodles"
import { SketchPad } from "./sketch-pad"
import { useRecorder } from "./use-recorder"

const spring = { type: "spring", duration: 0.4, bounce: 0 } as const
const extensions = noteExtensions("What's on your mind?")

export function CaptureHome() {
  const draft = useNotes((s) => s.draft)
  const setDraftContent = useNotes((s) => s.setDraftContent)
  const addAttachment = useNotes((s) => s.addAttachment)
  const removeAttachment = useNotes((s) => s.removeAttachment)
  const captureThought = useNotes((s) => s.captureThought)
  const setView = useNotes((s) => s.setView)

  const [sketching, setSketching] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const recorder = useRecorder((src, seconds) =>
    addAttachment({ kind: "audio", src, seconds })
  )

  const canSave =
    !recorder.recording &&
    !sketching &&
    (!draft.empty || draft.attachments.length > 0)

  const addImages = async (files: Iterable<File>) => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue
      addAttachment({ kind: "image", src: await imageToDataUrl(file) })
    }
  }

  // The same editor the notes use, so lists, checkboxes and headings format as you type.
  const [initialContent] = useState(draft.content)
  const editor = useEditor({
    immediatelyRender: true,
    extensions,
    content: initialContent,
    autofocus: "end",
    editorProps: {
      attributes: { class: "note-prose note-prose-compose", "aria-label": "New thought" },
      // Cmd+Return saves (handled on the window below) instead of inserting a line break.
      handleKeyDown: (_view, event) => (event.metaKey || event.ctrlKey) && event.key === "Enter",
      // Pasted images join the attachments rather than landing inside the text.
      handlePaste: (_view, event) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith("image/")
        )
        if (images.length === 0) return false
        void addImages(images)
        return true
      },
    },
    onUpdate: ({ editor }) => setDraftContent(editor.getHTML(), editor.isEmpty),
  })

  // With location switched on, keep a recent fix ready so saving never waits for one.
  const locationEnabled = useNotes((s) => s.locationEnabled)
  useEffect(() => {
    if (locationEnabled) void refreshPosition()
  }, [locationEnabled])

  const [savedAt, setSavedAt] = useState<number | null>(null)
  useEffect(() => {
    if (savedAt === null) return
    const timer = setTimeout(() => setSavedAt(null), 2200)
    return () => clearTimeout(timer)
  }, [savedAt])

  const save = () => {
    if (!canSave) return
    captureThought(draft.empty ? null : describeNote(editor))
    setSavedAt(Date.now())
    if (locationEnabled) void refreshPosition()
    editor.commands.clearContent()
    editor.commands.focus()
  }

  // Keep the newest handler reachable from the one-time window listener below.
  const saveRef = useRef(save)
  const focusRef = useRef(() => {})
  useEffect(() => {
    saveRef.current = save
    focusRef.current = () => editor.commands.focus()
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault()
        saveRef.current()
        return
      }
      // Start typing anywhere and it lands in the composer.
      const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey
      if (typing && document.activeElement === document.body) focusRef.current()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files")

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-background"
      onPaste={(e) => {
        // Already taken by the composer when the cursor is in it.
        if (e.defaultPrevented) return
        const images = Array.from(e.clipboardData.files).filter((f) =>
          f.type.startsWith("image/")
        )
        if (images.length === 0) return
        e.preventDefault()
        void addImages(images)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDragging(false)
        void addImages(e.dataTransfer.files)
      }}
    >
      <Doodles />
      <div className="relative h-full overflow-y-auto">
      <header className="sticky top-0 z-10 box-content flex h-[52px] items-center px-2.5 pt-[env(safe-area-inset-top)] max-sm:px-2">
        <Pill>
          <Button
            variant="ghost"
            onClick={() => setView("library")}
            className="h-9 gap-2 rounded-full px-3.5 text-[13px] font-medium text-foreground/80 hover:bg-foreground/[0.06] active:not-aria-[haspopup]:translate-y-0"
          >
            <Library className="size-[17px] [stroke-width:1.75]" />
            All Notes
          </Button>
        </Pill>
        <div className="flex-1" />
        <Pill className="mr-2">
          <ToolButton label="Search (⌘K)" onClick={openSpotlight}>
            <Search />
          </ToolButton>
        </Pill>
        <AccountButton />
      </header>

      <main className="mx-auto w-full max-w-[660px] px-3 pt-1 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-[9vh] sm:pb-24">
        <p className="pb-3 pl-1 text-[13px] font-medium text-muted-foreground">
          {todayLabel()}
        </p>

        <div
          className={cn(
            "rounded-[22px] bg-card shadow-[0_0_0_0.5px_rgb(0_0_0/0.08),0_2px_6px_rgb(0_0_0/0.04),0_14px_40px_rgb(0_0_0/0.08)] outline-0 outline-app-accent/60 transition-[outline-width] duration-150 dark:shadow-[inset_0_0.5px_0_rgb(255_255_255/0.12),0_14px_40px_rgb(0_0_0/0.5)]",
            dragging && "outline-[3px]"
          )}
        >
          <EditorContent
            editor={editor}
            className="max-h-[45vh] overflow-y-auto px-5 pt-[18px] pb-2"
          />

          {draft.attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5 px-4 pt-1 pb-3">
              <AnimatePresence initial={false} mode="popLayout">
                {draft.attachments.map((attachment) => (
                  <motion.div
                    key={attachment.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={spring}
                    className="group/item relative"
                  >
                    {attachment.kind === "audio" ? (
                      <AudioChip src={attachment.src} seconds={attachment.seconds ?? 0} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- local data URL
                      <img
                        src={attachment.src}
                        alt={attachment.kind === "sketch" ? "Sketch" : "Attached image"}
                        className="h-20 max-w-40 rounded-xl bg-white object-cover ring-1 ring-foreground/10"
                      />
                    )}
                    <button
                      type="button"
                      aria-label="Remove attachment"
                      onClick={() => removeAttachment(attachment.id)}
                      className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background opacity-0 shadow-sm pointer-coarse:size-6 pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-[''] transition-opacity duration-150 group-hover/item:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="size-3" strokeWidth={3} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          {sketching && (
            <SketchPad
              onCancel={() => setSketching(false)}
              onDone={(src) => {
                addAttachment({ kind: "sketch", src })
                setSketching(false)
              }}
            />
          )}

          {recorder.recording && (
            <div className="mx-3 mb-2 flex h-12 items-center gap-3 rounded-2xl bg-foreground/[0.05] pr-1.5 pl-4">
              <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
              <span className="w-9 text-[13px] font-medium tabular-nums">
                {formatDuration(recorder.seconds)}
              </span>
              <div
                aria-hidden
                className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden"
              >
                {recorder.levels.map((level, i) => (
                  <span
                    key={i}
                    className="w-[3px] shrink-0 rounded-full bg-foreground/55"
                    style={{ height: 3 + level * 26 }}
                  />
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => recorder.stop(false)}>
                Discard
              </Button>
              <Button size="sm" onClick={() => recorder.stop()}>
                <Square className="size-3 fill-current" />
                Done
              </Button>
            </div>
          )}

          {recorder.error && (
            <p className="px-5 pb-2 text-[13px] text-destructive">{recorder.error}</p>
          )}

          <div className="flex items-center gap-0.5 px-2.5 pb-2.5">
            <ToolButton
              label="Checklist"
              onClick={() => editor.chain().focus().toggleTaskList().run()}
            >
              <ListChecks />
            </ToolButton>
            <ToolButton label="Add image" onClick={() => fileInput.current?.click()}>
              <ImageIcon />
            </ToolButton>
            <ToolButton
              label={recorder.recording ? "Finish recording" : "Record voice note"}
              active={recorder.recording}
              disabled={sketching}
              onClick={() => (recorder.recording ? recorder.stop() : void recorder.start())}
            >
              <Mic />
            </ToolButton>
            <ToolButton
              label="Sketch"
              active={sketching}
              disabled={recorder.recording}
              onClick={() => setSketching((open) => !open)}
            >
              <PenLine />
            </ToolButton>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void addImages(Array.from(e.target.files ?? []))
                e.target.value = ""
              }}
            />
            <div className="flex-1" />
            <kbd className="pr-2.5 font-sans text-[12px] text-muted-foreground/70 pointer-coarse:hidden">⌘ Return</kbd>
            <button
              type="button"
              aria-label="Save thought"
              title="Save thought"
              disabled={!canSave}
              onClick={save}
              className="grid size-9 place-items-center rounded-full bg-app-accent text-white pointer-coarse:size-10 transition-[scale,opacity,background-color] duration-150 active:scale-90 disabled:bg-foreground/10 disabled:text-foreground/30"
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* The only sign that a thought was kept, now that nothing is listed here. */}
        <div aria-live="polite" className="flex h-10 items-center justify-center">
          <AnimatePresence>
            {savedAt !== null && (
              <motion.p
                key={savedAt}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
              >
                <Check className="size-4 text-app-accent" strokeWidth={2.5} />
                Saved to Quick Thoughts
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </main>
      </div>
    </div>
  )
}
