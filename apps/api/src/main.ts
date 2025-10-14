import 'reflect-metadata';

import type { LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ensureEnv } from '@packages/agents';
import { NestLogger, createLogger } from '@packages/logger';

import { OpenAIErrorFilter } from './filters/openai-error.filter';
import { AppModule } from './modules/app.module';

ensureEnv();

async function bootstrap() {
  // Map LOG_LEVEL env var to NestJS log levels
  // Your logger: debug, info, warn, error
  // NestJS: log (→info), debug (→debug), verbose (→debug), warn, error
  const logLevel = process.env.LOG_LEVEL?.toLowerCase() || 'info';

  const logLevels = ((): LogLevel[] => {
    switch (logLevel) {
      case 'debug':
        return ['error', 'warn', 'log', 'debug', 'verbose'];
      case 'info':
        return ['error', 'warn', 'log'];
      case 'warn':
        return ['error', 'warn'];
      case 'error':
        return ['error'];
      default:
        return ['error', 'warn', 'log'];
    }
  })();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: logLevels
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
