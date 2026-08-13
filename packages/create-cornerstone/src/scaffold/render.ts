import { formatJsonDocument } from '../composition/composer.js'
import {
  assertScaffoldName,
  canonicalScaffoldId,
  computeScaffoldOptionsDigest,
  scaffoldKindSchema,
  scaffoldRegistryEntrySchema,
  type ScaffoldKind,
  type ScaffoldRegistryEntry,
} from './registry.js'

export interface ScaffoldGenerateOptions {
  timestamp?: string | number
}

export interface RenderedScaffold {
  entry: ScaffoldRegistryEntry
  files: ReadonlyMap<string, Uint8Array>
}

export function renderScaffold(
  kindInput: ScaffoldKind,
  name: string,
  options: ScaffoldGenerateOptions = {},
): RenderedScaffold {
  const kind = scaffoldKindSchema.parse(kindInput)
  assertScaffoldName(kind, name)
  const normalizedOptions = normalizeOptions(kind, options)
  const files = renderFiles(kind, name, normalizedOptions)
  const entry = scaffoldRegistryEntrySchema.parse({
    id: canonicalScaffoldId(kind, name),
    kind,
    version: 2,
    name,
    options: registryOptions(kind, normalizedOptions),
    optionsDigest: sha256Options(kind, normalizedOptions),
    paths: [...files.keys()].sort(),
  })
  return { entry, files }
}

function registryOptions(kind: ScaffoldKind, options: Readonly<Record<string, string | number>>) {
  if (kind === 'package') return { visibility: 'private' as const }
  if (kind === 'api') return { exposure: 'contract-only' as const }
  if (kind === 'migration') return { timestamp: Number(options.timestamp) }
  return {}
}

function sha256Options(kind: ScaffoldKind, options: Readonly<Record<string, string | number>>) {
  const value = registryOptions(kind, options)
  return computeScaffoldOptionsDigest(kind, value)
}

function normalizeOptions(
  kind: ScaffoldKind,
  options: ScaffoldGenerateOptions,
): Readonly<Record<string, string | number>> {
  const supplied = Object.entries(options).filter(([, value]) => value !== undefined)
  if (kind !== 'migration') {
    if (supplied.length > 0) throw new Error(`${kind} scaffold does not accept options`)
    return {}
  }
  if (supplied.length !== 1 || supplied[0]![0] !== 'timestamp') {
    throw new Error('Migration scaffold requires --timestamp <13-digit>')
  }
  const timestamp = supplied[0]![1]
  computeScaffoldOptionsDigest(kind, { timestamp })
  return { timestamp }
}

function renderFiles(
  kind: ScaffoldKind,
  name: string,
  options: Readonly<Record<string, string | number>>,
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  const kebab = kind === 'package' ? packageDirectory(name) : name
  const className = kind === 'migration' ? name : pascalCase(kebab)
  if (kind === 'package') {
    const root = `packages/${kebab}`
    add(
      files,
      `${root}/package.json`,
      `${JSON.stringify(
        {
          name,
          version: '0.1.0',
          private: true,
          type: 'module',
          engines: { node: '>=22.20.0 <25' },
          scripts: {
            build: 'tsc -p tsconfig.build.json',
            typecheck: 'tsc -p tsconfig.build.json --noEmit',
            'test:unit': 'pnpm build && node --test test/*.test.mjs',
          },
          exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
          files: ['dist'],
          sideEffects: false,
        },
        null,
        2,
      )}\n`,
    )
    addJson(files, `${root}/tsconfig.build.json`, {
      extends: '../tsconfig/node.json',
      compilerOptions: {
        declaration: true,
        declarationMap: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        outDir: 'dist',
        rootDir: 'src',
        sourceMap: true,
      },
      include: ['src/**/*.ts'],
    })
    add(files, `${root}/src/index.ts`, `export const packageName = '${name}'\n`)
    add(
      files,
      `${root}/test/index.test.mjs`,
      `import assert from 'node:assert/strict'\nimport test from 'node:test'\n\ntest('exports the generated package identity', async () => {\n  assert.equal((await import('../dist/index.js')).packageName, '${name}')\n})\n`,
    )
    return files
  }
  if (kind === 'feature' || kind === 'api') {
    const root = `apps/api/src/${kebab}`
    add(
      files,
      `${root}/${kebab}.service.ts`,
      `import { Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class ${className}Service {\n  status(): { readonly feature: string; readonly status: 'ok' } {\n    return { feature: '${kebab}', status: 'ok' };\n  }\n}\n`,
    )
    add(
      files,
      `${root}/${kebab}.service.spec.ts`,
      `import { ${className}Service } from './${kebab}.service.js';\n\ndescribe('${className}Service', () => {\n  it('reports its generated identity', () => {\n    expect(new ${className}Service().status()).toEqual({\n      feature: '${kebab}',\n      status: 'ok',\n    });\n  });\n});\n`,
    )
    if (kind === 'feature') {
      add(
        files,
        `${root}/${kebab}.module.ts`,
        `import { Module } from '@nestjs/common';\nimport { ${className}Service } from './${kebab}.service.js';\n\n@Module({\n  providers: [${className}Service],\n  exports: [${className}Service],\n})\nexport class ${className}Module {}\n`,
      )
    } else {
      add(
        files,
        `${root}/${kebab}.controller.ts`,
        `import { Controller, Get } from '@nestjs/common';\nimport { ${className}Service } from './${kebab}.service.js';\n\n@Controller('${kebab}')\nexport class ${className}Controller {\n  constructor(private readonly service: ${className}Service) {}\n\n  @Get()\n  status(): { readonly feature: string; readonly status: 'ok' } {\n    return this.service.status();\n  }\n}\n`,
      )
      add(
        files,
        `${root}/${kebab}.module.ts`,
        `import { Module } from '@nestjs/common';\nimport { ${className}Controller } from './${kebab}.controller.js';\nimport { ${className}Service } from './${kebab}.service.js';\n\n@Module({\n  controllers: [${className}Controller],\n  providers: [${className}Service],\n})\nexport class ${className}Module {}\n`,
      )
      add(
        files,
        `apps/api/src/contracts/${kebab}-contract.controller.ts`,
        `import { Controller, Get } from '@nestjs/common';\nimport { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';\nimport { ${className}ResponseDto } from './${kebab}.dto.js';\n\n@ApiTags('${className}')\n@Controller('${kebab}')\nexport class ${className}ContractController {\n  @Get()\n  @ApiOperation({ operationId: 'get${className}Status' })\n  @ApiOkResponse({ type: ${className}ResponseDto })\n  status(): ${className}ResponseDto {\n    throw new Error('Contract-only route must not be invoked');\n  }\n}\n`,
      )
      add(
        files,
        `apps/api/src/contracts/${kebab}.dto.ts`,
        `import { ApiProperty } from '@nestjs/swagger';\n\nexport class ${className}ResponseDto {\n  @ApiProperty({ example: '${kebab}' })\n  feature!: string;\n\n  @ApiProperty({ enum: ['ok'] })\n  status!: 'ok';\n}\n`,
      )
    }
    return files
  }
  const timestamp = String(options.timestamp)
  const basename = `${timestamp}-${name}`
  const root = 'apps/api/src/database/migrations'
  add(
    files,
    `${root}/${basename}.ts`,
    `import type { MigrationInterface, QueryRunner } from 'typeorm';\n\nexport class ${name}${timestamp} implements MigrationInterface {\n  name = '${name}${timestamp}';\n\n  async up(queryRunner: QueryRunner): Promise<void> {\n    void queryRunner;\n    throw new Error('Migration implementation required before execution');\n  }\n\n  async down(queryRunner: QueryRunner): Promise<void> {\n    void queryRunner;\n    throw new Error(\n      'Migration rollback implementation required before execution',\n    );\n  }\n}\n`,
  )
  addJson(files, `${root}/${basename}.metadata.json`, {
    schemaVersion: 1,
    migrationTimestamp: Number(timestamp),
    phase: 'expand',
    compatibleAppReleases: ['0.1.x'],
    transaction: 'each',
    estimatedDurationSeconds: 1,
    lockRisk: 'low',
    statementTimeoutMs: 30000,
    abortConditions: ['implementation_review_not_completed'],
    backfill: null,
    rollback: 'revert-before-production; roll-forward-after-production',
    verification: ['implementation-review', 'forward-revert-forward'],
  })
  return files
}

function add(files: Map<string, Uint8Array>, path: string, content: string): void {
  files.set(path, Buffer.from(content))
}

function addJson(files: Map<string, Uint8Array>, path: string, value: unknown): void {
  add(files, path, formatJsonDocument(value))
}

function packageDirectory(name: string): string {
  return name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
}

export function pascalCase(name: string): string {
  return name
    .split('-')
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join('')
}
