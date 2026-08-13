import type { ReactNode } from 'react'
import { appearanceDataAttributes, defaultAppearance } from '@cornerstone/ui'
import { getWebConfig } from '../config/web'
import { resolveDirection } from '../i18n'
import { createRootMetadata } from '../metadata/root'
import { NetworkStatus } from './network-status'
import { WebVitals } from './web-vitals'
import { QueryProvider } from '../query/provider'
import '@cornerstone/ui/styles.css'
import './globals.css'

const webConfig = getWebConfig()

export const metadata = createRootMetadata(webConfig.siteUrl)

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
      <body>
        <NetworkStatus locale={webConfig.locale} />
        <QueryProvider>{children}</QueryProvider>
        <WebVitals />
      </body>
    </html>
  )
}
