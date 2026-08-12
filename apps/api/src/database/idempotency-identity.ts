import { createHmac } from 'node:crypto';

export function identityIdempotencyScope(
  secret: string,
  userId: string,
): string {
  return digest(secret, `scope:user:${userId}`);
}

export function identityIdempotencyKey(
  secret: string,
  clientKey: string,
): string {
  return digest(secret, `key:${clientKey}`);
}

function digest(secret: string, value: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url'))
    .update(value)
    .digest('hex');
}
