"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  ChevronLeft,
  Ellipsis,
  Folder as FolderIcon,
  House,
  PanelLeft,
  SquarePen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { groupLabel, listDate } from "@/lib/dates"
import {
  ALL,
  TRASH,
  displaySnippet,
  displayTitle,
  flattenFolders,
  useNotes,
  visibleNotes,
  type Note,
  type SortBy,
} from "@/lib/store"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsMobile } from "@/lib/use-mobile"
import { GROUP_CARD, MobileDock, MobileScreen, TOP_BUTTON } from "./mobile-dock"
import { NOTE_DRAG_TYPE } from "./sidebar"
import { Pill, ToolButton } from "./toolbar"

type Item = { kind: "header"; label: string } | { kind: "note"; note: Note }

const slide = { type: "spring", duration: 0.38, bounce: 0 } as const
const appear = {
  layout: "position",
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97 },
  transition: slide,
} as const

const rowElement = (id: string) =>
  document.querySelector<HTMLElement>(`[data-note-id="${id}"]`)

export function NoteList({ width }: { width: number | string }) {
  const mobile = useIsMobile()
  const notes = useNotes((s) => s.notes)
  const folders = useNotes((s) => s.folders)
  const selectedFolderId = useNotes((s) => s.selectedFolderId)
  const selectedNoteId = useNotes((s) => s.selectedNoteId)
  const sortBy = useNotes((s) => s.sortBy)
  const sidebarOpen = useNotes((s) => s.sidebarOpen)
  const toggleSidebar = useNotes((s) => s.toggleSidebar)
  const setView = useNotes((s) => s.setView)
  const selectNote = useNotes((s) => s.selectNote)

  const inTrash = selectedFolderId === TRASH

  // Headers and notes are one flat list so rows can animate between sections.
  const { items, order } = useMemo(() => {
    const list = visibleNotes({ notes, selectedFolderId, sortBy })
    const items: Item[] = []
    let current: string | null | undefined
    for (const note of list) {
      const label =
        note.pinned && !note.deletedAt
          ? "Pinned"
          : sortBy === "title"
            ? null
            : groupLabel(note[sortBy])
      if (label !== current) {
        if (label) items.push({ kind: "header", label })
        current = label
      }
      items.push({ kind: "note", note })
    }
    return { items, order: list.map((n) => n.id) }
  }, [notes, selectedFolderId, sortBy])

  useEffect(() => {
    if (selectedNoteId) rowElement(selectedNoteId)?.scrollIntoView({ block: "nearest" })
  }, [selectedNoteId])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const index = order.indexOf(selectedNoteId ?? "")
    const next = order[e.key === "ArrowDown" ? index + 1 : Math.max(index - 1, 0)]
    if (!next || next === selectedNoteId) return
    selectNote(next)
    requestAnimationFrame(() => rowElement(next)?.focus())
  }

  const folderName = (id: string) => folders.find((f) => f.id === id)?.name ?? null
  const title = selectedFolderId === ALL
      ? "All Notes"
      : inTrash
        ? "Recently Deleted"
        : (folderName(selectedFolderId) ?? "Notes")
  const showFolder = selectedFolderId === ALL

  if (mobile) {
    return <MobileNoteList title={title} items={items} count={order.length} inTrash={inTrash} folderName={showFolder ? folderName : null} />
  }

  return (
    <section className="flex shrink-0 flex-col print:hidden" style={{ width }}>
      <header className="box-content flex h-[52px] shrink-0 items-center gap-2 border-b pt-[env(safe-area-inset-top)] pr-2.5 pl-2.5">
        <AnimatePresence initial={false}>
          {!mobile && !sidebarOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.6, width: 0 }}
              animate={{ opacity: 1, scale: 1, width: 82 }}
              exit={{ opacity: 0, scale: 0.6, width: 0 }}
              transition={slide}
            >
              <Pill group>
                <ToolButton label="Home" onClick={() => setView("home")}>
                  <House />
                </ToolButton>
                <ToolButton label="Show Folders" onClick={toggleSidebar}>
                  <PanelLeft />
                </ToolButton>
              </Pill>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="min-w-0 flex-1 pl-2.5">
          <div className="truncate text-[13px] leading-4 font-bold">{title}</div>
          <div className="text-[11px] leading-[14px] text-muted-foreground">
            {order.length} {order.length === 1 ? "note" : "notes"}
          </div>
        </div>
        <Pill>
          <ListOptions inTrash={inTrash} count={order.length}>
            <ToolButton label="List options">
              <Ellipsis />
            </ToolButton>
          </ListOptions>
        </Pill>
      </header>

      <motion.div
        layoutScroll
        onKeyDown={onKeyDown}
        className="group/list flex-1 overflow-x-hidden overflow-y-auto px-2.5 pb-6"
      >
        {order.length === 0 && (
          <p className="pt-16 text-center text-[13px] text-muted-foreground">
            No Notes
          </p>
        )}
        {/* Keyed by view: switching folders swaps the list instantly, changes within one animate. */}
        <div key={selectedFolderId} className="relative">
          <AnimatePresence mode="popLayout" initial={false}>
            {items.map((item, i) => {
              if (item.kind === "header") {
                return (
                  <motion.h2
                    key={`header:${item.label}`}
                    {...appear}
                    className={cn(
                      "mx-1.5 mb-2 border-b pb-2 text-[15px] leading-5 font-bold",
                      i === 0 ? "pt-3" : "pt-7"
                    )}
                  >
                    {item.label}
                  </motion.h2>
                )
              }
              const { note } = item
              const previous = items[i - 1]
              return (
                <motion.div key={note.id} {...appear}>
                  <NoteRow
                    note={note}
                    selected={note.id === selectedNoteId}
                    divider={
                      previous?.kind === "note" &&
                      note.id !== selectedNoteId &&
                      previous.note.id !== selectedNoteId
                    }
                    folderName={showFolder ? folderName(note.folderId) : null}
                  />
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </motion.div>
    </section>
  )
}

function NoteRow({
  note,
  selected,
  divider,
  folderName,
}: {
  note: Note
  selected: boolean
  divider: boolean
  folderName: string | null
}) {
  const sortBy = useNotes((s) => s.sortBy)
  const selectNote = useNotes((s) => s.selectNote)

  const date = listDate(sortBy === "createdAt" ? note.createdAt : note.updatedAt)
  const secondary = selected ? "text-foreground/55" : "text-muted-foreground"

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            data-note-id={note.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(NOTE_DRAG_TYPE, note.id)
              e.dataTransfer.effectAllowed = "move"
            }}
            onClick={() => selectNote(note.id)}
            onKeyDown={(e) => e.key === "Enter" && selectNote(note.id)}
            className={cn(
              "relative scroll-my-2 rounded-[10px] px-6 py-[7px] text-[12.5px] leading-[18px] outline-none pointer-coarse:py-2.5 pointer-coarse:text-[15px] pointer-coarse:leading-[21px]",
              // Yellow while the list has focus, gray once focus moves to the note.
              selected && "bg-foreground/[0.13] group-focus-within/list:bg-note-selected"
            )}
          />
        }
      >
        {divider && <span className="absolute inset-x-1.5 top-0 border-t" />}
        <div className="note-font truncate text-[13px] font-bold pointer-coarse:text-[16px]">{displayTitle(note)}</div>
        <div className="flex gap-2">
          <span className="shrink-0 tabular-nums">{date}</span>
          <span className={cn("note-font truncate", secondary)}>
            {displaySnippet(note)}
          </span>
        </div>
        {folderName && (
          <div className={cn("flex items-center gap-1.5", secondary)}>
            <FolderIcon strokeWidth={1.7} className="size-[13px]" />
            <span className="truncate">{folderName}</span>
          </div>
        )}
      </ContextMenuTrigger>

      <NoteMenu note={note} />
    </ContextMenu>
  )
}

/** What you can do to a note from its row: right-click on a computer, touch and hold on a phone. */
function NoteMenu({ note }: { note: Note }) {
  const folders = useNotes((s) => s.folders)
  const deleteNote = useNotes((s) => s.deleteNote)
  const restoreNote = useNotes((s) => s.restoreNote)
  const togglePin = useNotes((s) => s.togglePin)
  const moveNote = useNotes((s) => s.moveNote)

  return (
      <ContextMenuContent className="w-48">
        {note.deletedAt ? (
          <>
            <ContextMenuItem onClick={() => restoreNote(note.id)}>Recover</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => deleteNote(note.id)}>
              Delete Permanently
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={() => togglePin(note.id)}>
              {note.pinned ? "Unpin Note" : "Pin Note"}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                {flattenFolders(folders).map(({ folder, depth }) => (
                  <ContextMenuItem
                    key={folder.id}
                    disabled={folder.id === note.folderId}
                    onClick={() => moveNote(note.id, folder.id)}
                  >
                    <FolderIcon style={{ marginLeft: depth * 12 }} />
                    <span className="truncate">{folder.name}</span>
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => deleteNote(note.id)}>
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
  )
}

/** Sorting, and emptying Recently Deleted. */
function ListOptions({ inTrash, count, children }: { inTrash: boolean; count: number; children: React.ReactElement }) {
  const sortBy = useNotes((s) => s.sortBy)
  const setSortBy = useNotes((s) => s.setSortBy)
  const emptyTrash = useNotes((s) => s.emptyTrash)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={children} />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
            <DropdownMenuRadioItem value="updatedAt">Date Edited</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="createdAt">Date Created</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="title">Title</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {inTrash && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={count === 0} onClick={emptyTrash}>
              Delete All
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The note list on a phone, laid out as in Notes on iPhone: a large title, notes
 * grouped by date into rounded cards, and search and new-note along the bottom.
 */
function MobileNoteList({
  title,
  items,
  count,
  inTrash,
  folderName,
}: {
  title: string
  items: Item[]
  count: number
  inTrash: boolean
  folderName: ((id: string) => string | null) | null
}) {
  const setMobilePane = useNotes((s) => s.setMobilePane)
  const createNote = useNotes((s) => s.createNote)
  const selectNote = useNotes((s) => s.selectNote)
  const sortBy = useNotes((s) => s.sortBy)
  const [compact, setCompact] = useState(false)

  // The flat list, regrouped: one card per heading.
  const groups: { label: string | null; notes: Note[] }[] = []
  for (const item of items) {
    if (item.kind === "header") groups.push({ label: item.label, notes: [] })
    else if (groups.length === 0) groups.push({ label: null, notes: [item.note] })
    else groups[groups.length - 1].notes.push(item.note)
  }

  return (
    <MobileScreen
      title={title}
      subtitle={`${count} ${count === 1 ? "Note" : "Notes"}`}
      compact={compact}
      onCompact={setCompact}
      left={
        <button type="button" aria-label="Folders" onClick={() => setMobilePane("folders")} className={TOP_BUTTON}>
          <ChevronLeft />
        </button>
      }
      right={
        <ListOptions inTrash={inTrash} count={count}>
          <button type="button" aria-label="List options" className={TOP_BUTTON}>
            <Ellipsis />
          </button>
        </ListOptions>
      }
      dock={<MobileDock action={inTrash ? undefined : { label: "New Note", icon: <SquarePen />, run: createNote }} />}
    >
      {count === 0 && <p className="pt-24 text-center text-[17px] text-muted-foreground">No Notes</p>}
      {groups.map((group, g) => (
        <div key={group.label ?? g}>
          {group.label && <h2 className="px-0.5 pt-7 pb-2.5 text-[21px] leading-7 font-bold">{group.label}</h2>}
          <div className={cn(GROUP_CARD, !group.label && "mt-5")}>
            {group.notes.map((note, i) => {
              const folder = folderName?.(note.folderId)
              return (
                <ContextMenu key={note.id}>
                  <ContextMenuTrigger
                    render={
                      <div
                        role="button"
                        tabIndex={0}
                        data-note-id={note.id}
                        onClick={() => selectNote(note.id)}
                        onKeyDown={(e) => e.key === "Enter" && selectNote(note.id)}
                        className="relative py-[11px] pr-4 pl-[26px] text-[15px] leading-[21px] text-muted-foreground outline-none active:bg-foreground/[0.06]"
                      />
                    }
                  >
                    {i > 0 && <span className="absolute top-0 right-[18px] left-[26px] border-t border-foreground/10" />}
                    <div className="note-font truncate text-[17px] leading-[23px] font-semibold text-foreground">{displayTitle(note)}</div>
                    <div className="flex gap-2">
                      <span className="shrink-0 tabular-nums">{listDate(sortBy === "createdAt" ? note.createdAt : note.updatedAt)}</span>
                      <span className="note-font truncate">{displaySnippet(note)}</span>
                    </div>
                    {folder && (
                      <div className="flex items-center gap-1">
                        <FolderIcon strokeWidth={1.7} className="size-[15px]" />
                        <span className="truncate">{folder}</span>
                      </div>
                    )}
                  </ContextMenuTrigger>
                  <NoteMenu note={note} />
                </ContextMenu>
              )
            })}
          </div>
        </div>
      ))}
    </MobileScreen>
  )
}
