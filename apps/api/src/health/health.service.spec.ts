import { ServiceUnavailableException } from '@nestjs/common';
import { type DatabaseHealthSource, HealthService } from './health.service.js';

describe('HealthService', () => {
  it('lowers readiness before application shutdown while liveness remains available', async () => {
    const health = new HealthService();
    expect(health.liveness()).toEqual({ status: 'ok' });
    await expect(health.readiness()).resolves.toEqual({ status: 'ok' });
    health.beforeApplicationShutdown();
    await expect(health.readiness()).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(health.liveness()).toEqual({ status: 'ok' });
  });

  it('fails readiness when the database is unavailable or has pending migrations', async () => {
    const unavailableSource: DatabaseHealthSource = {
      query: () => Promise.reject(new Error('connection secret')),
      showMigrations: () => Promise.resolve(false),
    };
    const unavailable = new HealthService(unavailableSource);
    await expect(unavailable.readiness()).rejects.toThrow(
      ServiceUnavailableException,
    );

    const pendingSource: DatabaseHealthSource = {
      query: () => Promise.resolve([{ value: 1 }]),
      showMigrations: () => Promise.resolve(true),
    };
    const pending = new HealthService(pendingSource);
    await expect(pending.readiness()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
