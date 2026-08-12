import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasPermission } from '../identity/identity.contract.js';
import { routePolicies } from '../authorization/route-policy.js';
import { ROUTE_POLICY_OPERATION } from '../authorization/route-policy.decorator.js';
import { CsrfTokenService } from './csrf-token.service.js';
import { AuthLifecycleService } from './auth-lifecycle.service.js';
import { invalidSession } from './auth-lifecycle.error.js';
import {
  type AuthenticatedRequest,
  setAuthenticatedPrincipal,
} from './auth-request.js';
import {
  AUTH_COOKIE_POLICY,
  type RuntimeAuthCookiePolicy,
} from './auth.tokens.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly lifecycle: AuthLifecycleService,
    private readonly csrf: CsrfTokenService,
    @Inject(AUTH_COOKIE_POLICY)
    private readonly cookies: RuntimeAuthCookiePolicy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operationId = this.reflector.get<string>(
      ROUTE_POLICY_OPERATION,
      context.getHandler(),
    );
    const policy = operationId
      ? routePolicies.find((candidate) => candidate.operationId === operationId)
      : undefined;
    if (!policy) throw invalidSession();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const routePath = request.originalUrl.split('?', 1)[0] ?? '';
    if (
      request.method.toLowerCase() !== policy.method ||
      !routeMatches(policy.path, routePath)
    ) {
      throw invalidSession();
    }

    if (policy.authentication === 'anonymous') {
      if (policy.csrf) {
        this.requireCsrf(
          request,
          'preauth:anonymous',
          this.cookies.preauthCsrf.name,
        );
      }
      return true;
    }

    if (policy.authentication === 'refresh') {
      const refresh = requireCookie(request, this.cookies.refresh.name);
      const sessionId = await this.lifecycle.authorizeRefresh(
        refresh,
        clientIp(request),
      );
      if (!sessionId) throw invalidSession();
      this.requireCsrf(request, `session:${sessionId}`);
      return true;
    }

    const access = requireCookie(request, this.cookies.access.name);
    const principal = await this.lifecycle.authenticateAccess(access);
    if (
      !policy.roles.includes(principal.user.role) ||
      (policy.permission &&
        !hasPermission(principal.user.role, policy.permission))
    ) {
      throw new ForbiddenException();
    }
    if (policy.csrf) {
      this.requireCsrf(request, `session:${principal.sessionId}`);
    }
    setAuthenticatedPrincipal(request, principal);
    return true;
  }

  private requireCsrf(
    request: Request,
    binding: `preauth:${string}` | `session:${string}`,
    cookieName = this.cookies.csrf.name,
  ): void {
    const cookie = readCookie(request, cookieName);
    const header = request.get('x-csrf-token');
    if (!cookie || !header || !this.csrf.verify(cookie, header, binding)) {
      throw new ForbiddenException();
    }
  }
}

function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? '127.0.0.1';
}

function requireCookie(request: Request, name: string): string {
  const value = readCookie(request, name);
  if (!value) throw invalidSession();
  return value;
}

function readCookie(request: Request, name: string): string | undefined {
  if (cookieOccurrences(request.get('cookie'), name) !== 1) return undefined;
  const cookies: unknown = request.cookies;
  if (
    typeof cookies !== 'object' ||
    cookies === null ||
    Array.isArray(cookies)
  ) {
    return undefined;
  }
  const value = Reflect.get(cookies, name) as unknown;
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    return undefined;
  }
  return value;
}

function cookieOccurrences(header: string | undefined, name: string): number {
  if (!header || header.length > 16_384) return 0;
  return header.split(';').filter((part) => {
    const separator = part.indexOf('=');
    return separator > 0 && part.slice(0, separator).trim() === name;
  }).length;
}

function routeMatches(policyPath: string, actualPath: string): boolean {
  const pattern = policyPath
    .split('/')
    .map((segment) =>
      /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(segment)
        ? '[^/]+'
        : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${pattern}$`).test(actualPath);
}
