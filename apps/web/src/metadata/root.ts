import type { Metadata } from 'next'

export function createRootMetadata(siteUrl: URL): Metadata {
  return {
    metadataBase: siteUrl,
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
}
