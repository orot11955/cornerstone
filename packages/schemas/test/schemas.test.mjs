import assert from 'node:assert/strict'
import test from 'node:test'
import { dateRangeSchema, emailSchema, paginationSchema } from '../dist/index.js'

test('normalizes an email address before validating it', () => {
  assert.equal(emailSchema.parse(' USER@EXAMPLE.COM '), 'user@example.com')
})

test('rejects unsafe pagination boundaries and unknown fields', () => {
  assert.equal(paginationSchema.parse({ page: '1', size: '100' }).size, 100)
  assert.equal(paginationSchema.safeParse({ page: 1, size: 101 }).success, false)
  assert.equal(paginationSchema.safeParse({ page: 1, size: 20, role: 'admin' }).success, false)
})

test('compares offset date-times as instants across DST offsets', () => {
  assert.equal(
    dateRangeSchema.safeParse({
      from: '2026-03-08T01:30:00-05:00',
      to: '2026-03-08T03:30:00-04:00',
    }).success,
    true,
  )
})
