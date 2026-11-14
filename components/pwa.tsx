"use client"

import { useEffect } from "react"

/**
 * Scrolls whatever holds the text cursor just far enough that the cursor is visible,
 * leaving everything else where it was.
 */
function revealCaret() {
  const selection = window.getSelection()
  const node = selection?.focusNode
  if (!selection || !node || selection.rangeCount === 0) return
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!element?.closest("[contenteditable='true'], input, textarea")) return
  // An empty line has no cursor box of its own; use the line.
  let caret = selection.getRangeAt(0).getBoundingClientRect()
  if (caret.height === 0) caret = element.getBoundingClientRect()

  // The nearest ancestor that actually scrolls.
  let scroller: Element | null = element
  while (scroller) {
    const overflow = getComputedStyle(scroller).overflowY
    if ((overflow === "auto" || overflow === "scroll") && scroller.scrollHeight > scroller.clientHeight) break
    scroller = scroller.parentElement
  }
  if (!scroller) return
  const box = scroller.getBoundingClientRect()
  const margin = 28
  if (caret.bottom > box.bottom - margin) scroller.scrollTop += caret.bottom - (box.bottom - margin)
  else if (caret.top < box.top + margin) scroller.scrollTop -= box.top + margin - caret.top
}

/**
 * App-like behaviour that has to be set up in the browser: the service worker that keeps
 * the app available offline (only in a built app: during development it would keep
 * serving old files while you edit them), and fitting the app above a phone's keyboard.
 */
export function Pwa() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error) => {
      console.warn("Offline support could not be set up.", error)
    })
  }, [])
  // Phones: when the on-screen keyboard opens, iOS keeps the page at full height and lets
  // it slide around behind the keyboard. Shrink the app to the part of the screen that is
  // actually visible instead, so nothing is hidden and there is nothing to scroll to.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport || !window.matchMedia("(pointer: coarse)").matches) return
    const fit = () => {
      const { style } = document.body
      // Only a keyboard takes this much; browser bars coming and going don't count.
      const keyboardOpen = window.innerHeight - viewport.height > 120
      style.height = keyboardOpen ? `${viewport.height}px` : ""
      style.bottom = keyboardOpen ? "auto" : ""
      document.documentElement.style.setProperty("--app-height", `${viewport.height}px`)
      // Undo any slide iOS has already applied.
      if (window.scrollY !== 0 || viewport.offsetTop !== 0) window.scrollTo(0, 0)
      // The app is shorter now; keep the line being typed on in view, as Notes does.
      if (keyboardOpen) requestAnimationFrame(revealCaret)
    }
    fit()
    viewport.addEventListener("resize", fit)
    viewport.addEventListener("scroll", fit)
    return () => {
      viewport.removeEventListener("resize", fit)
      viewport.removeEventListener("scroll", fit)
    }
  }, [])

  return null
}
