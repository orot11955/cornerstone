import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApiApplication } from './bootstrap/api-application';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApiApplication(app);
  const configService = app.get(ConfigService);

  await app.listen(configService.getOrThrow<number>('app.port'));
}

void bootstrap();
