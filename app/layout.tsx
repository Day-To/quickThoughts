import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Pwa } from "@/components/pwa"

// Only used where the system font (San Francisco) isn't available.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  title: "Quick Thoughts",
  description: "Capture a thought in seconds; it gets organised, linked and made searchable for you.",
  applicationName: "Quick Thoughts",
  // Added to an iPhone's home screen, it opens full screen like an app. The status bar
  // keeps its own strip ("default") rather than floating over the page: when the page
  // runs underneath it ("black-translucent"), iOS blurs and dims whatever is up there
  // and reports a page height shorter than the screen.
  appleWebApp: { capable: true, title: "Quick Thoughts", statusBarStyle: "default" },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Stops a phone zooming the page in when a text field is focused. It is an app, laid
  // out to fit the screen; text size is changed inside notes instead.
  maximumScale: 1,
  userScalable: false,
  // Lets the page draw under the notch; safe-area insets keep controls clear of it.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      {/* Pinned to the screen's edges rather than sized by viewport units, which come up
          short in an installed iPhone app and leave a strip along the bottom. */}
      <body className="fixed inset-0 overflow-hidden print:static print:overflow-visible">
        {children}
        <Pwa />
      </body>
    </html>
  )
}
