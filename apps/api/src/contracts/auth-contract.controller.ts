import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthenticatedUserResponseDto,
  ChangePasswordRequestDto,
  ConfirmRecentAuthRequestDto,
  EmailRequestDto,
  LoginRequestDto,
  RefreshResponseDto,
  RegisterRequestDto,
  ResetPasswordRequestDto,
  SessionIdParamsDto,
  SessionListResponseDto,
  VerifyEmailRequestDto,
} from './auth.dto.js';
import { AcceptedResponseDto } from './common.dto.js';
import { ApiCsrfHeader, ApiStandardErrors } from './contract-decorators.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthContractController {
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ operationId: 'register' })
  @ApiCsrfHeader()
  @ApiAcceptedResponse({ type: AcceptedResponseDto })
  @ApiStandardErrors(400, 429)
  register(@Body() input: RegisterRequestDto): AcceptedResponseDto {
    return contractOnly(input);
  }

  @Post('verify-email')
  @ApiOperation({ operationId: 'verifyEmail' })
  @ApiCsrfHeader()
  @ApiOkResponse({ type: AcceptedResponseDto })
  @ApiStandardErrors(400, 409, 429)
  verifyEmail(@Body() input: VerifyEmailRequestDto): AcceptedResponseDto {
    return contractOnly(input);
  }

  @Post('verification/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ operationId: 'resendVerification' })
  @ApiCsrfHeader()
  @ApiAcceptedResponse({ type: AcceptedResponseDto })
  @ApiStandardErrors(400, 429)
  resendVerification(@Body() input: EmailRequestDto): AcceptedResponseDto {
    return contractOnly(input);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'login' })
  @ApiCsrfHeader()
  @ApiOkResponse({
    type: AuthenticatedUserResponseDto,
    headers: { 'Set-Cookie': { description: 'Host-only auth cookies.' } },
  })
  @ApiStandardErrors(400, 401, 429)
  login(@Body() input: LoginRequestDto): AuthenticatedUserResponseDto {
    return contractOnly(input);
  }

  @Get('me')
  @ApiOperation({ operationId: 'getCurrentUser' })
  @ApiOkResponse({ type: AuthenticatedUserResponseDto })
  @ApiStandardErrors(401, 403)
  me(): AuthenticatedUserResponseDto {
    return contractOnly();
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'refreshSession' })
  @ApiCsrfHeader()
  @ApiOkResponse({
    type: RefreshResponseDto,
    headers: {
      'Set-Cookie': { description: 'Rotated host-only auth cookies.' },
    },
  })
  @ApiStandardErrors(401, 403, 429)
  refresh(): RefreshResponseDto {
    return contractOnly();
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'logout' })
  @ApiCsrfHeader()
  @ApiNoContentResponse({
    headers: { 'Set-Cookie': { description: 'Expired auth cookies.' } },
  })
  @ApiStandardErrors(401, 403)
  logout(): void {
    return contractOnly();
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ operationId: 'requestPasswordReset' })
  @ApiCsrfHeader()
  @ApiAcceptedResponse({ type: AcceptedResponseDto })
  @ApiStandardErrors(400, 429)
  requestPasswordReset(@Body() input: EmailRequestDto): AcceptedResponseDto {
    return contractOnly(input);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'resetPassword' })
  @ApiCsrfHeader()
  @ApiNoContentResponse()
  @ApiStandardErrors(400, 409, 429)
  resetPassword(@Body() input: ResetPasswordRequestDto): void {
    return contractOnly(input);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'changePassword' })
  @ApiCsrfHeader()
  @ApiNoContentResponse()
  @ApiStandardErrors(400, 401, 403, 409, 429)
  changePassword(@Body() input: ChangePasswordRequestDto): void {
    return contractOnly(input);
  }

  @Post('recent-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'confirmRecentAuthentication' })
  @ApiCsrfHeader()
  @ApiNoContentResponse()
  @ApiStandardErrors(400, 401, 403, 429)
  confirmRecentAuthentication(
    @Body() input: ConfirmRecentAuthRequestDto,
  ): void {
    return contractOnly(input);
  }

  @Get('sessions')
  @ApiOperation({ operationId: 'listSessions' })
  @ApiOkResponse({ type: SessionListResponseDto })
  @ApiStandardErrors(401, 403)
  sessions(): SessionListResponseDto {
    return contractOnly();
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'revokeSession' })
  @ApiCsrfHeader()
  @ApiNoContentResponse()
  @ApiStandardErrors(400, 401, 403, 404)
  revokeSession(@Param() params: SessionIdParamsDto): void {
    return contractOnly(params);
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'revokeAllSessions' })
  @ApiCsrfHeader()
  @ApiNoContentResponse()
  @ApiStandardErrors(401, 403)
  revokeAllSessions(): void {
    return contractOnly();
  }
}

function contractOnly<T>(input?: unknown): T {
  void input;
  throw new Error('Contract-only route must not be invoked');
}
