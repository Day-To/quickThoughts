import type { MetadataRoute } from "next"

/** What a phone or computer needs to install Quick Thoughts as an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quick Thoughts",
    short_name: "Thoughts",
    description: "Capture a thought in seconds; it gets organised, linked and made searchable for you.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#171717",
    theme_color: "#171717",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
