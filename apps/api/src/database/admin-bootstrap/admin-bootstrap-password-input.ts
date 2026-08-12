import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import type { AdminBootstrapEnvironment } from './admin-bootstrap-environment.js';

export class AdminBootstrapInputError extends Error {}

export async function readAdminBootstrapPassword(
  environment: AdminBootstrapEnvironment,
  stdin: AsyncIterable<Uint8Array> = process.stdin,
): Promise<Buffer> {
  const file = environment.ADMIN_BOOTSTRAP_PASSWORD_FILE;
  if (environment.NODE_ENV === 'production' && !file) {
    throw new AdminBootstrapInputError();
  }
  if (file) {
    try {
      if (environment.NODE_ENV !== 'production') {
        const details = await stat(file);
        if (
          !details.isFile() ||
          details.size > 1024 ||
          (details.mode & 0o077) !== 0
        ) {
          throw new AdminBootstrapInputError();
        }
        const handle = await open(file, constants.O_RDONLY);
        try {
          return validatePasswordBuffer(await handle.readFile());
        } finally {
          await handle.close();
        }
      }
      const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const details = await handle.stat();
        if (
          !details.isFile() ||
          details.size > 1024 ||
          (details.mode & 0o077) !== 0
        ) {
          throw new AdminBootstrapInputError();
        }
        return validatePasswordBuffer(await handle.readFile());
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof AdminBootstrapInputError) throw error;
      throw new AdminBootstrapInputError();
    }
  }
  return validatePasswordBuffer(await readInput(stdin));
}

async function readInput(input: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of input) {
      const value = Buffer.from(chunk);
      length += value.length;
      if (length > 1024) {
        value.fill(0);
        throw new AdminBootstrapInputError();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

export function validatePasswordBuffer(value: Buffer): Buffer {
  if (value.includes(0) || value.includes(10) || value.includes(13)) {
    value.fill(0);
    throw new AdminBootstrapInputError();
  }
  const decoded = value.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(value)) {
    value.fill(0);
    throw new AdminBootstrapInputError();
  }
  return value;
}
