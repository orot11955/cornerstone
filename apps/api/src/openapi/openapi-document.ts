import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import {
  getRoutePolicy,
  routePolicies,
  type HttpMethod,
  type RoutePolicy,
} from '../authorization/route-policy.js';

const operationMethods = ['delete', 'get', 'patch', 'post'] as const;

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Cornerstone API')
    .setDescription('Versioned Cornerstone identity and platform API contract.')
    .setVersion('1.0.0')
    .setOpenAPIVersion('3.0.3')
    .addServer('/', 'API origin')
    .addCookieAuth(
      '__Host-cs_access',
      { type: 'apiKey', in: 'cookie' },
      'sessionCookie',
    )
    .addCookieAuth(
      '__Host-cs_refresh',
      { type: 'apiKey', in: 'cookie' },
      'refreshCookie',
    )
    .addCookieAuth(
      '__Host-cs_csrf',
      { type: 'apiKey', in: 'cookie' },
      'csrfCookie',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description:
          'Session-bound CSRF token for unsafe cookie-auth requests.',
      },
      'csrfHeader',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controller, method) => method,
  });
  document.security = [{ sessionCookie: [] }];
  classifyOperations(document);
  closeObjectSchemas(document);
  return document;
}

function classifyOperations(document: OpenAPIObject): void {
  const classified = new Set<string>();
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of operationMethods) {
      const operation = Reflect.get(pathItem, method) as unknown;
      if (typeof operation !== 'object' || operation === null) continue;
      const policy = getRoutePolicy(method, path);
      if (!policy)
        throw new Error(`OpenAPI route has no policy: ${method} ${path}`);
      const operationId = Reflect.get(operation, 'operationId') as unknown;
      if (operationId !== policy.operationId) {
        throw new Error(
          `Operation ID mismatch for ${method} ${path}: ${String(operationId)}`,
        );
      }
      Reflect.set(operation, 'security', operationSecurity(policy));
      Reflect.set(operation, 'x-cornerstone-authorization', {
        roles: policy.roles,
        permission: policy.permission ?? null,
        ownership: policy.ownership,
        owner: policy.owner,
      });
      classified.add(policy.operationId);
    }
  }

  const missing = routePolicies.filter(
    (policy) => !classified.has(policy.operationId),
  );
  if (missing.length > 0) {
    throw new Error(
      `Route policy has no OpenAPI operation: ${missing
        .map((policy) => `${policy.method} ${policy.path}`)
        .join(', ')}`,
    );
  }
}

function operationSecurity(
  policy: RoutePolicy,
): readonly Readonly<Record<string, readonly string[]>>[] {
  if (policy.authentication === 'anonymous' && !policy.csrf) return [];
  const requirement: Record<string, readonly string[]> = {};
  if (policy.authentication !== 'anonymous') {
    requirement[
      policy.authentication === 'refresh' ? 'refreshCookie' : 'sessionCookie'
    ] = [];
  }
  if (policy.csrf) {
    requirement.csrfCookie = [];
    requirement.csrfHeader = [];
  }
  return [requirement];
}

function closeObjectSchemas(document: OpenAPIObject): void {
  const schemas = document.components?.schemas ?? {};
  for (const schema of Object.values(schemas)) {
    if (
      typeof schema === 'object' &&
      schema !== null &&
      Reflect.get(schema, 'type') === 'object'
    ) {
      Reflect.set(schema, 'additionalProperties', false);
    }
  }
}

export function isOperationMethod(value: string): value is HttpMethod {
  return operationMethods.includes(value as HttpMethod);
}
