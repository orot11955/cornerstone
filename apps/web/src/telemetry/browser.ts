import { resolveCorrelationId } from '../errors/correlation.ts'

const metricNames = ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'] as const
export type WebVitalName = (typeof metricNames)[number]

export type BrowserTelemetryEvent =
  | {
      readonly type: 'web-vital'
      readonly routePattern: string
      readonly name: WebVitalName
      readonly value: number
      readonly rating?: 'good' | 'needs-improvement' | 'poor'
      readonly release?: string
    }
  | {
      readonly type: 'unexpected-error'
      readonly routePattern: string
      readonly correlationId?: string
      readonly release?: string
    }

export interface BrowserTelemetryAdapter {
  record(event: BrowserTelemetryEvent): void | Promise<void>
}

export interface BrowserTelemetryOptions {
  readonly adapter?: BrowserTelemetryAdapter
  readonly allowedRoutes: readonly string[]
  readonly consent?: boolean
  readonly samplingRate?: number
  readonly release?: string
  readonly random?: () => number
}

export interface WebVitalInput {
  readonly name: string
  readonly value: number
  readonly rating?: string
}

const noOpAdapter: BrowserTelemetryAdapter = { record: () => undefined }

export class BrowserTelemetry {
  readonly #adapter: BrowserTelemetryAdapter
  readonly #allowedRoutes: ReadonlySet<string>
  readonly #consent: boolean
  readonly #samplingRate: number
  readonly #release: string | undefined
  readonly #random: () => number

  constructor(options: BrowserTelemetryOptions) {
    this.#adapter = options.adapter ?? noOpAdapter
    this.#allowedRoutes = new Set(options.allowedRoutes)
    this.#consent = options.consent ?? false
    this.#samplingRate = clampSamplingRate(options.samplingRate ?? 1)
    this.#release = sanitizeRelease(options.release)
    this.#random = options.random ?? Math.random
  }

  recordWebVital(routePattern: string, metric: WebVitalInput): void {
    if (!this.#shouldRecord(routePattern) || !isWebVitalName(metric.name)) return
    if (!Number.isFinite(metric.value)) return
    const rating = isRating(metric.rating) ? metric.rating : undefined
    this.#record({
      type: 'web-vital',
      routePattern,
      name: metric.name,
      value: metric.value,
      ...(rating ? { rating } : {}),
      ...(this.#release ? { release: this.#release } : {}),
    })
  }

  recordUnexpectedError(routePattern: string, correlationId?: string): void {
    if (!this.#shouldRecord(routePattern)) return
    const safeCorrelationId = resolveCorrelationId(correlationId)
    this.#record({
      type: 'unexpected-error',
      routePattern,
      ...(safeCorrelationId ? { correlationId: safeCorrelationId } : {}),
      ...(this.#release ? { release: this.#release } : {}),
    })
  }

  #shouldRecord(routePattern: string): boolean {
    return (
      this.#consent && this.#allowedRoutes.has(routePattern) && this.#random() < this.#samplingRate
    )
  }

  #record(event: BrowserTelemetryEvent): void {
    try {
      const pending = this.#adapter.record(event)
      if (pending instanceof Promise) void pending.catch(() => undefined)
    } catch {
      // Telemetry provider failures must not interrupt the user flow.
    }
  }
}

let activeTelemetry = new BrowserTelemetry({ allowedRoutes: ['/'] })

export function configureBrowserTelemetry(options: BrowserTelemetryOptions): void {
  activeTelemetry = new BrowserTelemetry(options)
}

export function recordWebVital(routePattern: string, metric: WebVitalInput): void {
  activeTelemetry.recordWebVital(routePattern, metric)
}

export function recordUnexpectedError(routePattern: string, correlationId?: string): void {
  activeTelemetry.recordUnexpectedError(routePattern, correlationId)
}

/** Maps browser locations to the only route patterns telemetry may emit. */
export function resolveTelemetryRoutePattern(pathname: string): string {
  const normalizedPathname = pathname.split(/[?#]/, 1)[0]
  if (normalizedPathname === '/') return '/'
  if (normalizedPathname === '/ui-foundation') return '/ui-foundation'
  if (normalizedPathname === '/login') return '/login'
  if (normalizedPathname === '/register') return '/register'
  if (normalizedPathname === '/verify-email') return '/verify-email'
  if (normalizedPathname === '/password/forgot') return '/password/forgot'
  if (normalizedPathname === '/password/reset') return '/password/reset'
  if (normalizedPathname === '/settings/security') return '/settings/security'
  return '/not-found'
}

function isWebVitalName(value: string): value is WebVitalName {
  return (metricNames as readonly string[]).includes(value)
}

function isRating(value: string | undefined): value is 'good' | 'needs-improvement' | 'poor' {
  return value === 'good' || value === 'needs-improvement' || value === 'poor'
}

function clampSamplingRate(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function sanitizeRelease(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : undefined
}
