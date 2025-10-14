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

  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400
  });

  // Global OpenAI-style error shaping
  app.useGlobalFilters(new OpenAIErrorFilter());

  // Log unknown endpoints (404) after response finishes
  // This captures requests that don't hit any controller/interceptor.
  // Useful to diagnose external clients probing non-existent routes.
  app.use((req: unknown, res: unknown, next: () => void) => {
    // Narrow common fields used for logging only
    const r = req as { method?: string; url?: string; originalUrl?: string };
    const s = res as { statusCode?: number; on?: (event: string, cb: () => void) => void };
    try {
      s.on?.('finish', () => {
        if (s.statusCode === 404) {
          const method = r.method ?? 'UNKNOWN';
          const url = (r as { originalUrl?: string }).originalUrl ?? r.url ?? 'UNKNOWN';
          logger.warn('Unknown endpoint requested (404)', { method, url });
        }
      });
    } catch {
      // Best-effort logging; never block the request pipeline
    }
    next();
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.info(`API listening on http://localhost:${port}`);
}

void bootstrap();
