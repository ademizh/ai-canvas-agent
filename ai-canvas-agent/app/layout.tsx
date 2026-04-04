import type { Metadata } from 'next'
import './globals.css'
import 'tldraw/tldraw.css'

export const metadata: Metadata = {
  title: 'AI Canvas Agent',
  description: 'Hackathon starter for AI brainstorming agent on canvas',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
