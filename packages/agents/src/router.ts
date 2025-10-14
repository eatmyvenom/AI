import { createPlanActChatAdapter } from './adapters/plan-act.adapter';
import type { ChatAgent, ChatCompletionInput, AgentRunResult, AgentConfig } from './agent';
import { createChatAgent } from './agent';

export type AgentKind = 'plan-act' | 'chat';

export interface CompletionAgentConfig {
  defaultAgent?: AgentKind;
  chat?: AgentConfig;
  planAct?: Parameters<typeof createPlanActChatAdapter>[0];
}

export function createCompletionAgent(config: CompletionAgentConfig = {}): ChatAgent {
  const defaultAgent: AgentKind = config.defaultAgent ?? 'plan-act';
  const chatAgent = createChatAgent(config.chat);
  const planActAgent = createPlanActChatAdapter(config.planAct);

  function selectAgent(input: ChatCompletionInput): ChatAgent {
    const requested = input.agent;
    const kind = requested ?? defaultAgent;
    return kind === 'chat' ? chatAgent : planActAgent;
  }

  return {
    run(input: ChatCompletionInput): Promise<AgentRunResult> {
      return selectAgent(input).run(input);
    },
    stream(input: ChatCompletionInput) {
      return selectAgent(input).stream(input);
    }
  };
}
