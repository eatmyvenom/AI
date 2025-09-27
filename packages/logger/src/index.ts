import { LoggerService } from '@nestjs/common';
import { bold, cyan, gray, magenta, red, yellow } from 'colorette';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogMethod = (message: string, metadata?: Record<string, unknown>) => void;

export interface StructuredLogger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: (message: string, metadata?: Record<string, unknown> | Error) => void;
}

interface FormatterOptions {
  level: LogLevel;
  namespace: string;
  message: string;
  metadata?: Record<string, unknown> | Error;
}

const levelColors: Record<LogLevel, (value: string) => string> = {
  debug: gray,
  info: cyan,
  warn: yellow,
  error: red
};

function formatEntry({ level, namespace, message, metadata }: FormatterOptions) {
  const timestamp = new Date().toISOString();
  const levelLabel = levelColors[level](level.toUpperCase().padEnd(5));
  const scope = magenta(`[${namespace}]`);
  const base = `${gray(timestamp)} ${levelLabel} ${scope} ${bold(message)}`;

  if (!metadata) {
    return base;
  }

  if (metadata instanceof Error) {
    return `${base} ${red(metadata.stack ?? metadata.message)}`;
  }

  return `${base} ${gray(JSON.stringify(metadata))}`;
}

export function createLogger(namespace = 'app'): StructuredLogger {
  const log = (level: LogLevel, message: string, metadata?: Record<string, unknown> | Error) => {
    const entry = formatEntry({ level, namespace, message, metadata });

    switch (level) {
      case 'debug':
        console.debug(entry);
        break;
      case 'info':
        console.info(entry);
        break;
      case 'warn':
        console.warn(entry);
        break;
      case 'error':
        console.error(entry);
        break;
      default:
        console.log(entry);
    }
  };

  return {
    debug: (message, metadata) => log('debug', message, metadata),
    info: (message, metadata) => log('info', message, metadata),
    warn: (message, metadata) => log('warn', message, metadata),
    error: (message, metadata) => log('error', message, metadata)
  };
}

export class NestLogger implements LoggerService {
  constructor(private readonly logger: StructuredLogger = createLogger('nest')) {}

  log(message: unknown, metadata?: Record<string, unknown>) {
    this.logger.info(String(message), metadata);
  }

  error(message: unknown, trace?: string, context?: string) {
    const meta: Record<string, unknown> = {};
    if (context) {
      meta.context = context;
    }
    if (trace) {
      meta.trace = trace;
    }
    this.logger.error(String(message), Object.keys(meta).length > 0 ? meta : undefined);
  }

  warn(message: unknown, metadata?: Record<string, unknown>) {
    this.logger.warn(String(message), metadata);
  }

  debug(message: unknown, metadata?: Record<string, unknown>) {
    this.logger.debug(String(message), metadata);
  }

  verbose(message: unknown, metadata?: Record<string, unknown>) {
    this.logger.debug(String(message), metadata);
  }
}
