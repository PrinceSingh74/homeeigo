import type { Metadata } from "next"
import { Inter, Playfair_Display } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
})

export const metadata: Metadata = {
  title: "HOMIGO - The Future of Home Services",
  description: "AI-Powered Luxury Home Services Marketplace",
  keywords: [
    "home services",
    "plumbing",
    "cleaning",
    "electrician",
    "India",
    "luxury",
    "AI-powered",
  ],
  authors: [{ name: "HOMIGO Team" }],
  openGraph: {
    title: "HOMIGO",
    description: "The Future of Home Services",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="font-sans antialiased bg-homigo-50">
        {children}
      </body>
    </html>
  )
}
