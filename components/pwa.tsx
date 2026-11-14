"use client"

import { useEffect } from "react"

/**
 * Registers the service worker that keeps the app available offline. Only in a built
 * app: during development it would keep serving old files while you edit them.
 */
export function Pwa() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error) => {
      console.warn("Offline support could not be set up.", error)
    })
  }, [])
  return null
}
