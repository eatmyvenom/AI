import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepInfra } from '@ai-sdk/deepinfra';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { loadConfigWithMigration } from '@packages/config';
import { createLogger } from '@packages/logger';
import { createProviderRegistry, NoSuchModelError, NoSuchProviderError, type LanguageModel } from 'ai';

const logger = createLogger('agents:models');

const PROVIDER_ENV_VARS = {
    anthropic: 'AI_ANTHROPIC_API_KEY',
    openai: 'AI_OPENAI_API_KEY',
    xai: 'AI_XAI_API_KEY',
    groq: 'AI_GROQ_API_KEY',
    deepinfra: 'AI_DEEPINFRA_API_KEY',
    google: 'AI_GOOGLE_API_KEY',
} as const;

const DEFAULT_PROVIDER_BASE_URLS = {
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com/v1',
    xai: 'https://api.x.ai',
    groq: 'https://api.groq.com/openai/v1',
    deepinfra: 'https://api.deepinfra.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
} as const;

const PROVIDER_DEFAULT_MODELS = {
    openai: 'gpt-5-mini',
    anthropic: 'claude-sonnet-4-5',
    google: 'gemini-2.5-flash',
    groq: 'openai/gpt-oss-120b',
    deepinfra: 'zai-org/GLM-4.6',
    xai: 'grok-4-fast-reasoning',
} as const;

type ProviderId = keyof typeof PROVIDER_ENV_VARS;

type ModelIdentifier = `anthropic:${string}` | `openai:${string}` | `xai:${string}` | `groq:${string}` | `deepinfra:${string}` | `google:${string}`;

interface ResolvedLanguageModel {
    id: string;
    model: LanguageModel;
}

/**
 * Get API key for a provider from configuration or environment variables
 */
function getProviderApiKey(providerId: ProviderId): string | undefined {
    try {
        const config = loadConfigWithMigration();
        return config.aiProviders[providerId]?.apiKey;
    } catch {
        // Fallback to environment variable
        return process.env[PROVIDER_ENV_VARS[providerId]];
    }
}

/**
 * Get base URL for a provider from configuration or default
 */
function getProviderBaseURL(providerId: ProviderId): string | undefined {
    try {
        const config = loadConfigWithMigration();
        return config.aiProviders[providerId]?.baseURL || DEFAULT_PROVIDER_BASE_URLS[providerId];
    } catch {
        // Return default URL
        return DEFAULT_PROVIDER_BASE_URLS[providerId];
    }
}

export const registry = createProviderRegistry({
    anthropic: createAnthropic({
        apiKey: getProviderApiKey('anthropic') || '',
        baseURL: getProviderBaseURL('anthropic')
    }),
    openai: createOpenAI({
        apiKey: getProviderApiKey('openai') || '',
        baseURL: getProviderBaseURL('openai')
    }),
    xai: createXai({
        apiKey: getProviderApiKey('xai') || '',
        baseURL: getProviderBaseURL('xai')
    }),
    groq: createGroq({
        apiKey: getProviderApiKey('groq') || '',
        baseURL: getProviderBaseURL('groq')
    }),
    deepinfra: createDeepInfra({
        apiKey: getProviderApiKey('deepinfra') || '',
        baseURL: getProviderBaseURL('deepinfra')
    }),
    google: createGoogleGenerativeAI({
        apiKey: getProviderApiKey('google') || '',
        baseURL: getProviderBaseURL('google')
    }),
});

export function resolveLanguageModel(model?: string | LanguageModel): ResolvedLanguageModel {
    logger.debug('resolveLanguageModel called', { model: typeof model === 'string' ? model : typeof model });

    if (model && typeof model !== 'string') {
        logger.debug('Using custom LanguageModel instance');
        return { id: '<custom>', model };
    }

    if (typeof model === 'string') {
        logger.debug('Normalizing model identifier', { model });
        const identifier = normalizeModelIdentifier(model);
        const providerId = getProviderId(identifier);
        logger.debug('Model identifier normalized', { identifier, providerId });

        ensureProviderIsConfigured(providerId);
        logger.debug('Provider configuration validated', { providerId });

        try {
            const languageModel = registry.languageModel(identifier as ModelIdentifier);
            logger.info('Language model resolved successfully', { identifier });
            return { id: identifier, model: languageModel };
        } catch (error) {
            logger.error('Failed to resolve language model from registry', { identifier, error });
            if (error instanceof NoSuchProviderError || error instanceof NoSuchModelError) {
                throw new Error(`Unknown model "${identifier}". Ensure the provider is registered and the model name is correct.`);
            }

            throw error;
        }
    }

    logger.debug('No model specified, resolving default language model');
    return resolveDefaultLanguageModel();
}

function resolveDefaultLanguageModel(): ResolvedLanguageModel {
    logger.debug('resolveDefaultLanguageModel called - searching for configured provider');
    const providerId = getFirstConfiguredProvider();
    logger.debug('First configured provider search result', { providerId: providerId ?? 'none' });

    if (!providerId) {
        logger.error('No configured providers found - all AI_* env vars are empty');
        throw new Error(
            'No default language model is configured. Provide a `<provider>:<model>` value or set an API key for one of the supported providers.'
        );
    }

    const modelId = PROVIDER_DEFAULT_MODELS[providerId];
    logger.debug('Using default model for provider', { providerId, modelId });

    if (!modelId) {
        logger.error('No default model mapping found for provider', { providerId });
        throw new Error(
            `No default model is defined for provider "${providerId}". Supply a PlanActAgent model explicitly.`
        );
    }

    const identifier = `${providerId}:${modelId}`;
    logger.info('Resolved default language model', { identifier, providerId, modelId });

    return { id: identifier, model: registry.languageModel(identifier as ModelIdentifier) };
}

function getFirstConfiguredProvider(): ProviderId | undefined {
    logger.debug('getFirstConfiguredProvider - checking all providers', { providers: Object.keys(PROVIDER_ENV_VARS) });

    for (const providerId of Object.keys(PROVIDER_ENV_VARS) as ProviderId[]) {
        const hasKey = hasApiKey(providerId);
        logger.debug(`Checking provider "${providerId}"`, { hasKey, envVar: PROVIDER_ENV_VARS[providerId] });
        if (hasKey) {
            logger.info(`Found configured provider: ${providerId}`);
            return providerId;
        }
    }

    logger.warn('No configured providers found');
    return undefined;
}

function hasApiKey(providerId: ProviderId) {
    const apiKey = getProviderApiKey(providerId);
    const hasKey = Boolean(apiKey);
    logger.debug(`hasApiKey check for ${providerId}`, { hasKey });
    return hasKey;
}

function ensureProviderIsConfigured(providerId: string) {
    logger.debug('ensureProviderIsConfigured called', { providerId, isKnown: isKnownProvider(providerId) });

    if (!isKnownProvider(providerId)) {
        logger.warn(`Provider "${providerId}" is not in the known providers list - skipping validation`);
        return;
    }

    const apiKey = getProviderApiKey(providerId);

    if (!apiKey) {
        logger.error(`Provider "${providerId}" is not configured`, { isSet: false });
        throw new Error(
            `Provider "${providerId}" is not configured. Set the API key in configuration file or environment variable ${PROVIDER_ENV_VARS[providerId]}.`
        );
    }

    logger.debug(`Provider "${providerId}" is properly configured`);
}

function normalizeModelIdentifier(model: string) {
    logger.debug('normalizeModelIdentifier called', { model, hasColon: model.includes(':') });

    if (model.includes(':')) {
        logger.debug('Model already has provider prefix', { model });
        return model;
    }

    logger.debug('Model missing provider prefix, finding default provider');
    const providerId = getFirstConfiguredProvider();

    if (!providerId) {
        logger.error('Cannot normalize model - no configured provider found', { model });
        throw new Error(
            `The model "${model}" is missing a provider prefix. Supply it in the form "<provider>:<model>" or configure a provider API key.`
        );
    }

    const normalized = `${providerId}:${model}`;
    logger.info('Normalized model identifier', { original: model, normalized, providerId });
    return normalized;
}

function getProviderId(identifier: string) {
    return identifier.split(':', 1)[0];
}

function isKnownProvider(providerId: string): providerId is ProviderId {
    return Object.prototype.hasOwnProperty.call(PROVIDER_ENV_VARS, providerId);
}
