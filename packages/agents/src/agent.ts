import { randomUUID } from 'node:crypto';

import { getActiveTools } from '@packages/tools';
import { streamText, type ToolSet, type StepResult, type LanguageModelUsage, type ModelMessage } from 'ai';
import { z } from 'zod';

import { createProvider, resolveModel, type ProviderConfig } from './provider';
import { extractToolCallsFromSteps } from './tools/converter';

const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

// Tool call schema (for assistant messages)
const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string() // JSON string
  })
});

// Base message schema
const BaseMessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string().nullable().optional()
});

// Extended message schema that handles tool_calls and tool_call_id
const MessageSchema = z.union([
  // Regular message
  BaseMessageSchema.extend({
    role: z.enum(['system', 'user']),
    content: z.string().min(1, 'Message content cannot be empty')
  }),
  // Assistant message (may have tool_calls)
  BaseMessageSchema.extend({
    role: z.literal('assistant'),
    content: z.string().nullable().optional(),
    tool_calls: z.array(ToolCallSchema).optional()
  }),
  // Tool result message
  BaseMessageSchema.extend({
    role: z.literal('tool'),
    content: z.string(),
    tool_call_id: z.string()
  })
]);

// OpenAI tool schema
const OpenAIFunctionParametersSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional()
});

const OpenAIFunctionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: OpenAIFunctionParametersSchema,
  strict: z.boolean().optional()
});

const OpenAIToolSchema = z.object({
  type: z.literal('function'),
  function: OpenAIFunctionSchema
});

// Tool choice schema
const OpenAIToolChoiceSchema = z.union([
  z.literal('auto'),
  z.literal('none'),
  z.literal('required'),
  z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string()
    })
  })
]);

export const ChatCompletionSchema = z.object({
  model: z.string().optional(),
  messages: z.array(MessageSchema).min(1, 'At least one message must be supplied'),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
  reasoning_effort: z.string().optional(),
  // Tool calling parameters
  tools: z.array(OpenAIToolSchema).optional(),
  tool_choice: OpenAIToolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
  // Built-in tool configuration
  enabled_builtin_tools: z.array(z.string()).optional(),
  // Optional agent selector; defaults handled by API wiring
  agent: z.enum(['plan-act', 'chat']).optional()
});

export type ChatCompletionInput = z.input<typeof ChatCompletionSchema>;

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ReasoningDetail {
  type: 'plan.step' | 'action.observation';
  id: string;
  format: 'anthropic-claude-v1';
  index: number;
  signature: null;
  // Plan step fields (raw from model)
  title?: string;
  instructions?: string;
  relevantContext?: string;
  // Action fields (raw from model)
  action?: string;
  observation?: string;
  addPlanStepsReason?: string;
}

export interface AgentRunResult {
  id: string;
  created: number;
  model: string;
  text: string;
  finishReason?: string;
  usage?: AgentUsage;
  steps: Array<StepResult<ToolSet>>;
  reasoningDetails?: ReasoningDetail[];
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
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

      // Extract tool calls from steps
      const toolCalls = extractToolCallsFromSteps(steps);

      return {
        id: randomUUID(),
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        text,
        finishReason,
        usage: coerceUsage(totalUsage ?? usage),
        steps,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
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
