const forbiddenKey = /authorization|cookie|email|password|secret|token/i;
const maxPayloadBytes = 32 * 1024;
const maxDepth = 10;
const maxNodes = 500;

export function assertSafeDatabasePayload(
  value: Readonly<Record<string, unknown>>,
  label: string,
): void {
  visit(value, label, 0, new WeakSet<object>(), { count: 0 });

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON serializable`);
  }

  if (Buffer.byteLength(serialized, 'utf8') > maxPayloadBytes) {
    throw new Error(`${label} exceeds ${maxPayloadBytes} bytes`);
  }
}

function visit(
  value: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
  nodes: { count: number },
): void {
  if (value === null) return;
  if (depth > maxDepth) throw new Error(`${path} exceeds maximum depth`);
  nodes.count += 1;
  if (nodes.count > maxNodes) throw new Error(`${path} exceeds maximum nodes`);
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error(`${path} contains a circular value`);
    seen.add(value);
    value.forEach((item, index) =>
      visit(item, `${path}[${index}]`, depth + 1, seen, nodes),
    );
    seen.delete(value);
    return;
  }
  if (typeof value !== 'object') {
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return;
    }
    throw new Error(`${path} contains a non-JSON value`);
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain plain JSON objects`);
  }
  if (seen.has(value)) throw new Error(`${path} contains a circular value`);
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    if (
      forbiddenKey.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    ) {
      throw new Error(`${path} contains forbidden field ${key}`);
    }
    visit(child, `${path}.${key}`, depth + 1, seen, nodes);
  }
  seen.delete(value);
}
