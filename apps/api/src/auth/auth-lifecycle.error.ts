export type AuthLifecycleErrorCode =
  | 'INVALID_ACTION_TOKEN'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_SESSION'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE';

export class AuthLifecycleError extends Error {
  constructor(
    readonly code: AuthLifecycleErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AuthLifecycleError';
  }
}

export function invalidActionToken(): AuthLifecycleError {
  return new AuthLifecycleError(
    'INVALID_ACTION_TOKEN',
    'The action token is invalid or expired',
  );
}

export function invalidCredentials(): AuthLifecycleError {
  return new AuthLifecycleError(
    'INVALID_CREDENTIALS',
    'The credentials are invalid',
  );
}

export function invalidSession(): AuthLifecycleError {
  return new AuthLifecycleError('INVALID_SESSION', 'The session is invalid');
}

export function rateLimited(retryAfterSeconds: number): AuthLifecycleError {
  return new AuthLifecycleError(
    'RATE_LIMITED',
    'Too many requests',
    retryAfterSeconds,
  );
}

export function serviceUnavailable(): AuthLifecycleError {
  return new AuthLifecycleError(
    'SERVICE_UNAVAILABLE',
    'Authentication service is temporarily unavailable',
    1,
  );
}
