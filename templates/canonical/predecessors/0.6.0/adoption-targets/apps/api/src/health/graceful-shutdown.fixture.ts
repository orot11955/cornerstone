import { createServer } from 'node:http';
import { GracefulShutdownCoordinator } from './graceful-shutdown.coordinator.js';
import { HealthService } from './health.service.js';
import { StructuredLogger } from '../observability/structured-logger.service.js';

const coordinator = new GracefulShutdownCoordinator(
  new HealthService(),
  new StructuredLogger(() => undefined),
  { drainTimeoutMs: 500, shutdownTimeoutMs: 100 },
);
const server = createServer((request, response) => {
  coordinator.trackRequest(request as never, response as never, () => {
    if (request.url === '/hold') {
      process.stdout.write('HOLD\n');
      setTimeout(() => response.end('drained'), 50);
      return;
    }
    response.writeHead(404).end();
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exitCode = 1;
  else process.stdout.write(`PORT:${address.port}\n`);
});
coordinator.installSignalHandler(server, () =>
  process.env.CLOSE_HANG === '1'
    ? new Promise<void>(() => undefined)
    : Promise.resolve(),
);
