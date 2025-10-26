import { z } from 'zod';

// MCP Transport Types
const StdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const SSETransportSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
});

const HTTPTransportSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().positive().optional(),
});

const MCPTransportSchema = z.union([
  StdioTransportSchema,
  SSETransportSchema,
  HTTPTransportSchema,
]);

const MCPServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: MCPTransportSchema,
  enabled: z.boolean().default(true),
  enabledTools: z.array(z.string()).optional(),
  retry: z.object({
    attempts: z.number().int().positive().default(3),
    backoff: z.enum(['linear', 'exponential']).default('exponential'),
  }).optional(),
});

const CorsSchema = z.object({
  origin: z.union([z.boolean(), z.array(z.string())]),
  methods: z.array(z.string()),
  allowedHeaders: z.array(z.string()),
  maxAge: z.number().int().positive(),
});

const ApiSchema = z.object({
  port: z.number().int().positive(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  cors: CorsSchema,
});

const ProviderSchema = z.object({
  baseURL: z.string().url(),
  apiKey: z.string().optional(),
  defaultModel: z.string(),
  includeUsage: z.boolean(),
});

const AIProvidersSchema = z.object({
  openai: z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().url().optional(),
  }),
  anthropic: z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().url().optional(),
  }),
  xai: z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().url().optional(),
  }),
  groq: z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().url().optional(),
  }),
  deepinfra: z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().url().optional(),
  }),
  google: z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().url().optional(),
  }),
});

const MCPGlobalSchema = z.object({
  timeout: z.number().positive(),
  retry: z.object({
    attempts: z.number().int().positive(),
    backoff: z.enum(['linear', 'exponential']),
  }),
});

const MCPSchema = z.object({
  enabled: z.boolean(),
  servers: z.array(MCPServerSchema),
  global: MCPGlobalSchema,
});

const AuthSchema = z.object({
  enabled: z.boolean(),
  bearerToken: z.string().optional(),
  jwtSecret: z.string().optional(),
  allowAnonymous: z.boolean(),
});

const EnvironmentSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']),
  configPath: z.string().optional(),
  envFile: z.string().optional(),
});

export const ConfigSchema = z.object({
  api: ApiSchema,
  provider: ProviderSchema,
  aiProviders: AIProvidersSchema,
  mcp: MCPSchema,
  auth: AuthSchema,
  environment: EnvironmentSchema,
});

// Export types
export type Config = z.infer<typeof ConfigSchema>;
export type MCPServerConfig = z.infer<typeof MCPServerSchema>;
export type MCPTransportConfig = z.infer<typeof MCPTransportSchema>;
export type APIConfig = z.infer<typeof ApiSchema>;
export type ProviderConfig = z.infer<typeof ProviderSchema>;
export type AIProvidersConfig = z.infer<typeof AIProvidersSchema>;
export type MCPConfig = z.infer<typeof MCPSchema>;
export type AuthConfig = z.infer<typeof AuthSchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentSchema>;