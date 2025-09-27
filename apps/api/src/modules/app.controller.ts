import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { AgentRunResult, ChatAgent, ChatCompletionInput } from '@packages/agents';
import { ChatCompletionSchema } from '@packages/agents';
import { ZodValidationPipe } from 'nestjs-zod';

import { CHAT_AGENT_TOKEN } from './app.module';

type OpenAIChoice = {
  index: number;
  message: {
    role: 'assistant';
    content: string;
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

@Controller()
export class AppController {
  constructor(@Inject(CHAT_AGENT_TOKEN) private readonly agent: ChatAgent) {}

  @Post('v1/chat/completions')
  async createCompletion(
    @Body(new ZodValidationPipe(ChatCompletionSchema))
    payload: ChatCompletionInput
  ): Promise<OpenAIChatCompletion> {
    const result = await this.agent.run(payload);
    return mapAgentResultToOpenAIResponse(result);
  }
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
          content: result.text
        },
        finish_reason: finishReason
      }
    ],
    usage: result.usage
      ? {
          prompt_tokens: result.usage.inputTokens ?? 0,
          completion_tokens: result.usage.outputTokens ?? 0,
          total_tokens: result.usage.totalTokens ?? 0
        }
      : undefined,
    _debug: { steps: result.steps }
  };
}
