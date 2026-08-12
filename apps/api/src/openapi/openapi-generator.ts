import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { format, resolveConfig } from 'prettier';
import { ApiContractModule } from '../contracts/api-contract.module.js';
import { createOpenApiDocument } from './openapi-document.js';

const output = fileURLToPath(
  new URL('../../openapi/openapi.json', import.meta.url),
);

async function run(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'generate' && command !== 'check') {
    throw new Error('Expected generate or check');
  }

  const app = await NestFactory.create(ApiContractModule, { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    const serialized = await format(
      JSON.stringify(sortJson(createOpenApiDocument(app))),
      {
        ...(await resolveConfig(output)),
        filepath: output,
      },
    );
    if (command === 'generate') {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, serialized, 'utf8');
      process.stdout.write('OpenAPI snapshot generated.\n');
      return;
    }

    const current = readFileSync(output, 'utf8');
    if (current !== serialized) {
      throw new Error('OpenAPI snapshot drift detected; run openapi:generate');
    }
    process.stdout.write('OpenAPI snapshot check: OK\n');
  } finally {
    await app.close();
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'OpenAPI failed';
  process.stderr.write(`OpenAPI command failed: ${message}\n`);
  process.exitCode = 1;
});
