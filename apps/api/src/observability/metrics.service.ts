import { Injectable } from '@nestjs/common';

export interface HttpMetric {
  readonly routeId: string;
  readonly statusClass: string;
  readonly count: number;
  readonly durationMsTotal: number;
}

export interface DatabaseMetric {
  readonly operation: string;
  readonly outcome: 'success' | 'failure';
  readonly count: number;
  readonly durationMsTotal: number;
}

export interface OutboundHttpMetric {
  readonly operation: string;
  readonly outcome: 'success' | 'failure';
  readonly count: number;
  readonly durationMsTotal: number;
}

@Injectable()
export class MetricsService {
  private readonly http = new Map<string, HttpMetric>();
  private readonly database = new Map<string, DatabaseMetric>();
  private readonly outboundHttp = new Map<string, OutboundHttpMetric>();

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

  recordDatabase(
    operation: string,
    outcome: DatabaseMetric['outcome'],
    durationMs: number,
  ): void {
    const safeOperation = /^[a-z][a-z0-9_.]{2,80}$/.test(operation)
      ? operation
      : 'database.unknown';
    const key = `${safeOperation}|${outcome}`;
    const current = this.database.get(key);
    this.database.set(key, {
      operation: safeOperation,
      outcome,
      count: (current?.count ?? 0) + 1,
      durationMsTotal:
        (current?.durationMsTotal ?? 0) + Math.max(0, durationMs),
    });
  }

  databaseSnapshot(): readonly DatabaseMetric[] {
    return [...this.database.values()].sort((left, right) =>
      `${left.operation}|${left.outcome}`.localeCompare(
        `${right.operation}|${right.outcome}`,
      ),
    );
  }

  recordOutboundHttp(
    operation: string,
    outcome: OutboundHttpMetric['outcome'],
    durationMs: number,
  ): void {
    const safeOperation = /^[a-z][a-z0-9_.]{2,80}$/.test(operation)
      ? operation
      : 'outbound.unknown';
    const key = `${safeOperation}|${outcome}`;
    const current = this.outboundHttp.get(key);
    this.outboundHttp.set(key, {
      operation: safeOperation,
      outcome,
      count: (current?.count ?? 0) + 1,
      durationMsTotal:
        (current?.durationMsTotal ?? 0) + Math.max(0, durationMs),
    });
  }

  outboundHttpSnapshot(): readonly OutboundHttpMetric[] {
    return [...this.outboundHttp.values()].sort((left, right) =>
      `${left.operation}|${left.outcome}`.localeCompare(
        `${right.operation}|${right.outcome}`,
      ),
    );
  }
}
