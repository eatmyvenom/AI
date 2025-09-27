import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export interface ProviderConfig {
  baseURL?: string;
  apiKey?: string;
  name?: string;
  includeUsage?: boolean;
}

export function createProvider(config: ProviderConfig = {}) {
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

export function resolveModel(requestedModel?: string) {
  return requestedModel ?? process.env.MODEL ?? 'gpt-4.1-mini';
}
