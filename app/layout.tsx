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
  // Added to an iPhone's home screen, it opens full screen like an app.
  appleWebApp: { capable: true, title: "Quick Thoughts", statusBarStyle: "black-translucent" },
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
      <body className="h-dvh overflow-hidden print:h-auto print:overflow-visible">
        {children}
        <Pwa />
      </body>
    </html>
  )
}
