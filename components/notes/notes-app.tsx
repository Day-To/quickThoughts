"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/lib/utils"
import { useAuth, watchSession } from "@/lib/auth"
import { useNotes } from "@/lib/store"
import { startSync } from "@/lib/sync"
import { useIsMobile } from "@/lib/use-mobile"
import { AuthScreen } from "@/components/account/auth-screen"
import { LocationStep } from "@/components/account/location-step"
import { CaptureHome } from "@/components/home/capture-home"
import { Spotlight } from "@/components/search/spotlight"
import { EditorPane } from "./editor-pane"
import { NoteList } from "./note-list"
import { Sidebar } from "./sidebar"

const screen = {
  initial: { opacity: 0, scale: 0.985 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.985 },
  transition: { duration: 0.16, ease: "easeOut" },
} as const

export function NotesApp() {
  // Notes live in IndexedDB, so nothing renders until they have been loaded on the client.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // Wait for the finished signal: rehydrate() itself returns before the async read completes.
    const unsubscribe = useNotes.persist.onFinishHydration(() => setReady(true))
    void useNotes.persist.rehydrate()
    return unsubscribe
  }, [])
  useEffect(() => watchSession(), [])

  // Signed in and local notes loaded: keep this device and the cloud in step.
  const userId = useAuth((s) => s.session?.user.id)
  const authReady = useAuth((s) => s.ready)
  const recovering = useAuth((s) => s.recovering)
  useEffect(() => {
    if (ready && userId) return startSync(userId)
  }, [ready, userId])

  // Embeddings are made in the cloud now; drop the vectors an earlier version kept on the device.
  useEffect(() => {
    indexedDB.deleteDatabase("quick-thoughts-embeddings")
  }, [])
  const locationAsked = useNotes((s) => s.locationAsked)
  const view = useNotes((s) => s.view)
  const mobile = useIsMobile()
  const mobilePane = useNotes((s) => s.mobilePane)
  const sidebarOpen = useNotes((s) => s.sidebarOpen)
  const sidebarWidth = useNotes((s) => s.sidebarWidth)
  const listWidth = useNotes((s) => s.listWidth)
  const setSidebarWidth = useNotes((s) => s.setSidebarWidth)
  const setListWidth = useNotes((s) => s.setListWidth)
  const [resizing, setResizing] = useState(false)

  if (!ready || !authReady) return null
  // Nothing in the app is reachable until someone is signed in.
  if (!userId || recovering) return <AuthScreen />
  // Once per device, right after signing up or in: why location is collected, and the choice.
  if (!locationAsked) return <LocationStep />

  return (
    <div className="h-full w-full cursor-default bg-background text-foreground select-none">
      <AnimatePresence mode="wait" initial={false}>
        {view === "home" ? (
          <motion.div key="home" {...screen} className="h-full w-full">
            <CaptureHome />
          </motion.div>
        ) : mobile ? (
          // Phones: folders, note list and note are separate screens you drill through.
          <motion.div key={`library-${mobilePane}`} {...screen} className="flex h-full w-full">
            {mobilePane === "folders" ? (
              <Sidebar width="100%" />
            ) : mobilePane === "list" ? (
              <NoteList width="100%" />
            ) : (
              <EditorPane />
            )}
          </motion.div>
        ) : (
          <motion.div key="library" {...screen} className="flex h-full w-full">
            {/* The sidebar keeps its width and is revealed by the wrapper, so it slides rather than squashes. */}
            <div
              inert={!sidebarOpen}
              className={cn(
                "flex shrink-0 justify-end overflow-hidden bg-app-sidebar print:hidden",
                !resizing && "transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
              )}
              style={{ width: sidebarOpen ? sidebarWidth : 0 }}
            >
              <Sidebar width={sidebarWidth} />
            </div>
            {sidebarOpen && (
              <Resizer
                subtle
                width={sidebarWidth}
                min={180}
                max={360}
                onResize={setSidebarWidth}
                onActive={setResizing}
              />
            )}
            <NoteList width={listWidth} />
            <Resizer width={listWidth} min={220} max={480} onResize={setListWidth} />
            <EditorPane />
          </motion.div>
        )}
      </AnimatePresence>
      <Spotlight />
    </div>
  )
}

/** Hairline between columns that can be dragged to resize the column on its left. */
function Resizer({
  width,
  min,
  max,
  subtle,
  onResize,
  onActive,
}: {
  width: number
  min: number
  max: number
  subtle?: boolean
  onResize: (width: number) => void
  onActive?: (active: boolean) => void
}) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const stop = () => {
    start.current = null
    onActive?.(false)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={cn(
        "relative z-10 w-px shrink-0 print:hidden",
        subtle ? "bg-foreground/[0.06]" : "bg-border"
      )}
    >
      <div
        className="absolute inset-y-0 -left-1 w-[9px] cursor-col-resize"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = { x: e.clientX, width }
          onActive?.(true)
        }}
        onPointerMove={(e) => {
          if (!start.current) return
          const next = start.current.width + e.clientX - start.current.x
          onResize(Math.min(max, Math.max(min, next)))
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
      />
    </div>
  )
}
