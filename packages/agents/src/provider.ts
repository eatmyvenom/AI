import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { loadConfigWithMigration } from '@packages/config';

import { ensureEnv } from './env';

ensureEnv();

export interface ProviderConfig {
  baseURL?: string;
  apiKey?: string;
  name?: string;
  includeUsage?: boolean;
}

export function createProvider(config: ProviderConfig = {}) {
  try {
    // Try to load from configuration file first
    const appConfig = loadConfigWithMigration();

    const baseURL = config.baseURL ?? appConfig.provider.baseURL;
    const apiKey = config.apiKey ?? appConfig.provider.apiKey;
    const name = config.name ?? 'openai-compatible';
    const includeUsage = config.includeUsage ?? appConfig.provider.includeUsage;

    return createOpenAICompatible({
      baseURL,
      apiKey,
      name,
      includeUsage
    });
  } catch (error) {
    // Fallback to legacy environment variables
    console.warn('[Provider] Failed to load configuration file, falling back to environment variables:', error);

    const baseURL = config.baseURL ?? process.env.PROVIDER_BASE_URL ?? 'https://api.openai.com/v1';
    const apiKey = config.apiKey ?? process.env.PROVIDER_API_KEY;
    const name = config.name ?? 'openai-compatible';

    return createOpenAICompatible({
      baseURL,
      apiKey,
      name,
      includeUsage: config.includeUsage ?? true
    });
  }
}

export function resolveModel(requestedModel?: string) {
  try {
    // Try to load from configuration file first
    const appConfig = loadConfigWithMigration();
    return requestedModel ?? appConfig.provider.defaultModel;
  } catch (error) {
    // Fallback to legacy environment variable
    console.warn('[Provider] Failed to load configuration file, falling back to environment variables:', error);
    return requestedModel ?? process.env.MODEL ?? 'gpt-4.1-mini';
  }
}
