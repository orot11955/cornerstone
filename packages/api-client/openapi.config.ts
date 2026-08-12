export const openapiConfig = {
  schema: '../../apps/api/openapi/openapi.json',
  output: 'src/generated/schema.ts',
  arguments: ['--alphabetize', '--immutable'],
  prettierConfig: '../../.prettierrc',
} as const
