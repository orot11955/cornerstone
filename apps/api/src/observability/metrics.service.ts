import { Injectable } from '@nestjs/common';

export interface HttpMetric {
  readonly routeId: string;
  readonly statusClass: string;
  readonly count: number;
  readonly durationMsTotal: number;
}

@Injectable()
export class MetricsService {
  private readonly http = new Map<string, HttpMetric>();

  recordHttp(routeId: string, status: number, durationMs: number): void {
    const safeRouteId = /^[A-Z]+ [A-Za-z0-9_.]+$/.test(routeId)
      ? routeId
      : 'UNKNOWN unknown';
    const statusClass = `${Math.floor(status / 100)}xx`;
    const key = `${safeRouteId}|${statusClass}`;
    const current = this.http.get(key);
    this.http.set(key, {
      routeId: safeRouteId,
      statusClass,
      count: (current?.count ?? 0) + 1,
      durationMsTotal:
        (current?.durationMsTotal ?? 0) + Math.max(0, durationMs),
    });
  }

  snapshot(): readonly HttpMetric[] {
    return [...this.http.values()].sort((left, right) =>
      `${left.routeId}|${left.statusClass}`.localeCompare(
        `${right.routeId}|${right.statusClass}`,
      ),
    );
  }
}
