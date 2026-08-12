import {
  getRoutePolicy,
  routePolicies,
  validateRoutePolicies,
} from './route-policy.js';

describe('routePolicies', () => {
  it('is default-deny for an unclassified route', () => {
    expect(getRoutePolicy('GET', '/api/v1/unclassified')).toBeUndefined();
  });

  it('classifies public, refresh, self and administrator boundaries', () => {
    expect(getRoutePolicy('POST', '/api/v1/auth/login')).toMatchObject({
      authentication: 'anonymous',
      roles: [],
    });
    expect(getRoutePolicy('POST', '/api/v1/auth/refresh')).toMatchObject({
      authentication: 'refresh',
      csrf: true,
    });
    expect(getRoutePolicy('GET', '/api/v1/auth/me')).toMatchObject({
      ownership: 'self',
      roles: ['user', 'admin'],
    });
    expect(
      getRoutePolicy('PATCH', '/api/v1/users/{userId}/role'),
    ).toMatchObject({ roles: ['admin'], csrf: true });
  });

  it('rejects duplicate route and operation entries', () => {
    expect(() =>
      validateRoutePolicies([routePolicies[0], routePolicies[0]]),
    ).toThrow('Duplicate route policy');
    expect(() =>
      validateRoutePolicies([
        routePolicies[0],
        { ...routePolicies[1], operationId: routePolicies[0].operationId },
      ]),
    ).toThrow('Duplicate operation policy');
  });
});
