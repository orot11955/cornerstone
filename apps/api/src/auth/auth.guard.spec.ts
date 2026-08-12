import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { HealthController } from '../health/health.controller.js';
import { routePolicies } from '../authorization/route-policy.js';
import { ROUTE_POLICY_OPERATION } from '../authorization/route-policy.decorator.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthLifecycleService } from './auth-lifecycle.service.js';
import type { CsrfTokenService } from './csrf-token.service.js';
import type { RuntimeAuthCookiePolicy } from './auth.tokens.js';

describe('AuthGuard route policy boundary', () => {
  const reflector = new Reflector();

  it('denies a handler without explicit route policy metadata', async () => {
    const guard = new AuthGuard(
      reflector,
      {} as AuthLifecycleService,
      {} as CsrfTokenService,
      {} as RuntimeAuthCookiePolicy,
    );
    const handler = () => undefined;
    const context = {
      getHandler: () => handler,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'INVALID_SESSION',
    });
  });

  it('assigns every runtime auth and health handler to one approved operation', () => {
    const handlers = [
      [AuthController, 'getCsrfToken'],
      [AuthController, 'register'],
      [AuthController, 'verifyEmail'],
      [AuthController, 'resendVerification'],
      [AuthController, 'login'],
      [AuthController, 'me'],
      [AuthController, 'refresh'],
      [AuthController, 'logout'],
      [AuthController, 'requestPasswordReset'],
      [AuthController, 'resetPassword'],
      [AuthController, 'changePassword'],
      [AuthController, 'confirmRecentAuthentication'],
      [AuthController, 'listSessions'],
      [AuthController, 'revokeSession'],
      [AuthController, 'revokeAllSessions'],
      [HealthController, 'liveness'],
      [HealthController, 'readiness'],
    ] as const;
    const operations = handlers.map(([controller, method]) => {
      const handler = handlerOf(controller.prototype, method);
      return reflector.get<string>(ROUTE_POLICY_OPERATION, handler);
    });

    expect(operations).not.toContain(undefined);
    expect(new Set(operations).size).toBe(handlers.length);
    for (const operation of operations) {
      expect(
        routePolicies.some((policy) => policy.operationId === operation),
      ).toBe(true);
    }
  });
});

function handlerOf(
  prototype: object,
  method: string,
): (...args: never[]) => unknown {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    prototype,
    method,
  )?.value;
  if (typeof handler !== 'function') throw new Error('Missing route handler');
  return handler as (...args: never[]) => unknown;
}
