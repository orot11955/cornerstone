import {
  OutboundHttpClient,
  OutboundRequestError,
} from './outbound-http.client.js';
import {
  formatStrongEtag,
  hashCanonicalPayload,
  parseStrongEtag,
  validateIdempotencyKey,
} from './request-contract.js';

describe('request contract', () => {
  it('hashes equivalent JSON payloads deterministically', () => {
    expect(hashCanonicalPayload({ b: [2, 1], a: 'value' })).toBe(
      hashCanonicalPayload({ a: 'value', b: [2, 1] }),
    );
    expect(() => hashCanonicalPayload({ value: Number.NaN })).toThrow();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => hashCanonicalPayload(circular)).toThrow(/circular/);
  });

  it('validates idempotency keys and strong numeric ETags', () => {
    expect(validateIdempotencyKey('checkout_01-ABC')).toBe('checkout_01-ABC');
    expect(() => validateIdempotencyKey('has a space')).toThrow();
    expect(formatStrongEtag(12)).toBe('"12"');
    expect(parseStrongEtag('"12"')).toBe(12);
    for (const invalid of ['W/"12"', '*', '"01"', '12', '"9007199254740992"']) {
      expect(() => parseStrongEtag(invalid)).toThrow();
    }
  });
});

describe('OutboundHttpClient', () => {
  it('uses only a fixed base path and rejects redirects', async () => {
    const seen: URL[] = [];
    const client = new OutboundHttpClient({
      baseUrl: 'https://provider.example/api/',
      fetch: (input) => {
        seen.push(
          input instanceof URL
            ? input
            : new URL(typeof input === 'string' ? input : input.url),
        );
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'https://evil.example' },
          }),
        );
      },
    });
    await expect(client.request('messages/1')).rejects.toMatchObject({
      code: 'REDIRECT_REJECTED',
    });
    expect(seen[0]?.toString()).toBe('https://provider.example/api/messages/1');
    for (const path of [
      'https://evil.example',
      '../admin',
      '%2e%2e/admin',
      '%252e%252e/admin',
      '%252fadmin',
      '%255cadmin',
      '/absolute',
    ]) {
      await expect(client.request(path)).rejects.toMatchObject({
        code: 'INVALID_PATH',
      });
    }
  });

  it('cancels redirect and declared oversized response streams', async () => {
    let redirectCancelled = false;
    const redirect = new OutboundHttpClient({
      baseUrl: 'https://provider.example',
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              cancel: () => {
                redirectCancelled = true;
              },
            }),
            { status: 302 },
          ),
        ),
    });
    await expect(redirect.request('resource')).rejects.toMatchObject({
      code: 'REDIRECT_REJECTED',
    });
    expect(redirectCancelled).toBe(true);

    let oversizedCancelled = false;
    const oversized = new OutboundHttpClient({
      baseUrl: 'https://provider.example',
      maxResponseBytes: 4,
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              cancel: () => {
                oversizedCancelled = true;
              },
            }),
            { headers: { 'content-length': '5' } },
          ),
        ),
    });
    await expect(oversized.request('resource')).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
    expect(oversizedCancelled).toBe(true);
  });

  it('limits declared and streamed response bodies', async () => {
    const declared = new OutboundHttpClient({
      baseUrl: 'https://provider.example',
      maxResponseBytes: 4,
      fetch: () =>
        Promise.resolve(
          new Response('large', { headers: { 'content-length': '5' } }),
        ),
    });
    await expect(declared.request('resource')).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });

    const streamed = new OutboundHttpClient({
      baseUrl: 'https://provider.example',
      maxResponseBytes: 4,
      fetch: () => Promise.resolve(new Response('large')),
    });
    await expect(streamed.request('resource')).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
  });

  it('propagates cancellation and opens then resets the circuit', async () => {
    let now = 0;
    let calls = 0;
    const client = new OutboundHttpClient({
      baseUrl: 'https://provider.example',
      failureThreshold: 2,
      circuitResetMs: 100,
      now: () => now,
      fetch: () => {
        calls += 1;
        return Promise.reject(new Error('network details must not escape'));
      },
    });
    await expect(client.request('resource')).rejects.toBeInstanceOf(
      OutboundRequestError,
    );
    await expect(client.request('resource')).rejects.toMatchObject({
      code: 'NETWORK_FAILURE',
    });
    await expect(client.request('resource')).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN',
    });
    expect(calls).toBe(2);
    now = 101;
    await expect(client.request('resource')).rejects.toMatchObject({
      code: 'NETWORK_FAILURE',
    });
    expect(calls).toBe(3);
  });

  it('reports timeout without exposing the fetch error', async () => {
    const client = new OutboundHttpClient({
      baseUrl: 'https://provider.example',
      timeoutMs: 1,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('provider secret')),
          );
        }),
    });
    await expect(client.request('slow')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('preserves caller cancellation as a distinct failure', async () => {
    const controller = new AbortController();
    const client = new OutboundHttpClient({
      baseUrl: 'https://provider.example',
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    });
    const pending = client.request('slow', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('normalizes timeout and cancellation while reading a response body', async () => {
    const bodyThatAbortsWith =
      (code: 'TIMEOUT' | 'CANCELLED') =>
      (
        _input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1],
      ): Promise<Response> =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener('abort', () =>
                  controller.error(new Error(code)),
                );
              },
            }),
          ),
        );

    const timeout = new OutboundHttpClient({
      baseUrl: 'https://provider.example',
      timeoutMs: 1,
      fetch: bodyThatAbortsWith('TIMEOUT'),
    });
    await expect(timeout.request('resource')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });

    const abort = new AbortController();
    const cancelled = new OutboundHttpClient({
      baseUrl: 'https://provider.example',
      fetch: bodyThatAbortsWith('CANCELLED'),
    });
    const pending = cancelled.request('resource', { signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
