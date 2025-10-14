import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

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
  colorize?: boolean;
  timestamp?: string;
}

const levelColors: Record<LogLevel, (value: string) => string> = {
  debug: gray,
  info: cyan,
  warn: yellow,
  error: red
};

function sanitizeNamespace(namespace: string) {
  const segments = namespace
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9-_]/g, '-'));

  return segments.join(sep) || 'app';
}

function applyColor(value: string, transformer: (input: string) => string, colorize: boolean) {
  return colorize ? transformer(value) : value;
}

function formatEntry({ level, namespace, message, metadata, colorize = true, timestamp }: FormatterOptions) {
  const entryTimestamp = timestamp ?? new Date().toISOString();
  const levelText = level.toUpperCase().padEnd(5);
  const scopeText = `[${namespace}]`;
  const base = `${applyColor(entryTimestamp, gray, colorize)} ${applyColor(levelText, levelColors[level], colorize)} ${
    applyColor(scopeText, magenta, colorize)
  } ${applyColor(message, bold, colorize)}`;

  if (!metadata) {
    return base;
  }

  if (metadata instanceof Error) {
    const errorDetails = metadata.stack ?? metadata.message;
    return `${base} ${applyColor(errorDetails, red, colorize)}`;
  }

  return `${base} ${applyColor(JSON.stringify(metadata), gray, colorize)}`;
}

export function createLogger(namespace = 'app'): StructuredLogger {
  const timestamp = () => new Date().toISOString();
  const safeNamespace = sanitizeNamespace(namespace);
  const baseDir = resolve(process.cwd(), 'logs', safeNamespace);
  const errorLogFile = join(baseDir, 'errors.log');
  const generalLogFile = join(baseDir, 'logs.log');

  try {
    mkdirSync(baseDir, { recursive: true });
  } catch {
    // Ignore directory creation errors to avoid breaking the logger
  }

  const writeToFile = (filePath: string, line: string) => {
    try {
      appendFileSync(filePath, `${line}\n`);
    } catch {
      // Intentionally swallow errors to keep console logging functional
    }
  };

  const log = (level: LogLevel, message: string, metadata?: Record<string, unknown> | Error) => {
    const entryTimestamp = timestamp();
    const entry = formatEntry({ level, namespace, message, metadata, timestamp: entryTimestamp });
    const logLine = formatEntry({
      level,
      namespace,
      message,
      metadata,
      colorize: false,
      timestamp: entryTimestamp
    });

    const targetFile = level === 'error' || level === 'warn' ? errorLogFile : generalLogFile;
    writeToFile(targetFile, logLine);

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
