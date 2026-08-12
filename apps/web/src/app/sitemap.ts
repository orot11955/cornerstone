import type { MetadataRoute } from 'next'
import { getWebConfig } from '../config/web'

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: getWebConfig().siteUrl.toString(), changeFrequency: 'weekly', priority: 1 }]
}
