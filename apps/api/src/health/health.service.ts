import {
  Injectable,
  Optional,
  ServiceUnavailableException,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

export interface DatabaseHealthSource {
  query(sql: string): Promise<unknown>;
  showMigrations(): Promise<boolean>;
}

export interface HealthStatus {
  readonly status: 'ok' | 'not-ready';
}

@Injectable()
export class HealthService implements BeforeApplicationShutdown {
  private ready = true;

  constructor(
    @Optional()
    @InjectDataSource()
    private readonly dataSource?: DatabaseHealthSource,
  ) {}

  liveness(): HealthStatus {
    return { status: 'ok' };
  }

  async readiness(): Promise<HealthStatus> {
    if (!this.ready) {
      throw new ServiceUnavailableException();
    }

    if (this.dataSource) {
      try {
        await this.dataSource.query('SELECT 1');
        if (await this.dataSource.showMigrations()) {
          throw new Error('Pending migrations exist');
        }
      } catch {
        throw new ServiceUnavailableException();
      }
    }
    return { status: 'ok' };
  }

  beforeApplicationShutdown(): void {
    this.ready = false;
  }
}
