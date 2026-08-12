import {
  Injectable,
  ServiceUnavailableException,
  type BeforeApplicationShutdown,
} from '@nestjs/common';

export interface HealthStatus {
  readonly status: 'ok' | 'not-ready';
}

@Injectable()
export class HealthService implements BeforeApplicationShutdown {
  private ready = true;

  liveness(): HealthStatus {
    return { status: 'ok' };
  }

  readiness(): HealthStatus {
    if (!this.ready) {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }

  beforeApplicationShutdown(): void {
    this.ready = false;
  }
}
