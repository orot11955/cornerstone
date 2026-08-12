import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthorizeRoute } from '../authorization/route-policy.decorator.js';
import {
  AuthenticatedUserResponseDto,
  ChangePasswordRequestDto,
  ConfirmRecentAuthRequestDto,
  CsrfResponseDto,
  EmailRequestDto,
  LoginRequestDto,
  RefreshResponseDto,
  RegisterRequestDto,
  ResetPasswordRequestDto,
  SessionIdParamsDto,
  SessionListResponseDto,
  VerifyEmailRequestDto,
} from '../contracts/auth.dto.js';
import { AcceptedResponseDto } from '../contracts/common.dto.js';
import { getRequestContext } from '../observability/request-context.js';
import { clearAuthCookie, issueAuthCookie } from './auth-cookie.policy.js';
import { AuthLifecycleService } from './auth-lifecycle.service.js';
import {
  type AuthenticatedRequest,
  getAuthenticatedPrincipal,
} from './auth-request.js';
import {
  AUTH_COOKIE_POLICY,
  type RuntimeAuthCookiePolicy,
} from './auth.tokens.js';
import { CsrfTokenService } from './csrf-token.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly lifecycle: AuthLifecycleService,
    private readonly csrf: CsrfTokenService,
    @Inject(AUTH_COOKIE_POLICY)
    private readonly cookies: RuntimeAuthCookiePolicy,
  ) {}

  @Get('csrf')
  @AuthorizeRoute('getCsrfToken')
  getCsrfToken(
    @Res({ passthrough: true }) response: Response,
  ): CsrfResponseDto {
    const csrfToken = this.csrf.issue('preauth:anonymous');
    response.setHeader('Cache-Control', 'no-store');
    issueAuthCookie(response, this.cookies.preauthCsrf, csrfToken);
    return { csrfToken };
  }

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthorizeRoute('register')
  async register(
    @Body() input: RegisterRequestDto,
    @Req() request: Request,
  ): Promise<AcceptedResponseDto> {
    await this.lifecycle.register(
      input.email,
      input.password,
      authContext(request),
    );
    return { accepted: true };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @AuthorizeRoute('verifyEmail')
  async verifyEmail(
    @Body() input: VerifyEmailRequestDto,
    @Req() request: Request,
  ): Promise<AcceptedResponseDto> {
    await this.lifecycle.verifyEmail(input.token, authContext(request));
    return { accepted: true };
  }

  @Post('verification/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthorizeRoute('resendVerification')
  async resendVerification(
    @Body() input: EmailRequestDto,
    @Req() request: Request,
  ): Promise<AcceptedResponseDto> {
    await this.lifecycle.resendVerification(input.email, authContext(request));
    return { accepted: true };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuthorizeRoute('login')
  async login(
    @Body() input: LoginRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedUserResponseDto> {
    const session = await this.lifecycle.login(
      input.email,
      input.password,
      authContext(request),
    );
    this.issueSessionCookies(response, session);
    return { user: session.user };
  }

  @Get('me')
  @AuthorizeRoute('getCurrentUser')
  me(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): AuthenticatedUserResponseDto {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    return { user: getAuthenticatedPrincipal(request).user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @AuthorizeRoute('refreshSession')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RefreshResponseDto> {
    const refreshToken = cookieValue(request, this.cookies.refresh.name);
    const session = await this.lifecycle.refresh(
      refreshToken,
      authContext(request),
    );
    this.issueSessionCookies(response, session);
    return { refreshed: true };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthorizeRoute('logout')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.lifecycle.logout(
      getAuthenticatedPrincipal(request),
      authContext(request),
    );
    this.clearSessionCookies(response);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthorizeRoute('requestPasswordReset')
  async requestPasswordReset(
    @Body() input: EmailRequestDto,
    @Req() request: Request,
  ): Promise<AcceptedResponseDto> {
    await this.lifecycle.requestPasswordReset(
      input.email,
      authContext(request),
    );
    return { accepted: true };
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthorizeRoute('resetPassword')
  async resetPassword(
    @Body() input: ResetPasswordRequestDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.lifecycle.resetPassword(
      input.token,
      input.newPassword,
      authContext(request),
    );
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthorizeRoute('changePassword')
  async changePassword(
    @Body() input: ChangePasswordRequestDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.lifecycle.changePassword(
      getAuthenticatedPrincipal(request),
      input.currentPassword,
      input.newPassword,
      authContext(request),
    );
    response.setHeader('Cache-Control', 'no-store');
    this.clearSessionCookies(response);
  }

  @Post('recent-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthorizeRoute('confirmRecentAuthentication')
  async confirmRecentAuthentication(
    @Body() input: ConfirmRecentAuthRequestDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.lifecycle.confirmRecentAuthentication(
      getAuthenticatedPrincipal(request),
      input.password,
      authContext(request),
    );
    response.setHeader('Cache-Control', 'no-store');
  }

  @Get('sessions')
  @AuthorizeRoute('listSessions')
  async listSessions(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionListResponseDto> {
    const sessions = await this.lifecycle.listSessions(
      getAuthenticatedPrincipal(request),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    return {
      items: sessions.map((session) => ({
        id: session.id,
        deviceLabel: session.deviceLabel,
        lastSeenAt: session.lastSeenAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
        current: session.current,
      })),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthorizeRoute('revokeSession')
  async revokeSession(
    @Param() params: SessionIdParamsDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const principal = getAuthenticatedPrincipal(request);
    await this.lifecycle.revokeSession(
      principal,
      params.sessionId,
      authContext(request),
    );
    response.setHeader('Cache-Control', 'no-store');
    if (params.sessionId.toLowerCase() === principal.sessionId.toLowerCase()) {
      this.clearSessionCookies(response);
    }
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthorizeRoute('revokeAllSessions')
  async revokeAllSessions(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.lifecycle.revokeAllSessions(
      getAuthenticatedPrincipal(request),
      authContext(request),
    );
    response.setHeader('Cache-Control', 'no-store');
    this.clearSessionCookies(response);
  }

  private issueSessionCookies(
    response: Response,
    session: Awaited<ReturnType<AuthLifecycleService['login']>>,
  ): void {
    response.setHeader('Cache-Control', 'no-store');
    clearAuthCookie(response, this.cookies.preauthCsrf);
    issueAuthCookie(response, this.cookies.access, session.accessToken);
    issueAuthCookie(response, this.cookies.refresh, session.refreshToken);
    issueAuthCookie(
      response,
      this.cookies.csrf,
      this.csrf.issue(`session:${session.sessionId}`),
    );
  }

  private clearSessionCookies(response: Response): void {
    clearAuthCookie(response, this.cookies.access);
    clearAuthCookie(response, this.cookies.refresh);
    clearAuthCookie(response, this.cookies.csrf);
    clearAuthCookie(response, this.cookies.preauthCsrf);
  }
}

function authContext(request: Request) {
  const context = getRequestContext();
  const deviceLabel = request.get('user-agent');
  return {
    ip: request.ip ?? request.socket.remoteAddress ?? '127.0.0.1',
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.traceId ? { traceId: context.traceId } : {}),
    ...(deviceLabel ? { deviceLabel } : {}),
  };
}

function cookieValue(request: Request, name: string): string {
  const cookies: unknown = request.cookies;
  if (typeof cookies !== 'object' || cookies === null) return '';
  const value = Reflect.get(cookies, name) as unknown;
  return typeof value === 'string' ? value : '';
}
