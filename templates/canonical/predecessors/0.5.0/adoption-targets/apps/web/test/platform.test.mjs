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
import { safeReturnPath } from '../src/auth/redirect.ts'
import { isAuthQuery } from '../src/query/client.ts'
import { parseAuthCookies } from '../src/api/cookies.ts'
import { parseActionTokenFragment } from '../src/auth/action-token.ts'
import { sanitizeApiRequestHeaders } from '../src/security/api-headers.ts'

test('web config는 origin을 정규화하고 production HTTPS를 강제한다', () => {
  const config = resolveWebConfig({
    SITE_URL: 'https://example.com/product',
    APP_LOCALE: 'en',
    APP_TIME_ZONE: 'UTC',
    APP_CURRENCY: 'USD',
  })
  assert.equal(config.siteUrl.toString(), 'https://example.com/')
  assert.equal(config.locale, 'en')
  assert.equal(config.internalApiUrl.toString(), 'http://localhost:4000/')
  assert.throws(
    () => resolveWebConfig({ SITE_URL: 'http://example.com' }, { requireSecureOrigin: true }),
    /must use HTTPS/,
  )
  assert.throws(() => resolveWebConfig({ SITE_URL: 'javascript:alert(1)' }), /HTTP or HTTPS/)
  assert.throws(() => resolveWebConfig({ SITE_URL: 'https://user@example.com' }), /origin/)
})

test('internal API origin은 credentials, path, production HTTP를 거절한다', () => {
  assert.throws(() => resolveWebConfig({ INTERNAL_API_URL: 'https://a:b@example.com' }), /origin/)
  assert.throws(
    () =>
      resolveWebConfig(
        { INTERNAL_API_URL: 'http://api.example.com' },
        { requireSecureOrigin: true },
      ),
    /HTTPS/,
  )
})

test('인증 return path는 명시 allowlist만 통과한다', () => {
  assert.equal(safeReturnPath('/settings/security'), '/settings/security')
  assert.equal(safeReturnPath('//evil.example'), '/')
  assert.equal(safeReturnPath('/login'), '/')
  assert.equal(safeReturnPath('/%2f%2fevil.example'), '/')
  assert.equal(safeReturnPath('/settings\\security'), '/')
})

test('SSR 인증 cookie forwarding은 정확히 하나의 access cookie만 허용한다', () => {
  assert.deepEqual(parseAuthCookies('cs_access=x').access, { name: 'cs_access', value: 'x' })
  assert.deepEqual(parseAuthCookies('analytics=abc==; cs_access=valid').access, {
    name: 'cs_access',
    value: 'valid',
  })
  assert.deepEqual(parseAuthCookies('analytics=%; cs_access=valid').access, {
    name: 'cs_access',
    value: 'valid',
  })
  assert.equal(parseAuthCookies('cs_access=x; __Host-cs_access=y').access, undefined)
  assert.equal(parseAuthCookies('cs_access=%').access, undefined)
  assert.equal(parseAuthCookies('cs_access=; cs_refresh=valid').access, undefined)
})

test('SSR refresh 전환은 정확히 하나의 refresh cookie만 허용한다', () => {
  assert.equal(parseAuthCookies('cs_refresh=x').hasRefresh, true)
  assert.equal(parseAuthCookies('cs_refresh=x; __Host-cs_refresh=y').hasRefresh, false)
})

test('action token은 단일 fragment token만 허용한다', () => {
  assert.equal(parseActionTokenFragment('#token=a%2Fb'), 'a/b')
  assert.equal(parseActionTokenFragment('#token=a&next=/'), undefined)
  assert.equal(parseActionTokenFragment('#other=x'), undefined)
  assert.equal(parseActionTokenFragment('#token=%'), undefined)
  assert.equal(parseActionTokenFragment(`#token=${'a'.repeat(4097)}`), undefined)
})

test('internal API URL은 origin path만 허용한다', () => {
  assert.throws(
    () => resolveWebConfig({ INTERNAL_API_URL: 'https://api.example.com/v1' }),
    /without a path/,
  )
})

test('API rewrite 전 spoof 가능한 routing과 identity header를 제거한다', () => {
  const headers = sanitizeApiRequestHeaders(
    new Headers({
      authorization: 'Bearer token',
      forwarded: 'host=evil',
      'x-forwarded-host': 'evil',
      'x-user-id': 'admin',
      'x-role': 'admin',
      'x-auth-subject': 'admin',
      origin: 'https://web.example',
      cookie: 'session=x',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf',
      'idempotency-key': 'idempotency',
      'if-match': '1',
    }),
  )
  for (const name of [
    'authorization',
    'forwarded',
    'x-forwarded-host',
    'x-user-id',
    'x-role',
    'x-auth-subject',
  ])
    assert.equal(headers.has(name), false)
  for (const name of [
    'origin',
    'cookie',
    'content-type',
    'x-csrf-token',
    'idempotency-key',
    'if-match',
  ])
    assert.equal(headers.has(name), true)
})

test('auth, user, session query는 dehydration 대상이 아니다', () => {
  assert.equal(isAuthQuery(['public', 'catalog']), false)
  assert.equal(isAuthQuery(['auth', 'me']), true)
  assert.equal(isAuthQuery(['account:session']), true)
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
