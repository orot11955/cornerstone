import type { MetadataRoute } from 'next'
import { getWebConfig } from '../config/web'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: new URL('/sitemap.xml', getWebConfig().siteUrl).toString(),
  }
}
