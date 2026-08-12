import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
  Res,
  Inject,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthorizeRoute } from '../authorization/route-policy.decorator.js';
import {
  UpdateUserRoleRequestDto,
  UpdateUserStatusRequestDto,
  UserIdParamsDto,
  UserListQueryDto,
  UserListResponseDto,
  UserResponseDto,
} from '../contracts/user.dto.js';
import { formatStrongEtag } from '../http/request-contract.js';
import {
  type AuthenticatedRequest,
  getAuthenticatedPrincipal,
} from '../auth/auth-request.js';
import { UsersService } from './users.service.js';
import { clearAuthCookie } from '../auth/auth-cookie.policy.js';
import {
  AUTH_COOKIE_POLICY,
  type RuntimeAuthCookiePolicy,
} from '../auth/auth.tokens.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    @Inject(AUTH_COOKIE_POLICY)
    private readonly cookies: RuntimeAuthCookiePolicy,
  ) {}

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthorizeRoute('deleteCurrentUser')
  async deleteCurrentUser(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.users.deleteCurrentUser(getAuthenticatedPrincipal(request), {
      ifMatch: request.get('if-match'),
      idempotencyKey: request.get('idempotency-key'),
    });
    response.setHeader('Cache-Control', 'no-store');
    clearAuthCookie(response, this.cookies.access);
    clearAuthCookie(response, this.cookies.refresh);
    clearAuthCookie(response, this.cookies.csrf);
    clearAuthCookie(response, this.cookies.preauthCsrf);
  }

  @Get()
  @AuthorizeRoute('listUsers')
  list(
    @Query() query: UserListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserListResponseDto> {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    return this.users.list(query);
  }

  @Get(':userId')
  @AuthorizeRoute('getUser')
  async get(
    @Param() params: UserIdParamsDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponseDto> {
    const user = await this.users.get(params.userId);
    response.setHeader('ETag', formatStrongEtag(user.version));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    return user;
  }

  @Patch(':userId/role')
  @AuthorizeRoute('updateUserRole')
  async updateRole(
    @Param() params: UserIdParamsDto,
    @Body() input: UpdateUserRoleRequestDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponseDto> {
    const user = await this.users.updateRole(
      getAuthenticatedPrincipal(request),
      params.userId,
      input.role,
      {
        ifMatch: request.get('if-match'),
        idempotencyKey: request.get('idempotency-key'),
      },
    );
    response.setHeader('ETag', formatStrongEtag(user.version));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    return user;
  }

  @Patch(':userId/status')
  @AuthorizeRoute('updateUserStatus')
  async updateStatus(
    @Param() params: UserIdParamsDto,
    @Body() input: UpdateUserStatusRequestDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponseDto> {
    const user = await this.users.updateStatus(
      getAuthenticatedPrincipal(request),
      params.userId,
      input.status,
      {
        ifMatch: request.get('if-match'),
        idempotencyKey: request.get('idempotency-key'),
      },
    );
    response.setHeader('ETag', formatStrongEtag(user.version));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    return user;
  }
}
