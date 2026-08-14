import type { ReactNode } from 'react'
import { appearanceDataAttributes, defaultAppearance } from '@cornerstone/ui'
import '@cornerstone/ui/styles.css'
import './globals.css'

export const metadata = { title: 'Cornerstone Reference App' }

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="ko" {...appearanceDataAttributes(defaultAppearance)}>
      <body>{children}</body>
    </html>
  )
}
