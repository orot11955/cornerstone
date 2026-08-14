import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Server } from 'node:http';
import { AppModule } from './app.module.js';
import { configureApiApplication } from './bootstrap/api-application.js';
import { StructuredLogger } from './observability/structured-logger.service.js';
import { GracefulShutdownCoordinator } from './health/graceful-shutdown.coordinator.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.useLogger(app.get(StructuredLogger));
  configureApiApplication(app);
  const configService = app.get(ConfigService);

  await app.listen(configService.getOrThrow<number>('app.port'));
  const server = app.getHttpServer() as Server;
  app
    .get(GracefulShutdownCoordinator)
    .installSignalHandler(server, () => app.close());
}

void bootstrap();
