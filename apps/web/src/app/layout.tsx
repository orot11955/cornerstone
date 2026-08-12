import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { appearanceDataAttributes, defaultAppearance } from '@cornerstone/ui'
import { getWebConfig } from '../config/web'
import { resolveDirection } from '../i18n'
import '@cornerstone/ui/styles.css'
import './globals.css'

const webConfig = getWebConfig()

export const metadata: Metadata = {
  metadataBase: webConfig.siteUrl,
  title: {
    default: 'Cornerstone Foundation',
    template: '%s | Cornerstone',
  },
  description: 'Composable TypeScript full-stack starter foundation',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    title: 'Cornerstone Foundation',
    description: 'Composable TypeScript full-stack starter foundation',
    url: '/',
    siteName: 'Cornerstone',
  },
  robots: { index: true, follow: true },
}

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang={webConfig.locale}
      dir={resolveDirection(webConfig.locale)}
      {...appearanceDataAttributes(defaultAppearance)}
    >
      <body>{children}</body>
    </html>
  )
}
