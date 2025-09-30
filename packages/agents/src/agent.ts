import { randomUUID } from 'node:crypto';

import { getActiveTools } from '@packages/tools';
import { streamText, type ToolSet, type StepResult, type LanguageModelUsage, type ModelMessage } from 'ai';
import { z } from 'zod';

import { createProvider, resolveModel, type ProviderConfig } from './provider';

const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string().min(1, 'Message content cannot be empty')
});

export const ChatCompletionSchema = z.object({
  model: z.string().optional(),
  messages: z.array(MessageSchema).min(1, 'At least one message must be supplied'),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional()
});

export type ChatCompletionInput = z.input<typeof ChatCompletionSchema>;

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentRunResult {
  id: string;
  created: number;
  model: string;
  text: string;
  finishReason?: string;
  usage?: AgentUsage;
  steps: Array<StepResult<ToolSet>>;
}

export interface AgentConfig {
  provider?: ReturnType<typeof createProvider>;
  providerConfig?: ProviderConfig;
  tools?: ToolSet;
  defaultModel?: string;
}

export interface ChatAgent {
  run(input: ChatCompletionInput): Promise<AgentRunResult>;
  stream(input: ChatCompletionInput): ReturnType<typeof streamText>;
}

export function createChatAgent(config: AgentConfig = {}): ChatAgent {
  const provider = config.provider ?? createProvider(config.providerConfig);
  const tools = config.tools ?? getActiveTools();
  const defaultModel = config.defaultModel;

  return {
    async run(rawInput) {
      const parsed = ChatCompletionSchema.parse(rawInput);
      const modelId = resolveModel(parsed.model ?? defaultModel);

      const result = streamText({
        model: provider.chatModel(modelId),
        messages: parsed.messages as Array<ModelMessage>,
        temperature: parsed.temperature,
        tools: Object.keys(tools ?? {}).length > 0 ? tools : undefined
      });

      const [text, finishReason, usage, totalUsage, steps] = await Promise.all([
        result.text.catch(() => ''),
        result.finishReason.catch(() => undefined),
        result.usage.catch(() => undefined),
        result.totalUsage.catch(() => undefined),
        result.steps.catch(() => [])
      ]);

      return {
        id: randomUUID(),
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        text,
        finishReason,
        usage: coerceUsage(totalUsage ?? usage),
        steps
      };
    },

    stream(rawInput) {
      const parsed = ChatCompletionSchema.parse(rawInput);
      const modelId = resolveModel(parsed.model ?? defaultModel);

      return streamText({
        model: provider.chatModel(modelId),
        messages: parsed.messages as Array<ModelMessage>,
        temperature: parsed.temperature,
        tools: Object.keys(tools ?? {}).length > 0 ? tools : undefined
      });
    }
  };
}

function coerceUsage(usage?: LanguageModelUsage): AgentUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens
  };
}
