const DEFAULT_SITE_URL = 'http://localhost:3000'

export interface WebConfig {
  readonly siteUrl: URL
  readonly locale: 'ko' | 'en'
  readonly timeZone: string
  readonly currency: string
}

export interface WebConfigOptions {
  readonly requireSecureOrigin?: boolean
}

export function resolveWebConfig(
  environment: Readonly<Record<string, string | undefined>>,
  options: WebConfigOptions = {},
): WebConfig {
  const siteUrl = parseSiteUrl(environment.SITE_URL ?? DEFAULT_SITE_URL)
  if (options.requireSecureOrigin && siteUrl.protocol !== 'https:') {
    throw new Error('SITE_URL must use HTTPS in production')
  }

  return {
    siteUrl,
    locale: environment.APP_LOCALE === 'en' ? 'en' : 'ko',
    timeZone: environment.APP_TIME_ZONE || 'Asia/Seoul',
    currency: environment.APP_CURRENCY || 'KRW',
  }
}

export function getWebConfig(): WebConfig {
  return resolveWebConfig(process.env)
}

function parseSiteUrl(value: string): URL {
  const siteUrl = new URL(value)
  if (!['http:', 'https:'].includes(siteUrl.protocol)) {
    throw new Error('SITE_URL must use HTTP or HTTPS')
  }
  if (siteUrl.username || siteUrl.password || siteUrl.search || siteUrl.hash) {
    throw new Error('SITE_URL must be an origin without credentials, query, or hash')
  }
  siteUrl.pathname = '/'
  return siteUrl
}
