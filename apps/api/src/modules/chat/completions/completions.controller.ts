import { randomUUID } from 'node:crypto';

import { Body, Controller, Inject, InternalServerErrorException, Post, Res } from '@nestjs/common';
import type { AgentRunResult, ChatAgent, ChatCompletionInput, ReasoningDetail } from '@packages/agents';
import { ChatCompletionSchema, resolveLanguageModel } from '@packages/agents';
import type { FinishReason, LanguageModelUsage } from 'ai';
import { ZodValidationPipe } from 'nestjs-zod';

import { CHAT_AGENT_TOKEN } from '../chat.constants';

type OpenAIChoice = {
  index: number;
  message: {
    role: 'assistant';
    content: string;
    reasoning_details?: ReasoningDetail[];
  };
  finish_reason: string | null;
};

type OpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type OpenAIChatCompletion = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: [OpenAIChoice];
  usage?: OpenAIUsage;
  _debug?: Record<string, unknown>;
};

@Controller('v1/chat/completions')
export class CompletionsController {
  constructor(@Inject(CHAT_AGENT_TOKEN) private readonly agent: ChatAgent) {}

  @Post()
  async createCompletion(
    @Body(new ZodValidationPipe(ChatCompletionSchema)) payload: ChatCompletionInput,
    @Res({ passthrough: true }) res: unknown
  ): Promise<OpenAIChatCompletion | void> {
    const normalizedPayload = normalizeAgentSelection(payload);

    if (normalizedPayload.stream) {
      if (!isSseResponseLike(res)) {
        throw new InternalServerErrorException('HTTP adapter does not support streaming responses');
      }

      handleStreamingResponse(res, this.agent, normalizedPayload);
      return;
    }

    const result = await this.agent.run(normalizedPayload);
    return mapAgentResultToOpenAIResponse(result);
  }
}

function normalizeAgentSelection(input: ChatCompletionInput): ChatCompletionInput {
  if (input.model === 'plan-act') {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { model: _removed, ...rest } = input;
    return {
      ...rest,
      agent: 'plan-act'
    };
  }

  return input;
}

function mapAgentResultToOpenAIResponse(result: AgentRunResult): OpenAIChatCompletion {
  const finishReason = result.finishReason ?? 'stop';

  return {
    id: `chatcmpl_${result.id}`,
    object: 'chat.completion',
    created: result.created,
    model: result.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: result.text,
          // Include raw reasoning details if available
          ...(result.reasoningDetails && result.reasoningDetails.length > 0
            ? { reasoning_details: result.reasoningDetails }
            : {})
        },
        finish_reason: finishReason
      }
    ],
    usage: mapUsageToOpenAI(result.usage),
    _debug: { steps: result.steps }
  };
}

type StreamingContext = {
  id: string;
  model: string;
  created: number;
};

type ChatCompletionChunkEvent = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: [
    {
      index: 0;
      delta: Record<string, unknown>;
      finish_reason: FinishReason | 'error' | null;
    }
  ];
  usage?: OpenAIUsage;
};

interface SseResponseLike {
  setHeader: (name: string, value: string | number | readonly string[]) => unknown;
  write: (chunk: string) => unknown;
  end: () => unknown;
  writableEnded?: boolean;
}

function isSseResponseLike(value: unknown): value is SseResponseLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).setHeader === 'function' &&
    typeof (value as Record<string, unknown>).write === 'function' &&
    typeof (value as Record<string, unknown>).end === 'function'
  );
}

function handleStreamingResponse(res: SseResponseLike, agent: ChatAgent, payload: ChatCompletionInput): void {
  // Display the actual model id chosen by the current agent selection
  const model = (() => {
    const requested = payload.agent;
    if (requested === 'chat') {
      return payload.model ?? process.env.MODEL ?? 'gpt-4.1-mini';
    }
    // plan-act default
    try {
      return resolveLanguageModel(payload.model).id;
    } catch {
      // fallback to any provided id to avoid blocking SSE headers
      return payload.model ?? process.env.MODEL ?? 'gpt-4.1-mini';
    }
  })();
  const context: StreamingContext = {
    id: `chatcmpl_${randomUUID()}`,
    model,
    created: Math.floor(Date.now() / 1000)
  };

  setSseHeaders(res);

  const stream = agent.stream(payload);
  const finishReasonPromise: Promise<FinishReason | undefined> = stream.finishReason.catch(() => undefined);
  const usagePromise = getUsagePromise(stream);

  writeSseEvent(res, initialChunk(context));

  void (async () => {
    try {
      for await (const delta of stream.textStream) {
        if (delta.length === 0) {
          continue;
        }

        writeSseEvent(
          res,
          chunkEvent(context, {
            delta: { content: delta },
            finish_reason: null
          })
        );
      }

      const finishReason = (await finishReasonPromise) ?? 'stop';
      const usage = usagePromise ? await usagePromise : undefined;

      writeSseEvent(
        res,
        chunkEvent(
          context,
          {
            delta: {},
            finish_reason: finishReason
          },
          usage ? mapUsageToOpenAI(usage) : undefined
        )
      );
    } catch {
      writeSseEvent(
        res,
        chunkEvent(context, {
          delta: {},
          finish_reason: 'error'
        })
      );
    } finally {
      closeStream(res);
    }
  })().catch(() => {
    closeStream(res);
  });
}

function setSseHeaders(res: SseResponseLike): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function writeSseEvent(res: SseResponseLike, event: ChatCompletionChunkEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function initialChunk(context: StreamingContext): ChatCompletionChunkEvent {
  return chunkEvent(context, {
    delta: { role: 'assistant' },
    finish_reason: null
  });
}

function closeStream(res: SseResponseLike): void {
  if (res.writableEnded) {
    return;
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

function chunkEvent(
  context: StreamingContext,
  payload: {
    delta: Record<string, unknown>;
    finish_reason: FinishReason | 'error' | null;
  },
  usage?: OpenAIUsage
): ChatCompletionChunkEvent {
  const event: ChatCompletionChunkEvent = {
    id: context.id,
    object: 'chat.completion.chunk',
    created: context.created,
    model: context.model,
    choices: [
      {
        index: 0,
        delta: payload.delta,
        finish_reason: payload.finish_reason
      }
    ]
  };

  if (usage) {
    event.usage = usage;
  }

  return event;
}

function getUsagePromise(
  stream: ReturnType<ChatAgent['stream']>
): Promise<LanguageModelUsage | undefined> | undefined {
  const candidate = stream as {
    totalUsage?: Promise<LanguageModelUsage>;
    usage?: Promise<LanguageModelUsage>;
  };

  if (candidate.totalUsage && typeof candidate.totalUsage.then === 'function') {
    return candidate.totalUsage.catch(() => undefined);
  }

  if (candidate.usage && typeof candidate.usage.then === 'function') {
    return candidate.usage.catch(() => undefined);
  }

  return undefined;
}

function mapUsageToOpenAI(
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
): OpenAIUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    prompt_tokens: usage.inputTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0
  };
}
