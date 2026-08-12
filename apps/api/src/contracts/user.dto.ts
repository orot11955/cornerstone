import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { roles, userStatuses } from '../identity/identity.contract.js';
import type { Role, UserStatus } from '../identity/identity.contract.js';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email', maxLength: 254 })
  email!: string;

  @ApiProperty({ enum: userStatuses })
  status!: UserStatus;

  @ApiProperty({ enum: roles })
  role!: Role;

  @ApiProperty({ minimum: 0 })
  version!: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  emailVerifiedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class UserListQueryDto {
  @ApiProperty({
    type: Number,
    required: false,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiProperty({
    type: Number,
    required: false,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiProperty({ required: false, enum: userStatuses })
  @IsOptional()
  @IsIn(userStatuses)
  status?: UserStatus;
}

export class UserListResponseDto {
  @ApiProperty({ type: UserResponseDto, isArray: true })
  items!: UserResponseDto[];

  @ApiProperty({ example: 1, minimum: 1 })
  page!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 100 })
  pageSize!: number;

  @ApiProperty({ example: 42, minimum: 0 })
  total!: number;
}

export class UpdateUserRoleRequestDto {
  @ApiProperty({ enum: roles })
  @IsIn(roles)
  role!: Role;
}

export class UpdateUserStatusRequestDto {
  @ApiProperty({ enum: userStatuses })
  @IsIn(userStatuses)
  status!: UserStatus;
}

export class UserIdParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  userId!: string;
}
