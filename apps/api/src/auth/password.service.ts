import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import {
  InvalidPasswordError,
  PasswordWorkQueueFullError,
} from './auth-crypto.error.js';
import {
  AUTH_SECURITY_OPTIONS,
  type AuthSecurityOptions,
} from './auth-security.options.js';

@Injectable()
export class PasswordService {
  private readonly hashOptions: argon2.HashOptions;
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(@Inject(AUTH_SECURITY_OPTIONS) options: AuthSecurityOptions) {
    this.hashOptions = {
      type: argon2.argon2id,
      memoryCost: options.password.memoryCostKib,
      timeCost: options.password.timeCost,
      parallelism: options.password.parallelism,
      hashLength: options.password.hashLength,
    };
    this.maxConcurrent = options.password.maxConcurrent;
    this.maxQueue = options.password.maxQueue;
  }

  async hash(password: string): Promise<string> {
    assertPasswordLength(password);
    return this.runBounded(() => argon2.hash(password, this.hashOptions));
  }

  async verify(hash: string, password: string): Promise<boolean> {
    if (
      countCodePoints(password) > 128 ||
      hash.length > 512 ||
      !parsePasswordHash(hash)
    ) {
      return false;
    }
    try {
      return await this.runBounded(() => argon2.verify(hash, password));
    } catch (error) {
      if (error instanceof PasswordWorkQueueFullError) throw error;
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    try {
      const parsed = parsePasswordHash(hash);
      return (
        !parsed ||
        parsed.version !== 19 ||
        parsed.memoryCost !== this.hashOptions.memoryCost ||
        parsed.timeCost !== this.hashOptions.timeCost ||
        parsed.parallelism !== this.hashOptions.parallelism ||
        parsed.hashLength !== this.hashOptions.hashLength
      );
    } catch {
      return true;
    }
  }

  private async runBounded<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.waiting.length >= this.maxQueue) {
        throw new PasswordWorkQueueFullError();
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

interface ParsedPasswordHash {
  readonly version: number;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly hashLength: number;
}

function parsePasswordHash(hash: string): ParsedPasswordHash | undefined {
  const match =
    /^\$argon2id\$v=(\d+)\$([mtp]=\d+,[mtp]=\d+,[mtp]=\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      hash,
    );
  if (!match) return undefined;
  const version = Number(match[1]);
  const parameters = new Map<string, number>();
  for (const part of match[2]!.split(',')) {
    const parameter = /^([mtp])=(\d+)$/.exec(part);
    if (!parameter || parameters.has(parameter[1]!)) return undefined;
    parameters.set(parameter[1]!, Number(parameter[2]));
  }
  const memoryCost = parameters.get('m');
  const timeCost = parameters.get('t');
  const parallelism = parameters.get('p');
  const saltLength = Buffer.from(match[3]!, 'base64').length;
  const hashLength = Buffer.from(match[4]!, 'base64').length;
  if (
    memoryCost === undefined ||
    timeCost === undefined ||
    parallelism === undefined ||
    ![version, memoryCost, timeCost, parallelism].every(Number.isSafeInteger) ||
    version !== 19 ||
    memoryCost < 4_096 ||
    memoryCost > 262_144 ||
    timeCost < 1 ||
    timeCost > 5 ||
    parallelism < 1 ||
    parallelism > 4 ||
    saltLength < 16 ||
    saltLength > 64 ||
    hashLength < 16 ||
    hashLength > 64
  ) {
    return undefined;
  }
  return { version, memoryCost, timeCost, parallelism, hashLength };
}

function assertPasswordLength(password: string): void {
  const length = countCodePoints(password);
  if (length < 12 || length > 128) {
    throw new InvalidPasswordError(
      'Password must contain between 12 and 128 Unicode code points',
    );
  }
}

function countCodePoints(value: string): number {
  return [...value].length;
}
