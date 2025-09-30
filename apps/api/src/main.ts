import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { NestLogger, createLogger } from '@packages/logger';

import { OpenAIErrorFilter } from './filters/openai-error.filter';
import { AppModule } from './modules/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });

  const logger = createLogger('api');
  app.useLogger(new NestLogger(logger));

  // Global OpenAI-style error shaping
  app.useGlobalFilters(new OpenAIErrorFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.info(`API listening on http://localhost:${port}`);
}

void bootstrap();
