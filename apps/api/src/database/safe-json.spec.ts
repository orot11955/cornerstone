import { assertSafeDatabasePayload } from './safe-json.js';

describe('assertSafeDatabasePayload', () => {
  it('accepts bounded plain JSON with allowlisted field names', () => {
    expect(() =>
      assertSafeDatabasePayload(
        { userId: 'opaque-id', changes: ['status'] },
        'payload',
      ),
    ).not.toThrow();
  });

  it('rejects sensitive keys, non-JSON values, and oversized payloads', () => {
    expect(() =>
      assertSafeDatabasePayload({ accessToken: 'secret' }, 'payload'),
    ).toThrow('forbidden field');
    expect(() => assertSafeDatabasePayload({ value: 1n }, 'payload')).toThrow(
      'non-JSON',
    );
    expect(() =>
      assertSafeDatabasePayload({ value: 'x'.repeat(33_000) }, 'payload'),
    ).toThrow('exceeds');
    expect(() =>
      assertSafeDatabasePayload({ value: Number.NaN }, 'payload'),
    ).toThrow('non-JSON');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => assertSafeDatabasePayload(circular, 'payload')).toThrow(
      'circular',
    );
  });
});
