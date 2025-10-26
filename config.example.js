/* eslint-disable no-undef */
/**
 * AI Agent Configuration Example
 *
 * This file demonstrates all available configuration options for the AI agent system.
 * Copy this file to config.js and modify the values according to your needs.
 *
 * Environment variable substitution is supported using ${VAR_NAME} syntax:
 * - ${VAR_NAME} - Use environment variable or leave placeholder if not set
 * - ${VAR_NAME:default_value} - Use environment variable or fallback to default
 */

module.exports = {
  // API Configuration
  api: {
    // Port for the API server
    port: 3000,

    // Logging level: 'debug', 'info', 'warn', 'error'
    logLevel: 'info',

    // CORS configuration
    cors: {
      // Origins to allow (true for all, array for specific origins)
      origin: true,

      // HTTP methods to allow
      methods: ['GET', 'POST', 'OPTIONS'],

      // Headers to allow
      allowedHeaders: ['Authorization', 'Content-Type'],

      // Cache duration for preflight requests (seconds)
      maxAge: 86400, // 24 hours
    },
  },

  // Provider Configuration (OpenAI-compatible API)
  provider: {
    // Base URL for the provider API
    baseURL: 'https://api.openai.com/v1',

    // API key for the provider (can use env var substitution)
    apiKey: process.env.PROVIDER_API_KEY,

    // Default model to use when none specified
    defaultModel: 'gpt-4.1-mini',

    // Whether to include usage information in responses
    includeUsage: true,
  },

  // AI Provider API Keys (for multi-provider support)
  aiProviders: {
    // OpenAI configuration
    openai: {
      apiKey: process.env.AI_OPENAI_API_KEY,
      // baseURL: 'https://api.openai.com/v1', // Optional custom base URL
    },

    // Anthropic configuration
    anthropic: {
      apiKey: process.env.AI_ANTHROPIC_API_KEY,
      // baseURL: 'https://api.anthropic.com', // Optional custom base URL
    },

    // X.ai (Grok) configuration
    xai: {
      apiKey: process.env.AI_XAI_API_KEY,
      // baseURL: 'https://api.x.ai', // Optional custom base URL
    },

    // Groq configuration
    groq: {
      apiKey: process.env.AI_GROQ_API_KEY,
      // baseURL: 'https://api.groq.com/openai/v1', // Optional custom base URL
    },

    // DeepInfra configuration
    deepinfra: {
      apiKey: process.env.AI_DEEPINFRA_API_KEY,
      // baseURL: 'https://api.deepinfra.com/v1', // Optional custom base URL
    },

    // Google configuration
    google: {
      apiKey: process.env.AI_GOOGLE_API_KEY,
      // baseURL: 'https://generativelanguage.googleapis.com/v1beta', // Optional custom base URL
    },
  },

  // MCP (Model Context Protocol) Configuration
  mcp: {
    // Whether MCP tools are enabled globally
    enabled: true,

    // MCP server configurations
    servers: [
      // Example: Tavily web search
      {
        id: 'tavily-search',
        name: 'Tavily Web Search',
        transport: {
          type: 'http',
          url: 'https://mcp.tavily.com/mcp/',
          headers: {
            // Use environment variable substitution for API keys
            'Authorization': `Bearer ${process.env.TAVILY_API_KEY}`,
          },
          // Request timeout in milliseconds
          timeout: 30000,
        },
        enabled: true,
        // Specific tools to enable (empty array = all tools)
        enabledTools: ['web_search', 'web_extract'],
        // Retry configuration for this server
        retry: {
          attempts: 3,
          backoff: 'exponential', // 'linear' or 'exponential'
        },
      },

      // Example: Local filesystem access
      {
        id: 'local-filesystem',
        name: 'Local File System',
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
          // Environment variables for the stdio process
          env: {
            'HOME': process.env.HOME,
          },
        },
        enabled: true,
        retry: {
          attempts: 2,
          backoff: 'linear',
        },
      },

      // Example: SSE-based MCP server
      {
        id: 'sse-example',
        name: 'SSE MCP Server',
        transport: {
          type: 'sse',
          url: 'https://example.com/mcp/sse',
        },
        enabled: false, // Disabled by default
      },
    ],

    // Global MCP settings
    global: {
      // Default timeout for all MCP requests
      timeout: 60000,

      // Global retry configuration
      retry: {
        attempts: 2,
        backoff: 'exponential',
      },
    },
  },

  // Authentication Configuration
  auth: {
    // Whether authentication is enabled
    enabled: true,

    // Bearer token for API authentication
    bearerToken: process.env.API_BEARER_TOKEN,

    // JWT secret for token generation (if using JWT)
    jwtSecret: process.env.JWT_SECRET,

    // Allow anonymous access (for development)
    allowAnonymous: false,
  },

  // Environment/Development Configuration
  environment: {
    // Node environment
    nodeEnv: process.env.NODE_ENV || 'development',

    // Custom config file path (if not using default)
    configPath: process.env.CONFIG_PATH,

    // Environment file to load (if not using .env)
    envFile: process.env.ENV_FILE || '.env',
  },
};