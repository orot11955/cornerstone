import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { appearanceDataAttributes, defaultAppearance } from '@cornerstone/ui'
import '@cornerstone/ui/styles.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cornerstone Foundation',
  description: 'Composable TypeScript full-stack starter foundation',
}

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ko" {...appearanceDataAttributes(defaultAppearance)}>
      <body>{children}</body>
    </html>
  )
}
