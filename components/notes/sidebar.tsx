"use client"

import { createContext, useContext, useMemo, useState } from "react"
import {
  Check,
  ChevronRight,
  Ellipsis,
  Folder as FolderIcon,
  FolderPlus,
  House,
  Lightbulb,
  PanelLeft,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  ALL,
  THOUGHTS,
  TRASH,
  useNotes,
  type Folder,
} from "@/lib/store"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useIsMobile } from "@/lib/use-mobile"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { GROUP_CARD, MobileDock, MobileScreen, ROW_LINES, TOP_BUTTON } from "./mobile-dock"
import { Pill, ToolButton } from "./toolbar"

export const NOTE_DRAG_TYPE = "application/x-note-id"

/** Phones: true while the folder list is in Edit mode, where rows are managed instead of opened. */
const Editing = createContext(false)

type NameDialog =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; id: string }

export function Sidebar({ width }: { width: number | string }) {
  const mobile = useIsMobile()
  const folders = useNotes((s) => s.folders)
  const notes = useNotes((s) => s.notes)
  const toggleSidebar = useNotes((s) => s.toggleSidebar)
  const setView = useNotes((s) => s.setView)
  const createFolder = useNotes((s) => s.createFolder)
  const renameFolder = useNotes((s) => s.renameFolder)
  const deleteNote = useNotes((s) => s.deleteNote)

  const [dialog, setDialog] = useState<NameDialog | null>(null)
  const [name, setName] = useState("")
  const [compact, setCompact] = useState(false)
  const [editing, setEditing] = useState(false)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    const bump = (key: string) => map.set(key, (map.get(key) ?? 0) + 1)
    for (const n of notes) {
      if (n.deletedAt) bump(TRASH)
      else {
        bump(ALL)
        bump(n.folderId)
      }
    }
    return map
  }, [notes])

  const openCreate = (parentId: string | null) => {
    setName("New Folder")
    setDialog({ mode: "create", parentId })
  }
  const openRename = (folder: Folder) => {
    setName(folder.name)
    setDialog({ mode: "rename", id: folder.id })
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !dialog) return
    if (dialog.mode === "create") createFolder(trimmed, dialog.parentId)
    else renameFolder(dialog.id, trimmed)
    setDialog(null)
  }

  const renderFolders = (parentId: string | null, depth: number) =>
    folders
      .filter((f) => f.parentId === parentId)
      .map((folder) => {
        const hasChildren = folders.some((f) => f.parentId === folder.id)
        return (
          <div key={folder.id} className={cn(mobile && ROW_LINES)}>
            <FolderRow
              folder={folder}
              depth={depth}
              hasChildren={hasChildren}
              count={counts.get(folder.id) ?? 0}
              onNewFolder={() => openCreate(folder.id)}
              onRename={() => openRename(folder)}
            />
            {hasChildren && (
              <div
                inert={!folder.expanded && !mobile}
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-250 ease-out",
                  folder.expanded || mobile ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
              >
                <div className={cn("overflow-hidden", mobile && ROW_LINES)}>{renderFolders(folder.id, depth + 1)}</div>
              </div>
            )}
          </div>
        )
      })

  const dialogs = (
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent showCloseButton={false}>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {dialog?.mode === "rename" ? "Rename Folder" : "New Folder"}
              </DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              aria-label="Folder name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                {dialog?.mode === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
  )

  // Phones: the folder list as in Notes on iPhone, with every folder shown.
  if (mobile) {
    return (
      <MobileScreen
        as="aside"
        title="Folders"
        compact={compact}
        onCompact={setCompact}
        right={
          <>
            <button type="button" aria-label="New Folder" onClick={() => openCreate(null)} className={TOP_BUTTON}>
              <FolderPlus />
            </button>
            {editing ? (
              <button type="button" aria-label="Done" onClick={() => setEditing(false)} className={cn(TOP_BUTTON, "bg-app-accent text-white")}>
                <Check />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="glass h-11 shrink-0 rounded-full px-4 text-[17px] font-medium transition-transform duration-150 active:scale-95"
              >
                Edit
              </button>
            )}
          </>
        }
        dock={<MobileDock />}
      >
        <Editing.Provider value={editing}>
          <div className={cn(GROUP_CARD, ROW_LINES, "mt-5")}>
            <Row id={ALL} label="All Notes" count={counts.get(ALL) ?? 0} />
            {renderFolders(null, 0)}
            <Row
              id={TRASH}
              label="Recently Deleted"
              count={counts.get(TRASH) ?? 0}
              icon={<Trash2 strokeWidth={1.7} className="size-[22px] text-app-accent" />}
            />
          </div>
        </Editing.Provider>
        {dialogs}
      </MobileScreen>
    )
  }

  return (
    <aside className="flex h-full shrink-0 flex-col bg-app-sidebar" style={{ width }}>
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-2.5">
        <Pill>
          <ToolButton label="Home" onClick={() => setView("home")}>
            <House />
          </ToolButton>
        </Pill>
        <div className="flex-1" />
        <Pill>
          <ToolButton label="New Folder" onClick={() => openCreate(null)}>
            <FolderPlus />
          </ToolButton>
        </Pill>
        {!mobile && (
          <Pill>
            <ToolButton label="Hide Folders" onClick={toggleSidebar}>
              <PanelLeft />
            </ToolButton>
          </Pill>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        <div className="px-1.5 pt-2.5 pb-1.5 text-[11px] font-semibold text-muted-foreground">
          On This Device
        </div>
        <Row id={ALL} label="All Notes" count={counts.get(ALL) ?? 0} />
        {renderFolders(null, 0)}
        <Row
          id={TRASH}
          label="Recently Deleted"
          count={counts.get(TRASH) ?? 0}
          icon={<Trash2 strokeWidth={1.7} className="size-[18px] text-app-accent" />}
          onDropNote={deleteNote}
        />
      </nav>

      {dialogs}
    </aside>
  )
}

function FolderRow({
  folder,
  depth,
  hasChildren,
  count,
  onNewFolder,
  onRename,
}: {
  folder: Folder
  depth: number
  hasChildren: boolean
  count: number
  onNewFolder: () => void
  onRename: () => void
}) {
  const mobile = useIsMobile()
  const toggleFolder = useNotes((s) => s.toggleFolder)
  const deleteFolder = useNotes((s) => s.deleteFolder)
  const moveNote = useNotes((s) => s.moveNote)

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <Row
            id={folder.id}
            label={folder.name}
            count={count}
            depth={depth}
            icon={
              folder.id === THOUGHTS && (
                <Lightbulb strokeWidth={1.7} className={cn("text-app-accent", mobile ? "size-[22px]" : "size-[18px]")} />
              )
            }
            onDropNote={(noteId) => moveNote(noteId, folder.id)}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Options for ${folder.name}`}
                      onClick={(e) => e.stopPropagation()}
                      className="grid size-11 place-items-center text-app-accent"
                    />
                  }
                >
                  <span className="grid size-[26px] place-items-center rounded-full border-[1.5px] border-current">
                    <Ellipsis strokeWidth={2.5} className="size-4" />
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
                  <DropdownMenuItem onClick={onNewFolder}>New Folder Inside</DropdownMenuItem>
                  {folder.id !== THOUGHTS && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => deleteFolder(folder.id)}>
                        Delete Folder
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            }
            chevron={
              hasChildren && !mobile && (
                <button
                  type="button"
                  aria-label={folder.expanded ? "Collapse" : "Expand"}
                  className="absolute left-0 grid h-full w-3.5 place-items-center text-muted-foreground pointer-coarse:-left-2 pointer-coarse:w-8"
                  style={{ marginLeft: depth * 16 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFolder(folder.id)
                  }}
                >
                  <ChevronRight
                    strokeWidth={2.5}
                    className={cn(
                      "size-3 transition-transform duration-250 ease-out",
                      folder.expanded && "rotate-90"
                    )}
                  />
                </button>
              )
            }
          />
        }
      />
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={onNewFolder}>New Folder</ContextMenuItem>
        <ContextMenuItem onClick={onRename}>Rename Folder</ContextMenuItem>
        {folder.id !== THOUGHTS && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => deleteFolder(folder.id)}
            >
              Delete Folder
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function Row({
  id,
  label,
  count,
  depth = 0,
  icon,
  chevron,
  actions,
  onDropNote,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "id"> & {
  /** Phones, in Edit mode: what replaces the count. Rows without it can't be changed and are dimmed. */
  actions?: React.ReactNode
  id: string
  label: string
  count: number
  depth?: number
  icon?: React.ReactNode
  chevron?: React.ReactNode
  onDropNote?: (noteId: string) => void
}) {
  const mobile = useIsMobile()
  const selected = useNotes((s) => s.selectedFolderId === id) && !mobile
  const selectFolder = useNotes((s) => s.selectFolder)
  const editing = useContext(Editing) && mobile
  const open = () => !editing && selectFolder(id)
  const [dragOver, setDragOver] = useState(false)

  const acceptsDrop = (e: React.DragEvent) =>
    Boolean(onDropNote) && e.dataTransfer.types.includes(NOTE_DRAG_TYPE)

  return (
    <div
      {...props}
      role="button"
      tabIndex={0}
      aria-current={selected || undefined}
      aria-disabled={(editing && !actions) || undefined}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false)
        if (!acceptsDrop(e)) return
        e.preventDefault()
        onDropNote?.(e.dataTransfer.getData(NOTE_DRAG_TYPE))
      }}
      className={cn(
        "relative flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
        mobile
          ? cn("h-[52px] gap-3.5 pr-3.5 pl-[18px] text-[17px]", editing ? !actions && "[&>span]:opacity-40 [&_svg]:text-muted-foreground" : "active:bg-foreground/[0.06]")
          : "h-8 gap-2.5 rounded-lg pr-2.5 pl-[15px] text-[13px] pointer-coarse:h-11 pointer-coarse:text-[16px]",
        selected && "bg-app-selected font-semibold",
        dragOver && "bg-app-accent/25 ring-1 ring-app-accent/60",
        className
      )}
    >
      {chevron}
      <span className="flex shrink-0" style={{ marginLeft: depth * 16 }}>
        {icon || <FolderIcon strokeWidth={1.7} className={cn("text-app-accent", mobile ? "size-[22px]" : "size-[18px]")} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {editing ? (
        actions && <div className="-mr-2.5 flex">{actions}</div>
      ) : (
        <>
          <span className={cn("font-normal text-muted-foreground tabular-nums", mobile ? "text-[17px]" : "text-[13px] pointer-coarse:text-[15px]")}>
            {count}
          </span>
          {mobile && <ChevronRight strokeWidth={2.5} className="size-4 text-muted-foreground/60" />}
        </>
      )}
    </div>
  )
}
