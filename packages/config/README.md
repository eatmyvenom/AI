# @packages/config

Configuration management system for AI Agent applications.

## Overview

This package provides a comprehensive configuration system that replaces environment variables with structured configuration files. It supports:

- **Type-safe configuration** with Zod validation
- **Environment variable substitution** for secrets
- **Multiple file formats** (JavaScript, JSON, TypeScript)
- **Backward compatibility** with existing environment variables
- **CLI tools** for validation and migration
- **IDE support** with JSON schema

## Quick Start

1. **Copy the example configuration:**
   ```bash
   cp config.example.js config.js
   ```

2. **Edit the configuration file:**
   ```javascript
   module.exports = {
     api: {
       port: 3000,
       logLevel: 'info',
     },
     provider: {
       baseURL: 'https://api.openai.com/v1',
       apiKey: process.env.OPENAI_API_KEY,
       defaultModel: 'gpt-4.1-mini',
     },
     // ... other configuration
   };
   ```

3. **Validate your configuration:**
   ```bash
   npm run config:validate
   ```

## Configuration Format

### JavaScript Configuration (Recommended)

Create a `config.js` file in your project root:

```javascript
module.exports = {
  // API server configuration
  api: {
    port: 3000,
    logLevel: 'info', // 'debug', 'info', 'warn', 'error'
    cors: {
      origin: true, // or ['https://example.com']
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 86400,
    },
  },

  // Provider configuration
  provider: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.PROVIDER_API_KEY,
    defaultModel: 'gpt-4.1-mini',
    includeUsage: true,
  },

  // AI provider API keys
  aiProviders: {
    openai: {
      apiKey: process.env.AI_OPENAI_API_KEY,
    },
    anthropic: {
      apiKey: process.env.AI_ANTHROPIC_API_KEY,
    },
    // ... other providers
  },

  // MCP server configuration
  mcp: {
    enabled: true,
    servers: [
      {
        id: 'tavily-search',
        name: 'Tavily Web Search',
        transport: {
          type: 'http',
          url: 'https://mcp.tavily.com/mcp/',
          headers: {
            'Authorization': `Bearer ${process.env.TAVILY_API_KEY}`,
          },
        },
        enabled: true,
        enabledTools: ['web_search'],
      },
    ],
    global: {
      timeout: 60000,
      retry: {
        attempts: 2,
        backoff: 'exponential',
      },
    },
  },

  // Authentication
  auth: {
    enabled: true,
    bearerToken: process.env.API_BEARER_TOKEN,
    allowAnonymous: false,
  },
};
```

### JSON Configuration

Alternatively, use `config.json`:

```json
{
  "api": {
    "port": 3000,
    "logLevel": "info"
  },
  "provider": {
    "baseURL": "https://api.openai.com/v1",
    "apiKey": "${PROVIDER_API_KEY}",
    "defaultModel": "gpt-4.1-mini"
  }
}
```

## Environment Variable Substitution

Use `${VAR_NAME}` syntax to substitute environment variables:

```javascript
module.exports = {
  provider: {
    apiKey: process.env.PROVIDER_API_KEY,
    // or with default values
    baseURL: process.env.PROVIDER_BASE_URL || 'https://api.openai.com/v1',
  },
};
```

In JSON files, use the `${VAR_NAME}` syntax:
```json
{
  "provider": {
    "apiKey": "${PROVIDER_API_KEY}",
    "baseURL": "${PROVIDER_BASE_URL:https://api.openai.com/v1}"
  }
}
```

## CLI Tools

### Validate Configuration

```bash
# Validate default config file
npm run config:validate

# Validate specific file
npm run config:validate ./my-config.js
```

### Show Current Configuration

```bash
# Show merged configuration (file + env vars)
npm run config:show

# Show specific file
npm run config:show ./config.js
```

### Generate Configuration from Environment Variables

```bash
# Generate config.js from current environment variables
npm run config:migrate > config.js
```

### Generate JSON Schema

```bash
# Generate JSON schema for IDE support
npm run config:schema > config.schema.json
```

## Migration from Environment Variables

The system provides backward compatibility with existing environment variables. If no configuration file is found, it will automatically migrate from environment variables.

### Supported Environment Variables

- `PORT` → `api.port`
- `LOG_LEVEL` → `api.logLevel`
- `PROVIDER_BASE_URL` → `provider.baseURL`
- `PROVIDER_API_KEY` → `provider.apiKey`
- `MODEL` → `provider.defaultModel`
- `AI_*_API_KEY` → `aiProviders.*.apiKey`
- `MCP_SERVER_URLS` → `mcp.servers` (simple format)
- `MCP_SERVER_N_*` → `mcp.servers` (advanced format)
- `DISABLE_MCP_TOOLS` → `mcp.enabled`

### Migration Steps

1. **Generate initial configuration:**
   ```bash
   npm run config:migrate > config.js
   ```

2. **Review and customize the generated config.js**

3. **Test the configuration:**
   ```bash
   npm run config:validate
   ```

4. **Remove deprecated environment variables** (optional, for cleaner setup)

## Configuration Sections

### API Configuration

Controls the HTTP API server behavior.

```javascript
api: {
  port: 3000,                    // Server port
  logLevel: 'info',             // Logging level
  cors: {
    origin: true,               // CORS origins
    methods: ['GET', 'POST'],   // Allowed HTTP methods
    allowedHeaders: [...],      // Allowed headers
    maxAge: 86400,             // Preflight cache duration
  },
}
```

### Provider Configuration

Configures the default AI provider.

```javascript
provider: {
  baseURL: 'https://api.openai.com/v1',  // Provider API URL
  apiKey: process.env.API_KEY,           // API key
  defaultModel: 'gpt-4.1-mini',          // Default model
  includeUsage: true,                     // Include usage stats
}
```

### AI Providers

Configure multiple AI providers for multi-model support.

```javascript
aiProviders: {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  // ... other providers
}
```

### MCP Configuration

Configure Model Context Protocol servers for tool integration.

```javascript
mcp: {
  enabled: true,                 // Enable MCP tools
  servers: [
    {
      id: 'web-search',
      name: 'Web Search',
      transport: {
        type: 'http',
        url: 'https://mcp.example.com',
        headers: { 'Auth': 'Bearer ${API_KEY}' },
      },
      enabled: true,
      enabledTools: ['search'],  // Specific tools to enable
    },
  ],
  global: {
    timeout: 60000,             // Global timeout
    retry: {
      attempts: 2,
      backoff: 'exponential',
    },
  },
}
```

### Authentication

Configure API authentication.

```javascript
auth: {
  enabled: true,                 // Enable authentication
  bearerToken: process.env.TOKEN, // Bearer token
  jwtSecret: process.env.JWT_SECRET, // JWT secret
  allowAnonymous: false,         // Allow anonymous access
}
```

## TypeScript Support

The configuration system provides full TypeScript support with type inference:

```typescript
import { loadConfigWithMigration } from '@packages/config';

const config = loadConfigWithMigration();

// config.api.port is typed as number
// config.provider.apiKey is typed as string | undefined
// config.mcp.servers is typed as MCPServerConfig[]
```

## IDE Support

For the best development experience:

1. **Generate JSON schema:**
   ```bash
   npm run config:schema > config.schema.json
   ```

2. **Configure your IDE** to use the schema for autocomplete and validation

3. **Use TypeScript** for full type safety and IntelliSense

## Troubleshooting

### Configuration Not Loading

- Check that your config file is in the project root
- Ensure the file is named `config.js`, `config.json`, or `config.ts`
- Validate your configuration: `npm run config:validate`

### Environment Variables Not Substituting

- Use `process.env.VAR_NAME` in JavaScript files
- Use `${VAR_NAME}` in JSON files
- Check that environment variables are actually set

### TypeScript Errors

- Ensure you're importing types from `@packages/config`
- Check that your configuration matches the schema
- Run `npm run config:validate` to check for validation errors

## Examples

See `config.example.js` and `config.example.json` for comprehensive examples of all configuration options.