import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserResponseDto } from './user.dto.js';

export class EmailRequestDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) => normalizeEmailInput(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class RegisterRequestDto extends EmailRequestDto {
  @ApiProperty({
    format: 'password',
    minLength: 12,
    maxLength: 128,
    writeOnly: true,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class LoginRequestDto extends RegisterRequestDto {}

export class TokenRequestDto {
  @ApiProperty({ minLength: 32, maxLength: 1024, writeOnly: true })
  @IsString()
  @MinLength(32)
  @MaxLength(1024)
  token!: string;
}

export class VerifyEmailRequestDto extends TokenRequestDto {}

export class ResetPasswordRequestDto extends TokenRequestDto {
  @ApiProperty({
    format: 'password',
    minLength: 12,
    maxLength: 128,
    writeOnly: true,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class ChangePasswordRequestDto {
  @ApiProperty({ format: 'password', maxLength: 128, writeOnly: true })
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({
    format: 'password',
    minLength: 12,
    maxLength: 128,
    writeOnly: true,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class ConfirmRecentAuthRequestDto {
  @ApiProperty({ format: 'password', maxLength: 128, writeOnly: true })
  @IsString()
  @MaxLength(128)
  password!: string;
}

export class AuthenticatedUserResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}

export class RefreshResponseDto {
  @ApiProperty({ example: true })
  refreshed!: true;
}

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 120, nullable: true, type: String })
  deviceLabel!: string | null;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: string;

  @ApiProperty({ format: 'date-time' })
  idleExpiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  absoluteExpiresAt!: string;

  @ApiProperty({ example: false })
  current!: boolean;
}

export class SessionListResponseDto {
  @ApiProperty({ type: SessionResponseDto, isArray: true })
  items!: SessionResponseDto[];
}

export class SessionIdParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sessionId!: string;
}

function normalizeEmailInput(value: unknown): unknown {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLowerCase()
    : value;
}
