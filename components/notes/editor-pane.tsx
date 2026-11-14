"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react"
import type { EditorView } from "@tiptap/pm/view"
import {
  Check,
  ChevronLeft,
  Ellipsis,
  Folder as FolderIcon,
  Highlighter,
  ListChecks,
  Paperclip,
  PenTool,
  Search,
  Share,
  SquarePen,
  Table as TableIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fullDate } from "@/lib/dates"
import { startDrawing, useDrawing } from "@/lib/drawing-node"
import { describeNote, noteExtensions } from "@/lib/editor-kit"
import { FONT_SIZE_CHOICES, MAX_FONT_SIZE, MIN_FONT_SIZE, currentFontSize } from "@/lib/font-size"
import { imageToDataUrl } from "@/lib/media"
import { THOUGHTS, flattenFolders, useNotes, type Note } from "@/lib/store"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { openSpotlight } from "@/lib/search"
import { useIsMobile } from "@/lib/use-mobile"
import { DrawingPalette } from "./drawing-palette"
import { HomeButton } from "./mobile-dock"
import { RelatedNotes } from "./related-notes"
import { ThoughtPanels } from "./thought-panels"
import { Pill, ToolButton } from "./toolbar"

const extensions = noteExtensions("New Note")

function handlePaste(view: EditorView, event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
    f.type.startsWith("image/")
  )
  if (!file) return false
  void imageToDataUrl(file).then((src) => {
    const node = view.state.schema.nodes.image.create({ src })
    view.dispatch(view.state.tr.replaceSelectionWith(node))
  })
  return true
}

function download(filename: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function EditorPane() {
  const note = useNotes((s) => s.notes.find((n) => n.id === s.selectedNoteId) ?? null)
  if (!note) {
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <EditorToolbar editor={null} note={null} />
        <div className="grid flex-1 place-items-center text-[17px] text-muted-foreground/70">
          No Note Selected
        </div>
      </main>
    )
  }
  // Remount per note (and when it moves in or out of Recently Deleted) for a fresh editor.
  return <NoteEditor key={`${note.id}:${note.deletedAt ? "deleted" : "live"}`} note={note} />
}

function NoteEditor({ note }: { note: Note }) {
  const updateNote = useNotes((s) => s.updateNote)
  const restoreNote = useNotes((s) => s.restoreNote)
  const [initial] = useState(() => ({ content: note.content, focus: note.empty }))
  const mobile = useIsMobile()
  const drawing = useDrawing((s) => s.active)

  const editor = useEditor({
    // This component only ever renders on the client, so there is no hydration to wait for.
    immediatelyRender: true,
    extensions,
    content: initial.content,
    editable: !note.deletedAt,
    autofocus: initial.focus ? "start" : false,
    editorProps: {
      attributes: { class: "note-prose" },
      handlePaste,
    },
    onUpdate: ({ editor }) => {
      const patch = describeNote(editor)
      ownContent.current = patch.content
      updateNote(note.id, patch)
    },
  })

  // When the note is rewritten from outside (the server organising a thought, or an
  // edit on another device), show the new version instead of the stale one.
  const ownContent = useRef(note.content)
  useEffect(() => {
    if (!editor || note.content === ownContent.current) return
    ownContent.current = note.content
    editor.commands.setContent(note.content, { emitUpdate: false })
  }, [editor, note.content])

  // A quick thought gets its two side boxes; text keeps clear of them on wide screens.
  const isThought = note.folderId === THOUGHTS && !note.empty && !note.deletedAt

  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      <EditorToolbar editor={editor} note={note} />
      <div
        className={cn(
          "flex-1 overflow-y-auto px-6 max-md:px-4 print:overflow-visible",
          isThought && "xl:pr-[332px]"
        )}
        onClick={(e) => {
          // Clicking the blank area below the text puts the cursor at the end.
          if (e.target === e.currentTarget) editor?.commands.focus("end")
        }}
      >
        <p className="pt-[7px] pb-[9px] text-center text-[12px] leading-[15px] text-muted-foreground print:hidden">
          {fullDate(note.updatedAt)}
        </p>
        {note.deletedAt && (
          <div className="mb-3 flex items-center justify-center gap-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground print:hidden">
            Recently deleted notes can&apos;t be edited.
            <Button size="sm" variant="outline" onClick={() => restoreNote(note.id)}>
              Recover
            </Button>
          </div>
        )}
        {isThought && <ThoughtPanels note={note} />}
        <EditorContent editor={editor} />
      </div>
      {!note.deletedAt && !isThought && <RelatedNotes note={note} />}
      {!note.deletedAt && <DrawingPalette editor={editor} />}
      {/* Phones: one tap back to the capture screen, out of the way of the drawing tools. */}
      {mobile && !drawing && <HomeButton className="absolute right-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-10 print:hidden" />}
    </main>
  )
}

function EditorToolbar({ editor, note }: { editor: Editor | null; note: Note | null }) {
  const folders = useNotes((s) => s.folders)
  const mobile = useIsMobile()
  const setMobilePane = useNotes((s) => s.setMobilePane)
  const togglePin = useNotes((s) => s.togglePin)
  const moveNote = useNotes((s) => s.moveNote)
  const deleteNote = useNotes((s) => s.deleteNote)
  const restoreNote = useNotes((s) => s.restoreNote)
  const createNote = useNotes((s) => s.createNote)
  const fileInput = useRef<HTMLInputElement>(null)
  const drawing = useDrawing((s) => s.active)

  const state = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor && {
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        underline: editor.isActive("underline"),
        strike: editor.isActive("strike"),
        title: editor.isActive("heading", { level: 1 }),
        heading: editor.isActive("heading", { level: 2 }),
        subheading: editor.isActive("heading", { level: 3 }),
        body: editor.isActive("paragraph"),
        mono: editor.isActive("codeBlock"),
        bullet: editor.isActive("bulletList"),
        dashed: editor.isActive("dashedList"),
        ordered: editor.isActive("orderedList"),
        quote: editor.isActive("blockquote"),
        tasks: editor.isActive("taskList"),
        table: editor.isActive("table"),
        highlight: editor.isActive("highlight"),
        size: currentFontSize(editor),
        sized: editor.isActive("fontSize"),
      },
  })

  // Send focus back to the note, not the toolbar button, when a formatting menu closes.
  const editorFocus = useMemo(
    () => () => {
      editor?.commands.focus()
      return false
    },
    [editor]
  )

  const readOnly = !editor || !note || Boolean(note.deletedAt)

  // On a phone the note is its own screen, so deleting it returns to the list.
  const remove = (id: string) => {
    deleteNote(id)
    if (mobile) setMobilePane("list")
  }
  const run = () => editor!.chain().focus()

  const attach = async (file: File | undefined) => {
    if (!file || !editor) return
    const src = await imageToDataUrl(file)
    editor.chain().focus().setImage({ src }).run()
  }

  const styles: [label: string, active: boolean | undefined, apply: () => void, className?: string][] = [
    ["Title", state?.title, () => run().setHeading({ level: 1 }).run(), "text-lg font-bold"],
    ["Heading", state?.heading, () => run().setHeading({ level: 2 }).run(), "text-base font-bold"],
    ["Subheading", state?.subheading, () => run().setHeading({ level: 3 }).run(), "font-semibold"],
    ["Body", state?.body && !state.quote, () => run().setParagraph().run()],
    ["Monostyled", state?.mono, () => run().toggleCodeBlock().run(), "font-mono text-[13px]"],
  ]
  const lists: [label: string, active: boolean | undefined, apply: () => void][] = [
    ["• Bulleted List", state?.bullet, () => run().toggleBulletList().run()],
    ["– Dashed List", state?.dashed, () => run().toggleDashedList().run()],
    ["1. Numbered List", state?.ordered, () => run().toggleOrderedList().run()],
    ["Block Quote", state?.quote, () => run().toggleBlockquote().run()],
  ]
  const marks: [label: string, glyph: string, active: boolean | undefined, apply: () => void, className: string][] = [
    ["Bold", "B", state?.bold, () => run().toggleBold().run(), "font-bold"],
    ["Italic", "I", state?.italic, () => run().toggleItalic().run(), "italic"],
    ["Underline", "U", state?.underline, () => run().toggleUnderline().run(), "underline"],
    ["Strikethrough", "S", state?.strike, () => run().toggleStrike().run(), "line-through"],
    // On a phone the toolbar has no room for its own Highlight button, so it lives here too.
    ["Highlight", "H", state?.highlight, () => run().toggleHighlight().run(), "underline decoration-app-accent decoration-4 underline-offset-2"],
  ]

  return (
    <header className="box-content flex h-[52px] shrink-0 items-center gap-2 border-b px-2.5 pt-[env(safe-area-inset-top)] max-md:gap-1.5 max-md:px-2 print:hidden">
      {mobile ? (
        <Pill>
          <ToolButton label="Notes" onClick={() => setMobilePane("list")}>
            <ChevronLeft />
          </ToolButton>
        </Pill>
      ) : (
        <Pill>
          <ToolButton label="New Note" onClick={createNote}>
            <SquarePen />
          </ToolButton>
        </Pill>
      )}

      <div className="flex-1" />

      <Pill group>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={readOnly}
            render={<ToolButton label="Format" className="note-font text-[17px] font-medium" />}
          >
            Aa
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-52" finalFocus={editorFocus}>
            <div className="flex gap-1 p-1">
              {marks.map(([label, glyph, active, apply, className]) => (
                <button
                  key={label}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={apply}
                  className={cn(
                    "h-8 flex-1 rounded-md bg-foreground/[0.07] text-sm transition-colors duration-150 hover:bg-foreground/[0.14]",
                    active && "bg-app-accent text-white hover:bg-app-accent",
                    className
                  )}
                >
                  {glyph}
                </button>
              ))}
            </div>
            <div className="px-1 pt-0.5 pb-1.5" onKeyDown={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-1">
                <span className="flex-1 pl-1.5 text-[13px] text-muted-foreground">Size</span>
                <button
                  type="button"
                  aria-label="Smaller"
                  title="Smaller (⌘−)"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor!.commands.stepFontSize(-1)}
                  className="size-7 rounded-md bg-foreground/[0.07] text-sm transition-colors duration-150 hover:bg-foreground/[0.14]"
                >
                  −
                </button>
                {/* Any size: type it and press Return. */}
                <input
                  key={state?.size}
                  aria-label="Text size"
                  type="number"
                  min={MIN_FONT_SIZE}
                  max={MAX_FONT_SIZE}
                  step="any"
                  defaultValue={state?.size}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return
                    e.preventDefault()
                    const size = Number(e.currentTarget.value)
                    if (Number.isFinite(size) && size > 0) editor!.commands.setFontSize(size)
                  }}
                  className="h-7 w-14 rounded-md bg-foreground/[0.07] text-center text-sm tabular-nums outline-none [appearance:textfield] focus:ring-2 focus:ring-app-accent [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  aria-label="Bigger"
                  title="Bigger (⌘+)"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor!.commands.stepFontSize(1)}
                  className="size-7 rounded-md bg-foreground/[0.07] text-sm transition-colors duration-150 hover:bg-foreground/[0.14]"
                >
                  +
                </button>
              </div>
              <div className="grid grid-cols-5 gap-1 pt-1.5">
                {[null, ...FONT_SIZE_CHOICES, 64].map((size) => {
                  const active = size === null ? !state?.sized : state?.sized && state.size === size
                  return (
                    <button
                      key={size ?? "default"}
                      type="button"
                      aria-pressed={active}
                      title={size === null ? "The usual size for this line" : `${size} px`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => editor!.commands.setFontSize(size)}
                      className={cn(
                        "h-7 rounded-md bg-foreground/[0.07] text-[12.5px] tabular-nums transition-colors duration-150 hover:bg-foreground/[0.14]",
                        size === null && "col-span-2",
                        active && "bg-app-accent text-white hover:bg-app-accent"
                      )}
                    >
                      {size ?? "Default"}
                    </button>
                  )
                })}
              </div>
            </div>
            <DropdownMenuSeparator />
            {styles.map(([label, active, apply, className]) => (
              <CheckItem key={label} checked={active} onClick={apply}>
                <span className={className}>{label}</span>
              </CheckItem>
            ))}
            <DropdownMenuSeparator />
            {lists.map(([label, active, apply]) => (
              <CheckItem key={label} checked={active} onClick={apply}>
                {label}
              </CheckItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolButton
          label="Checklist"
          disabled={readOnly}
          active={state?.tasks}
          onClick={() => run().toggleTaskList().run()}
        >
          <ListChecks />
        </ToolButton>

        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={readOnly}
            render={<ToolButton label="Table" active={state?.table} />}
          >
            <TableIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-48" finalFocus={editorFocus}>
            {state?.table ? (
              <>
                <DropdownMenuItem onClick={() => run().addRowAfter().run()}>Add Row Below</DropdownMenuItem>
                <DropdownMenuItem onClick={() => run().addRowBefore().run()}>Add Row Above</DropdownMenuItem>
                <DropdownMenuItem onClick={() => run().addColumnAfter().run()}>Add Column After</DropdownMenuItem>
                <DropdownMenuItem onClick={() => run().addColumnBefore().run()}>Add Column Before</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => run().toggleHeaderRow().run()}>Toggle Header Row</DropdownMenuItem>
                <DropdownMenuItem onClick={() => run().deleteRow().run()}>Delete Row</DropdownMenuItem>
                <DropdownMenuItem onClick={() => run().deleteColumn().run()}>Delete Column</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => run().deleteTable().run()}>
                  Delete Table
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                onClick={() => run().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()}
              >
                Insert Table
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolButton
          label="Attach Image"
          disabled={readOnly}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip />
        </ToolButton>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void attach(e.target.files?.[0])
            e.target.value = ""
          }}
        />

        <ToolButton label="Draw" disabled={readOnly} active={drawing} onClick={() => startDrawing(editor!)}>
          <PenTool />
        </ToolButton>

        {!mobile && (
          <ToolButton
            label="Highlight"
            disabled={readOnly}
            active={state?.highlight}
            onClick={() => run().toggleHighlight().run()}
          >
            <Highlighter />
          </ToolButton>
        )}
      </Pill>

      <div className="flex-1" />

      <Pill group>
        <DropdownMenu>
          <DropdownMenuTrigger disabled={!editor || !note} render={<ToolButton label="Share" />}>
            <Share />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => void navigator.clipboard.writeText(editor!.getText())}
            >
              Copy as Text
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                download(`${note!.title || "Note"}.txt`, "text/plain", editor!.getText())
              }
            >
              Export as Text
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                download(
                  `${note!.title || "Note"}.html`,
                  "text/html",
                  `<!doctype html><meta charset="utf-8"><title>${note!.title}</title>${editor!.getHTML()}`
                )
              }
            >
              Export as HTML
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTimeout(() => window.print(), 150)}>
              Print…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger disabled={!note} render={<ToolButton label="More" />}>
            <Ellipsis />
          </DropdownMenuTrigger>
          {note && (
            <DropdownMenuContent align="end" className="w-48">
              {note.deletedAt ? (
                <>
                  <DropdownMenuItem onClick={() => restoreNote(note.id)}>Recover</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => remove(note.id)}>
                    Delete Permanently
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => togglePin(note.id)}>
                    {note.pinned ? "Unpin Note" : "Pin Note"}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      {flattenFolders(folders).map(({ folder, depth }) => (
                        <DropdownMenuItem
                          key={folder.id}
                          disabled={folder.id === note.folderId}
                          onClick={() => moveNote(note.id, folder.id)}
                        >
                          <FolderIcon style={{ marginLeft: depth * 12 }} />
                          <span className="truncate">{folder.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => remove(note.id)}>
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </Pill>

      {!mobile && (
        <Pill>
          <ToolButton label="Search (⌘K)" onClick={openSpotlight}>
            <Search />
          </ToolButton>
        </Pill>
      )}
    </header>
  )
}

function CheckItem({
  checked,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuItem> & { checked?: boolean }) {
  return (
    <DropdownMenuItem {...props}>
      <Check className={cn("size-3.5", !checked && "invisible")} />
      {children}
    </DropdownMenuItem>
  )
}
