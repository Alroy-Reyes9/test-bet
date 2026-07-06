import "./globals.css"
import type { ReactNode } from "react"
import { Space_Mono, JetBrains_Mono, Geist } from "next/font/google"

export const metadata = { title: "test-bet · Crash", description: "Play-money Crash" }

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-space-mono",
  display: "swap",
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
})
const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-geist",
  display: "swap",
})

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${spaceMono.variable} ${jetbrainsMono.variable} ${geist.variable}`}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  )
}
