import { readFileSync } from 'node:fs';
import { routePolicies } from '../authorization/route-policy.js';

interface OperationSnapshot {
  readonly operationId?: string;
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
  readonly responses?: Readonly<Record<string, unknown>>;
  readonly ['x-cornerstone-authorization']?: unknown;
}

interface OpenApiSnapshot {
  readonly openapi?: string;
  readonly paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components?: {
    readonly schemas?: Readonly<Record<string, unknown>>;
    readonly securitySchemes?: Readonly<Record<string, unknown>>;
  };
}

const snapshot = JSON.parse(
  readFileSync(new URL('../../openapi/openapi.json', import.meta.url), 'utf8'),
) as OpenApiSnapshot;

describe('OpenAPI snapshot', () => {
  it('classifies every route with exact operation and security metadata', () => {
    expect(snapshot.openapi).toBe('3.0.3');
    for (const policy of routePolicies) {
      const operation = snapshot.paths?.[policy.path]?.[policy.method] as
        OperationSnapshot | undefined;
      expect(operation?.operationId).toBe(policy.operationId);
      expect(operation?.['x-cornerstone-authorization']).toBeDefined();
      if (policy.authentication === 'anonymous' && !policy.csrf) {
        expect(operation?.security).toEqual([]);
      } else {
        expect(operation?.security).toHaveLength(1);
      }
      if (policy.csrf) {
        expect(operation?.security?.[0]).toMatchObject({
          csrfCookie: [],
          csrfHeader: [],
        });
      }
    }
  });

  it('uses the runtime status contract and contains no secret storage fields', () => {
    const register = snapshot.paths?.['/api/v1/auth/register']?.['post'] as
      OperationSnapshot | undefined;
    expect(register?.responses?.['202']).toBeDefined();
    expect(register?.responses?.['200']).toBeUndefined();
    expect(register?.responses?.['409']).toBeUndefined();
    expect(register?.security?.[0]).toMatchObject({
      csrfCookie: [],
      csrfHeader: [],
    });

    expect(
      securitySchemeName(snapshot.components?.securitySchemes?.sessionCookie),
    ).toBe('__Host-cs_access');
    expect(
      securitySchemeName(snapshot.components?.securitySchemes?.refreshCookie),
    ).toBe('__Host-cs_refresh');
    expect(
      securitySchemeName(snapshot.components?.securitySchemes?.csrfCookie),
    ).toBe('__Host-cs_csrf');

    const listUsers = snapshot.paths?.['/api/v1/users']?.[
      'get'
    ] as OperationSnapshot & { readonly parameters?: readonly unknown[] };
    expect(JSON.stringify(listUsers.parameters)).toContain('pageSize');
    expect(JSON.stringify(listUsers.parameters)).not.toContain('"size"');

    const serializedSchemas = JSON.stringify(snapshot.components?.schemas);
    for (const forbidden of [
      'accessToken',
      'passwordHash',
      'refreshToken',
      'tokenHash',
    ]) {
      expect(serializedSchemas).not.toContain(forbidden);
    }
    expect(snapshot.components?.schemas?.['Object']).toBeUndefined();
  });
});

function securitySchemeName(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? (Reflect.get(value, 'name') as unknown)
    : undefined;
}
