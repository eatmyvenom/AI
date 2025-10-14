import { randomUUID } from 'node:crypto';

import { createLogger } from '@packages/logger';
import { getActiveTools } from '@packages/tools';
import type { ModelMessage, FinishReason, ToolSet, StreamTextResult } from 'ai';
import type { z } from 'zod';

import type { ChatAgent, ChatCompletionInput, AgentRunResult, ReasoningDetail } from '../agent';
import { PlanActAgent, PlanSchema, actStepSchema } from '../agents';

const logger = createLogger('agents:plan-act-adapter');

function formatReasoningDetails(
  plan: z.infer<typeof PlanSchema>,
  actions: z.infer<typeof actStepSchema>[]
): ReasoningDetail[] {
  const details: ReasoningDetail[] = [];
  let index = 0;

  // Add each plan step (raw model output)
  if (plan.steps?.length > 0) {
    plan.steps.forEach((step) => {
      details.push({
        type: 'plan.step',
        id: `plan-step-${index}`,
        format: 'anthropic-claude-v1',
        index: index++,
        signature: null,
        // Raw model outputs - no processing!
        title: step.title,
        instructions: step.instructions,
        relevantContext: step.relevantContext
      });
    });
  }

  // Add each action (raw model output)
  actions.forEach((action) => {
    details.push({
      type: 'action.observation',
      id: `action-${index}`,
      format: 'anthropic-claude-v1',
      index: index++,
      signature: null,
      // Raw model outputs - no processing!
      action: action.action,
      observation: action.observation,
      ...(action.addPlanStepsReason ? { addPlanStepsReason: action.addPlanStepsReason } : {})
    });
  });

  return details;
}

type PlanActAdapterConfig = {
  instructions?: string;
  plan?: { steps?: number; tools?: ToolSet };
  act?: { steps?: number; tools?: ToolSet };
};

export function createPlanActChatAdapter(config: PlanActAdapterConfig = {}): ChatAgent {
  return {
    async run(input: ChatCompletionInput): Promise<AgentRunResult> {
      logger.info('PlanActAdapter.run called', { model: input.model, messageCount: input.messages.length });

      const model = input.model; // allow provider-prefixed ids e.g. "openai:gpt-4o-mini"

      try {
        logger.debug('Creating PlanActAgent instance', { model, hasInstructions: Boolean(config.instructions) });
        const agent = new PlanActAgent({
          model,
          instructions: config.instructions,
          plan: { steps: config.plan?.steps, tools: config.plan?.tools ?? getActiveTools() },
          act: { steps: config.act?.steps, tools: config.act?.tools ?? getActiveTools() }
        });
        logger.info('PlanActAgent created successfully', { modelId: agent.modelId });

        const messages = input.messages as Array<ModelMessage>;

        // Phase 1: plan
        logger.debug('Starting Plan phase');
        const planStream = agent.runPlanPhase(messages);
        let latestValidPlan: z.infer<typeof PlanSchema> | undefined;

        const planPartial = (async () => {
          for await (const partial of planStream.experimental_partialOutputStream as AsyncIterable<unknown>) {
            if (partial && typeof partial === 'object' && 'steps' in partial) {
              latestValidPlan = partial as z.infer<typeof PlanSchema>;
              logger.debug('Plan partial received', { hasSteps: 'steps' in partial });
            }
          }
        })();

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of planStream.fullStream) {
          // drain
        }
        await planPartial;

        // If the plan shape isn't valid, initialize empty plan
        const plan = latestValidPlan ?? { steps: [] };

        logger.info('Plan phase completed', { stepCount: plan.steps?.length ?? 0 });

        // Phase 2: act — drain while collecting actions
        logger.debug('Starting Act phase');
        const actStream = agent.runActPhase(messages, plan);
        let chunkCount = 0;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _chunk of actStream) {
            chunkCount++;
            if (chunkCount % 10 === 0) {
              logger.debug(`Act phase streaming - received ${chunkCount} chunks`);
            }
          }
          logger.debug(`Act phase stream completed - total chunks: ${chunkCount}`);
        } catch (error) {
          logger.error('Act phase stream error', error instanceof Error ? error : { error, chunkCount });
          throw error;
        }
        const actions = (actStream as { collectedActions?: z.infer<typeof actStepSchema>[] }).collectedActions ?? [];
        logger.info('Act phase completed', { actionCount: actions.length, totalChunks: chunkCount });

        // Phase 3: final response — collect text and finishReason
        logger.debug('Starting Response phase');
        const responseStream = agent.runResponsePhase(messages, plan, actions);
        const [text, finishReason] = await Promise.all([
          responseStream.text.catch((err: unknown) => { logger.error('Error getting response text', err instanceof Error ? err : { error: err }); return ''; }),
          responseStream.finishReason.catch((err: unknown) => { logger.error('Error getting finish reason', err instanceof Error ? err : { error: err }); return undefined as FinishReason | undefined; }),
        ]);
        logger.info('Response phase completed', { textLength: text.length, finishReason });

        // Format reasoning details from raw model outputs
        const reasoningDetails = formatReasoningDetails(plan, actions);
        logger.debug('Formatted reasoning details', { count: reasoningDetails.length });

        const result = {
          id: randomUUID(),
          created: Math.floor(Date.now() / 1000),
          model: agent.modelId,
          text,
          finishReason,
          usage: undefined,
          steps: [],
          reasoningDetails
        };
        logger.info('PlanActAdapter.run completed successfully', { resultId: result.id, textLength: text.length, reasoningCount: reasoningDetails.length });
        return result;
      } catch (error) {
        logger.error('PlanActAdapter.run failed', error instanceof Error ? error : { error });
        throw error;
      }
    },

    // Streaming interface compatible enough for CompletionsController
    stream(input: ChatCompletionInput) {
      const model = input.model;
      const agent = new PlanActAgent({
        model,
        instructions: config.instructions,
        plan: { steps: config.plan?.steps, tools: config.plan?.tools ?? getActiveTools() },
        act: { steps: config.act?.steps, tools: config.act?.tools ?? getActiveTools() }
      });

      const messages = input.messages as Array<ModelMessage>;

      let finishReasonResolve: (r: FinishReason | undefined) => void;
      const finishReason = new Promise<FinishReason | undefined>((resolve) => {
        finishReasonResolve = resolve;
      });

      async function* textStream() {
        // Plan
        const planStream = agent.runPlanPhase(messages);
        let latestValidPlan: z.infer<typeof PlanSchema> | undefined;
        const planPartial = (async () => {
          for await (const partial of planStream.experimental_partialOutputStream as AsyncIterable<unknown>) {
            if (partial && typeof partial === 'object' && 'steps' in partial) {
              latestValidPlan = partial as z.infer<typeof PlanSchema>;
            }
          }
        })();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty
        for await (const _ of planStream.fullStream) {}
        await planPartial;
        const plan = latestValidPlan ?? { steps: [] };

        // Act
        const actStream = agent.runActPhase(messages, plan);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty
        for await (const _chunk of actStream) {}
        const actions = (actStream as { collectedActions?: z.infer<typeof actStepSchema>[] }).collectedActions ?? [];

        // Final response: stream only the user-visible text deltas
        const responseStream = agent.runResponsePhase(messages, plan, actions);
        const fr = responseStream.finishReason.catch(() => undefined as FinishReason | undefined).then((r) => {
          finishReasonResolve(r);
        });
        try {
          for await (const delta of responseStream.textStream) {
            if (delta && delta.length > 0) {
              yield delta;
            }
          }
        } finally {
          await fr;
        }
      }

      return {
        // Only fields used by the API controller are required here
        textStream: textStream(),
        finishReason,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any as StreamTextResult<ToolSet, unknown>;
    }
  };
}

