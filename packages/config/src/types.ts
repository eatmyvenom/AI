import { z } from 'zod';

// Re-export types from schema for convenience
export type {
  Config,
  MCPServerConfig,
  MCPTransportConfig,
  APIConfig,
  ProviderConfig,
  AIProvidersConfig,
  MCPConfig,
  AuthConfig,
  EnvironmentConfig,
} from './schema';

// Additional utility types
import type { Config } from './schema';

export type ConfigSection = keyof Config;

export type EnvironmentVariableSubstitution = string; // Format: ${VAR_NAME} or ${VAR_NAME:default_value}

export interface ConfigLoadError extends Error {
  code: 'CONFIG_LOAD_ERROR' | 'CONFIG_VALIDATION_ERROR' | 'CONFIG_FILE_NOT_FOUND';
  path?: string;
  details?: unknown;
}

export interface ConfigValidationResult {
  success: boolean;
  data?: Config;
  errors?: z.ZodError['issues'];
}