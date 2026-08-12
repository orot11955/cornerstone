import type { DataSource } from 'typeorm';
import { cleanupExpiredOperationalData } from './retention-cleanup.js';

describe('cleanupExpiredOperationalData', () => {
  it('rejects unbounded batch sizes before accessing the database', async () => {
    let calls = 0;
    const source = {
      query: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    } as unknown as DataSource;

    await expect(
      cleanupExpiredOperationalData(source, { batchSize: 0 }),
    ).rejects.toThrow('Retention batch size must be 1..1000');
    await expect(
      cleanupExpiredOperationalData(source, { batchSize: 1_001 }),
    ).rejects.toThrow('Retention batch size must be 1..1000');
    expect(calls).toBe(0);
  });
});
