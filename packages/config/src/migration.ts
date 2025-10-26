import type { Config } from './schema';

/**
 * Migration utilities for transitioning from environment variables to configuration files
 */

// Environment variables that should show deprecation warnings
const DEPRECATED_ENV_VARS = new Set([
  'PORT',
  'LOG_LEVEL',
  'PROVIDER_BASE_URL',
  'PROVIDER_API_KEY',
  'MODEL',
  'AI_OPENAI_API_KEY',
  'AI_ANTHROPIC_API_KEY',
  'AI_XAI_API_KEY',
  'AI_GROQ_API_KEY',
  'AI_DEEPINFRA_API_KEY',
  'AI_GOOGLE_API_KEY',
  'MCP_SERVER_URLS',
  'DISABLE_MCP_TOOLS',
]);

// Pattern for MCP_SERVER_N_* variables
const MCP_SERVER_PATTERN = /^MCP_SERVER_\d+_(URL|TRANSPORT|NAME|ARGS)$/;

/**
 * Check if any deprecated environment variables are being used
 */
export function checkDeprecatedEnvVars(): string[] {
  const deprecated: string[] = [];

  for (const envVar of Object.keys(process.env)) {
    if (DEPRECATED_ENV_VARS.has(envVar) || MCP_SERVER_PATTERN.test(envVar)) {
      deprecated.push(envVar);
    }
  }

  return deprecated;
}

/**
 * Show deprecation warnings for environment variables
 */
export function showDeprecationWarnings(deprecatedVars: string[]): void {
  if (deprecatedVars.length === 0) {
    return;
  }

  console.warn('\n⚠️  DEPRECATION WARNING: Environment variables detected');
  console.warn('The following environment variables are deprecated and will be removed in a future version:');
  console.warn('');

  for (const envVar of deprecatedVars) {
    console.warn(`  - ${envVar}`);
  }

  console.warn('');
  console.warn('Please migrate to using a configuration file (config.js or config.json).');
  console.warn('See config.example.js for the recommended configuration format.');
  console.warn('');
}

/**
 * Generate a configuration file from current environment variables
 */
export function generateConfigFromEnvVars(): string {
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

  return `module.exports = ${JSON.stringify(config, null, 2)};`;
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