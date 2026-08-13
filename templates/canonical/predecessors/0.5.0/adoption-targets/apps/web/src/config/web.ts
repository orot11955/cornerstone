const DEFAULT_SITE_URL = 'http://localhost:3000'

export interface WebConfig {
  readonly siteUrl: URL
  /** Internal-only upstream used by Server Components and the development rewrite. */
  readonly internalApiUrl: URL
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
  const siteUrl = parseOrigin(environment.SITE_URL ?? DEFAULT_SITE_URL, 'SITE_URL')
  const internalApiUrl = parseInternalApiOrigin(
    environment.INTERNAL_API_URL ?? 'http://localhost:4000',
  )
  if (options.requireSecureOrigin && siteUrl.protocol !== 'https:') {
    throw new Error('SITE_URL must use HTTPS in production')
  }
  if (options.requireSecureOrigin && internalApiUrl.protocol !== 'https:') {
    throw new Error('INTERNAL_API_URL must use HTTPS in production')
  }

  return {
    siteUrl,
    internalApiUrl,
    locale: environment.APP_LOCALE === 'en' ? 'en' : 'ko',
    timeZone: environment.APP_TIME_ZONE || 'Asia/Seoul',
    currency: environment.APP_CURRENCY || 'KRW',
  }
}

export function getWebConfig(): WebConfig {
  return resolveWebConfig(process.env)
}

function parseOrigin(value: string, name: string): URL {
  const siteUrl = new URL(value)
  if (!['http:', 'https:'].includes(siteUrl.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`)
  }
  if (siteUrl.username || siteUrl.password || siteUrl.search || siteUrl.hash) {
    throw new Error(`${name} must be an origin without credentials, query, or hash`)
  }
  siteUrl.pathname = '/'
  return siteUrl
}

function parseInternalApiOrigin(value: string): URL {
  const url = parseOrigin(value, 'INTERNAL_API_URL')
  if (new URL(value).pathname !== '/' && new URL(value).pathname !== '') {
    throw new Error('INTERNAL_API_URL must be an origin without a path')
  }
  return url
}
