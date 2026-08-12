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
