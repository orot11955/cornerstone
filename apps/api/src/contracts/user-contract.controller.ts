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
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiOptimisticMutation,
  ApiStandardErrors,
} from './contract-decorators.js';
import {
  UpdateUserRoleRequestDto,
  UpdateUserStatusRequestDto,
  UserIdParamsDto,
  UserListQueryDto,
  UserListResponseDto,
  UserResponseDto,
} from './user.dto.js';

@ApiTags('Users')
@Controller('users')
export class UserContractController {
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteCurrentUser' })
  @ApiOptimisticMutation()
  @ApiNoContentResponse()
  @ApiStandardErrors(400, 401, 403, 409, 412, 429)
  deleteCurrentUser(): void {
    return contractOnly();
  }

  @Get()
  @ApiOperation({ operationId: 'listUsers' })
  @ApiOkResponse({ type: UserListResponseDto })
  @ApiStandardErrors(400, 401, 403)
  list(@Query() query: UserListQueryDto): UserListResponseDto {
    return contractOnly(query);
  }

  @Get(':userId')
  @ApiOperation({ operationId: 'getUser' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiStandardErrors(400, 401, 403, 404)
  get(@Param() params: UserIdParamsDto): UserResponseDto {
    return contractOnly(params);
  }

  @Patch(':userId/role')
  @ApiOperation({ operationId: 'updateUserRole' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOptimisticMutation()
  @ApiOkResponse({
    type: UserResponseDto,
    headers: { ETag: { description: 'Updated strong version ETag.' } },
  })
  @ApiStandardErrors(400, 401, 403, 404, 409, 412, 429)
  updateRole(
    @Param() params: UserIdParamsDto,
    @Body() input: UpdateUserRoleRequestDto,
  ): UserResponseDto {
    return contractOnly([params, input]);
  }

  @Patch(':userId/status')
  @ApiOperation({ operationId: 'updateUserStatus' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOptimisticMutation()
  @ApiOkResponse({
    type: UserResponseDto,
    headers: { ETag: { description: 'Updated strong version ETag.' } },
  })
  @ApiStandardErrors(400, 401, 403, 404, 409, 412, 429)
  updateStatus(
    @Param() params: UserIdParamsDto,
    @Body() input: UpdateUserStatusRequestDto,
  ): UserResponseDto {
    return contractOnly([params, input]);
  }
}

function contractOnly<T>(input?: unknown): T {
  void input;
  throw new Error('Contract-only route must not be invoked');
}
