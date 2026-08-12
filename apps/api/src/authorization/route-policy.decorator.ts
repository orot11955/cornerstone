import { SetMetadata } from '@nestjs/common';

export const ROUTE_POLICY_OPERATION = 'cornerstone.route-policy.operation';

export function AuthorizeRoute(operationId: string): MethodDecorator {
  if (!/^[A-Za-z][A-Za-z0-9]{1,79}$/.test(operationId)) {
    throw new TypeError('Route policy operation ID is invalid');
  }
  return SetMetadata(ROUTE_POLICY_OPERATION, operationId);
}
