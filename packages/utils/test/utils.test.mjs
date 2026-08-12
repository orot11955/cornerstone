import assert from 'node:assert/strict'
import test from 'node:test'
import { clamp, encodeQuery, normalizeText, throwIfAborted, toIsoInstant } from '../dist/index.js'

test('normalizes Unicode and whitespace deterministically', () => {
  assert.equal(normalizeText('  Cafe\u0301\n\t서울  '), 'Café 서울')
})

test('validates numeric boundaries', () => {
  assert.equal(clamp(11, 0, 10), 10)
  assert.throws(() => clamp(Number.POSITIVE_INFINITY, 0, 10), TypeError)
  assert.throws(() => clamp(1, 2, 0), RangeError)
})

test('normalizes instants and query encoding', () => {
  assert.equal(toIsoInstant('2026-03-08T01:30:00-05:00'), '2026-03-08T06:30:00.000Z')
  assert.equal(encodeQuery({ q: '한 글', page: 1 }), 'page=1&q=%ED%95%9C+%EA%B8%80')
})

test('preserves AbortSignal cancellation', () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  assert.throws(() => throwIfAborted(controller.signal), /cancelled/)
})
