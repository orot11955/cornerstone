import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('lowers readiness before application shutdown while liveness remains available', () => {
    const health = new HealthService();
    expect(health.liveness()).toEqual({ status: 'ok' });
    expect(health.readiness()).toEqual({ status: 'ok' });
    health.beforeApplicationShutdown();
    expect(() => health.readiness()).toThrow(ServiceUnavailableException);
    expect(health.liveness()).toEqual({ status: 'ok' });
  });
});
