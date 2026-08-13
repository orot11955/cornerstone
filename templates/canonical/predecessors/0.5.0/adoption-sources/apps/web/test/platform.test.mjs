import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWebConfig } from '../src/config/web.ts'
import {
  formatCurrency,
  formatDateTime,
  resolveDirection,
  resolveLocale,
  translate,
} from '../src/i18n/index.ts'
import { resolveCorrelationId } from '../src/errors/correlation.ts'
import {
  browserSecurityHeaders,
  buildContentSecurityPolicy,
  createNonce,
} from '../src/security/headers.ts'
import { BrowserTelemetry } from '../src/telemetry/browser.ts'
import { createRootMetadata } from '../src/metadata/root.ts'

test('web config는 origin을 정규화하고 production HTTPS를 강제한다', () => {
  const config = resolveWebConfig({
    SITE_URL: 'https://example.com/product',
    APP_LOCALE: 'en',
    APP_TIME_ZONE: 'UTC',
    APP_CURRENCY: 'USD',
  })
  assert.equal(config.siteUrl.toString(), 'https://example.com/')
  assert.equal(config.locale, 'en')
  assert.throws(
    () => resolveWebConfig({ SITE_URL: 'http://example.com' }, { requireSecureOrigin: true }),
    /must use HTTPS/,
  )
  assert.throws(() => resolveWebConfig({ SITE_URL: 'javascript:alert(1)' }), /HTTP or HTTPS/)
  assert.throws(() => resolveWebConfig({ SITE_URL: 'https://user@example.com' }), /origin/)
})

test('locale, direction과 번역 fallback은 결정적이다', () => {
  assert.equal(resolveLocale('en-US'), 'en')
  assert.equal(resolveLocale('ja-JP'), 'ko')
  assert.equal(resolveDirection('ar-SA'), 'rtl')
  assert.equal(resolveDirection('ko'), 'ltr')
  assert.equal(translate('en', 'common.retry'), 'Try again')
})

test('날짜와 통화는 명시적인 request context로 표시한다', () => {
  const context = { locale: 'en', timeZone: 'UTC', currency: 'USD' }
  assert.match(formatDateTime('2026-08-12T00:00:00.000Z', context), /Aug/)
  assert.match(formatCurrency(1200, context), /1,200/)
})

test('사용자에게 노출할 correlation ID는 제한된 문자만 허용한다', () => {
  assert.equal(resolveCorrelationId('request_ABC-123'), 'request_ABC-123')
  assert.equal(resolveCorrelationId('<script>alert(1)</script>'), undefined)
  assert.equal(resolveCorrelationId('a'.repeat(65)), undefined)
})

test('production CSP는 nonce를 사용하고 실행 가능한 inline script를 금지한다', () => {
  const nonce = createNonce()
  const policy = buildContentSecurityPolicy(nonce)
  const directives = new Map(
    policy
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [name, ...values] = item.split(' ')
        return [name, values]
      }),
  )

  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/)
  assert.deepEqual(directives.get('script-src-attr'), ["'none'"])
  assert.equal(directives.get('script-src')?.includes("'unsafe-inline'"), false)
  assert.equal(directives.get('script-src')?.includes("'unsafe-eval'"), false)
  assert.equal(directives.get('style-src')?.includes("'unsafe-inline'"), false)
  assert.deepEqual(directives.get('style-src-attr'), ["'unsafe-inline'"])
  assert.ok(directives.has('upgrade-insecure-requests'))
})

test('development CSP만 eval을 허용하고 nonce 주입은 거절한다', () => {
  const policy = buildContentSecurityPolicy('YWJjZA==', { development: true })
  assert.match(policy, /script-src [^;]*'unsafe-eval'/)
  assert.doesNotMatch(policy, /upgrade-insecure-requests/)
  assert.throws(() => buildContentSecurityPolicy("nonce'; report-uri https://evil.invalid"))
})

test('기본 browser security header가 frame, MIME sniffing과 민감 권한을 제한한다', () => {
  assert.equal(browserSecurityHeaders['X-Frame-Options'], 'DENY')
  assert.equal(browserSecurityHeaders['X-Content-Type-Options'], 'nosniff')
  assert.match(browserSecurityHeaders['Permissions-Policy'], /camera=\(\)/)
})

test('browser telemetry는 동의, sampling과 route allowlist를 모두 통과해야 기록한다', () => {
  const events = []
  const telemetry = new BrowserTelemetry({
    adapter: { record: (event) => events.push(event) },
    allowedRoutes: ['/', '/projects/[projectId]'],
    consent: true,
    samplingRate: 1,
    release: 'web-2026.08.13',
    random: () => 0,
  })
  telemetry.recordWebVital('/', { name: 'LCP', value: 1234, rating: 'good' })
  telemetry.recordUnexpectedError('/projects/[projectId]', 'request_123')
  telemetry.recordWebVital('/users/private@example.com', { name: 'CLS', value: 0.01 })
  telemetry.recordWebVital('/', { name: 'UNKNOWN', value: 1 })

  assert.deepEqual(events, [
    {
      type: 'web-vital',
      routePattern: '/',
      name: 'LCP',
      value: 1234,
      rating: 'good',
      release: 'web-2026.08.13',
    },
    {
      type: 'unexpected-error',
      routePattern: '/projects/[projectId]',
      correlationId: 'request_123',
      release: 'web-2026.08.13',
    },
  ])
})

test('browser telemetry는 기본적으로 no-op이며 민감한 오류 값을 payload에 넣지 않는다', () => {
  const events = []
  const telemetry = new BrowserTelemetry({
    adapter: { record: (event) => events.push(event) },
    allowedRoutes: ['/'],
  })
  telemetry.recordUnexpectedError('/', '<token>')
  telemetry.recordWebVital('/', { name: 'LCP', value: Number.NaN })
  assert.deepEqual(events, [])
})

test('telemetry provider 실패는 사용자 흐름으로 전파하지 않는다', () => {
  const telemetry = new BrowserTelemetry({
    adapter: {
      record: () => {
        throw new Error('provider unavailable')
      },
    },
    allowedRoutes: ['/'],
    consent: true,
  })
  assert.doesNotThrow(() => telemetry.recordUnexpectedError('/', 'request_123'))
})

test('root metadata는 canonical origin과 social 기본값을 한 원천에서 생성한다', () => {
  const metadata = createRootMetadata(new URL('https://docs.example.com'))
  assert.equal(metadata.metadataBase?.toString(), 'https://docs.example.com/')
  assert.deepEqual(metadata.alternates, { canonical: '/' })
  assert.deepEqual(metadata.robots, { index: true, follow: true })
  assert.equal(metadata.openGraph?.url, '/')
})
