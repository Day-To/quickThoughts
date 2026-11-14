// Quick Thoughts service worker: keeps the app itself available without a connection.
// Notes already live on the device (IndexedDB) and sync when the network is back, so
// all this has to do is serve the page and its files when the server can't be reached.
//
// - The page: from the network when possible (so updates arrive), else the saved copy.
// - Next.js build files and icons: saved once; their names change whenever they do.
// - Everything else (the cloud, other sites): left alone.

const PAGE = "qt-page-v1"
const FILES = "qt-files-v1"

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Save the page and every build file it refers to, so the very first offline
      // launch works even though those files were fetched before this worker existed.
      const response = await fetch("/", { cache: "no-store" })
      const html = await response.clone().text()
      await (await caches.open(PAGE)).put("/", response)
      const files = [...new Set(html.match(/\/_next\/static\/[^"'\\\s)]+/g) ?? [])]
      const cache = await caches.open(FILES)
      await Promise.all(files.map((file) => cache.add(file).catch(() => undefined)))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== PAGE && name !== FILES) await caches.delete(name)
      await self.clients.claim()
    })()
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          if (fresh.ok && url.pathname === "/") (await caches.open(PAGE)).put("/", fresh.clone())
          return fresh
        } catch {
          return (await caches.match("/")) ?? Response.error()
        }
      })()
    )
    return
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      (async () => {
        const saved = await caches.match(request)
        if (saved) return saved
        const fresh = await fetch(request)
        if (fresh.ok) (await caches.open(FILES)).put(request, fresh.clone())
        return fresh
      })()
    )
  }
})
