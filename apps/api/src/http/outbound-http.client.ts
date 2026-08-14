export type OutboundErrorCode =
  | 'CANCELLED'
  | 'CIRCUIT_OPEN'
  | 'INVALID_BASE_URL'
  | 'INVALID_PATH'
  | 'NETWORK_FAILURE'
  | 'REDIRECT_REJECTED'
  | 'RESPONSE_TOO_LARGE'
  | 'TIMEOUT';

export class OutboundRequestError extends Error {
  constructor(readonly code: OutboundErrorCode) {
    super(code);
    this.name = 'OutboundRequestError';
  }
}

export interface OutboundHttpClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly failureThreshold?: number;
  readonly circuitResetMs?: number;
  readonly now?: () => number;
}

export interface OutboundResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: Uint8Array;
}

export class OutboundHttpClient {
  private readonly baseUrl: URL;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly failureThreshold: number;
  private readonly circuitResetMs: number;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | undefined;

  constructor(options: OutboundHttpClientOptions) {
    this.baseUrl = parseBaseUrl(options.baseUrl);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.timeoutMs = boundedInteger(
      options.timeoutMs ?? 5_000,
      1,
      30_000,
      'timeoutMs',
    );
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? 1024 * 1024,
      1,
      10 * 1024 * 1024,
      'maxResponseBytes',
    );
    this.failureThreshold = boundedInteger(
      options.failureThreshold ?? 5,
      1,
      100,
      'failureThreshold',
    );
    this.circuitResetMs = boundedInteger(
      options.circuitResetMs ?? 30_000,
      100,
      300_000,
      'circuitResetMs',
    );
    this.now = options.now ?? Date.now;
  }

  async request(
    path: string,
    init: Omit<RequestInit, 'redirect' | 'signal'> & {
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<OutboundResponse> {
    this.assertCircuitAvailable();
    const url = resolvePath(this.baseUrl, path);
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        ...init,
        redirect: 'manual',
        signal,
      });
    } catch {
      if (init.signal?.aborted) {
        throw new OutboundRequestError('CANCELLED');
      }
      this.recordFailure();
      if (timeoutSignal.aborted && !init.signal?.aborted) {
        throw new OutboundRequestError('TIMEOUT');
      }
      throw new OutboundRequestError('NETWORK_FAILURE');
    }

    if (response.status >= 300 && response.status < 400) {
      await cancelBody(response);
      this.recordFailure();
      throw new OutboundRequestError('REDIRECT_REJECTED');
    }
    let body: Uint8Array;
    try {
      body = await readBoundedBody(
        response,
        this.maxResponseBytes,
        signal,
        timeoutSignal,
        init.signal,
      );
    } catch (error) {
      this.recordFailure();
      throw error;
    }
    if (response.status >= 500) this.recordFailure();
    else this.recordSuccess();

    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body,
    };
  }

  private assertCircuitAvailable(): void {
    if (this.circuitOpenedAt === undefined) return;
    if (this.now() - this.circuitOpenedAt >= this.circuitResetMs) {
      this.circuitOpenedAt = undefined;
      this.consecutiveFailures = 0;
      return;
    }
    throw new OutboundRequestError('CIRCUIT_OPEN');
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.circuitOpenedAt = this.now();
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = undefined;
  }
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundRequestError('INVALID_BASE_URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new OutboundRequestError('INVALID_BASE_URL');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function resolvePath(baseUrl: URL, path: string): URL {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('://')
  ) {
    throw new OutboundRequestError('INVALID_PATH');
  }
  for (const segment of path.split('/')) {
    let decoded: string;
    try {
      decoded = decodeRecursively(segment);
    } catch {
      throw new OutboundRequestError('INVALID_PATH');
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\')
    ) {
      throw new OutboundRequestError('INVALID_PATH');
    }
  }
  const url = new URL(path, baseUrl);
  if (
    url.origin !== baseUrl.origin ||
    !url.pathname.startsWith(baseUrl.pathname)
  ) {
    throw new OutboundRequestError('INVALID_PATH');
  }
  return url;
}

async function readBoundedBody(
  response: Response,
  limit: number,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
  callerSignal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    await cancelBody(response);
    throw new OutboundRequestError('RESPONSE_TOO_LARGE');
  }
  if (!response.body) return new Uint8Array();

  const reader: ReadableStreamDefaultReader<Uint8Array> = (
    response.body as ReadableStream<Uint8Array>
  ).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new OutboundRequestError('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) {
      throw new OutboundRequestError(
        callerSignal?.aborted
          ? 'CANCELLED'
          : timeoutSignal.aborted
            ? 'TIMEOUT'
            : 'CANCELLED',
      );
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function decodeRecursively(segment: string): string {
  let decoded = segment;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) return next;
    decoded = next;
  }
  if (decoded.includes('%')) throw new Error('Nested encoding');
  return decoded;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation only releases the response stream; the request error remains authoritative.
  }
}

function boundedInteger(
  value: number,
  min: number,
  max: number,
  name: string,
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(
      `${name} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}
