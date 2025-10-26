import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { ConfigSchema, type Config } from './schema';
import type { ConfigLoadError, ConfigValidationResult } from './types';

/**
 * Find the monorepo root by looking for pnpm-workspace.yaml or turbo.json
 */
function findMonorepoRoot(startPath: string = process.cwd()): string {
  let currentPath = startPath;

  while (currentPath !== dirname(currentPath)) {
    if (existsSync(resolve(currentPath, 'pnpm-workspace.yaml')) ||
        existsSync(resolve(currentPath, 'turbo.json'))) {
      return currentPath;
    }
    currentPath = dirname(currentPath);
  }

  return startPath;
}

/**
 * Load configuration from file with environment variable substitution and validation
 */
export function loadConfig(configPath?: string): Config {
  const path = resolveConfigPath(configPath);
  const rawConfig = loadConfigFile(path);
  const processedConfig = substituteEnvironmentVariables(rawConfig);
  return validateConfig(processedConfig);
}

/**
 * Resolve the configuration file path
 */
function resolveConfigPath(configPath?: string): string {
  if (configPath) {
    const resolved = resolve(configPath);
    if (!existsSync(resolved)) {
      throw new ConfigError('CONFIG_FILE_NOT_FOUND', `Configuration file not found: ${resolved}`, { path: resolved, details: undefined });
    }
    return resolved;
  }

  // Find monorepo root and search there
  const monorepoRoot = findMonorepoRoot();
  const searchPaths = [
    resolve(monorepoRoot, 'config.js'),
    resolve(monorepoRoot, 'config.json'),
    resolve(monorepoRoot, 'config.ts'),
  ];

  for (const path of searchPaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new ConfigError('CONFIG_FILE_NOT_FOUND', 'No configuration file found in project root', {
    path: undefined,
    details: { searchedPaths: searchPaths, monorepoRoot }
  });
}

/**
 * Load configuration from file (supports .js, .json, .ts)
 */
function loadConfigFile(configPath: string): unknown {
  try {
    if (configPath.endsWith('.json')) {
      const content = readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    }

    // For .js and .ts files, clear the require cache and load fresh
    delete require.cache[require.resolve(configPath)];
    
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const configModule = require(configPath);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return configModule.default || configModule;
  } catch (error) {
    throw new ConfigError('CONFIG_LOAD_ERROR', `Failed to load configuration file: ${configPath}`, {
      path: configPath,
      details: error
    });
  }
}

/**
 * Substitute environment variables in configuration object
 * Supports ${VAR_NAME} and ${VAR_NAME:default_value} syntax
 */
function substituteEnvironmentVariables(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return substituteInString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(substituteEnvironmentVariables);
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvironmentVariables(value);
    }
    return result;
  }

  return obj;
}

function substituteInString(str: string): string {
  return str.replace(/\$\{([^:}]+)(?::([^}]+))?\}/g, (match, varName: string, defaultValue: string | undefined) => {
    const envValue = process.env[varName];
    if (envValue !== undefined) {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return match;
  });
}

/**
 * Validate configuration against schema
 */
function validateConfig(rawConfig: unknown): Config {
  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const error = new ConfigError('CONFIG_VALIDATION_ERROR', 'Configuration validation failed', {
      path: undefined,
      details: { errors: result.error.issues }
    });
    error.cause = result.error;
    throw error;
  }

  return result.data;
}

/**
 * Validate configuration without throwing (returns result object)
 */
export function validateConfigSafe(rawConfig: unknown): ConfigValidationResult {
  const result = ConfigSchema.safeParse(rawConfig);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.issues
  };
}

/**
 * Get configuration with fallback to environment variables (migration support)
 */
export function loadConfigWithMigration(configPath?: string): Config {
  try {
    return loadConfig(configPath);
  } catch (error) {
    if (error instanceof ConfigError && error.code === 'CONFIG_FILE_NOT_FOUND') {
      // Try to migrate from environment variables
      console.warn('[Config] No configuration file found, falling back to environment variables');
      return migrateFromEnvironmentVariables();
    }
    throw error;
  }
}

/**
 * Migrate configuration from environment variables (backward compatibility)
 */
export function migrateFromEnvironmentVariables(): Config {
  const config: Config = {
    api: {
      port: Number(process.env.PORT) || 3000,
      logLevel: (process.env.LOG_LEVEL as Config['api']['logLevel']) || 'info',
      cors: {
        origin: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type'],
        maxAge: 86400,
      },
    },
    provider: {
      baseURL: process.env.PROVIDER_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.PROVIDER_API_KEY,
      defaultModel: process.env.MODEL || 'gpt-4.1-mini',
      includeUsage: true,
    },
    aiProviders: {
      openai: { apiKey: process.env.AI_OPENAI_API_KEY },
      anthropic: { apiKey: process.env.AI_ANTHROPIC_API_KEY },
      xai: { apiKey: process.env.AI_XAI_API_KEY },
      groq: { apiKey: process.env.AI_GROQ_API_KEY },
      deepinfra: { apiKey: process.env.AI_DEEPINFRA_API_KEY },
      google: { apiKey: process.env.AI_GOOGLE_API_KEY },
    },
    mcp: {
      enabled: process.env.DISABLE_MCP_TOOLS !== 'true',
      servers: parseLegacyMCPServers(),
      global: {
        timeout: 60000,
        retry: {
          attempts: 2,
          backoff: 'exponential',
        },
      },
    },
    auth: {
      enabled: true,
      bearerToken: process.env.API_BEARER_TOKEN,
      allowAnonymous: false,
    },
    environment: {
      nodeEnv: (process.env.NODE_ENV as Config['environment']['nodeEnv']) || 'development',
      configPath: process.env.CONFIG_PATH,
      envFile: process.env.ENV_FILE,
    },
  };

  return config;
}

/**
 * Parse legacy MCP server configuration from environment variables
 */
function parseLegacyMCPServers(): Config['mcp']['servers'] {
  const servers: Config['mcp']['servers'] = [];

  // Simple approach: MCP_SERVER_URLS
  if (process.env.MCP_SERVER_URLS) {
    const urls = process.env.MCP_SERVER_URLS.split(',').map(u => u.trim()).filter(u => u.length > 0);
    urls.forEach((url, index) => {
      servers.push({
        id: `mcp-server-${index + 1}`,
        name: `MCP Server ${index + 1}`,
        transport: {
          type: 'http',
          url,
        },
        enabled: true,
      });
    });
  }

  // Advanced approach: MCP_SERVER_N_*
  for (let i = 1; i <= 10; i++) {
    const urlKey = `MCP_SERVER_${i}_URL`;
    const url = process.env[urlKey];
    if (!url) continue;

    const transportType = (process.env[`MCP_SERVER_${i}_TRANSPORT`]?.toLowerCase() || 'http') as 'http' | 'sse' | 'stdio';
    const name = process.env[`MCP_SERVER_${i}_NAME`] || `MCP Server ${i}`;

    let transport;
    if (transportType === 'stdio') {
      transport = {
        type: 'stdio' as const,
        command: url,
        args: process.env[`MCP_SERVER_${i}_ARGS`]?.split(' '),
      };
    } else if (transportType === 'sse') {
      transport = {
        type: 'sse' as const,
        url,
      };
    } else {
      transport = {
        type: 'http' as const,
        url,
      };
    }

    servers.push({
      id: `mcp-server-${i}`,
      name,
      transport,
      enabled: true,
    });
  }

  return servers;
}

/**
 * Custom error class for configuration errors
 */
export class ConfigError extends Error implements ConfigLoadError {
  public readonly code: ConfigLoadError['code'];
  public readonly path?: string;
  public readonly details?: unknown;

  constructor(code: ConfigLoadError['code'], message: string, options?: { path?: string; details?: unknown }) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    this.path = options?.path;
    this.details = options?.details;
  }
}