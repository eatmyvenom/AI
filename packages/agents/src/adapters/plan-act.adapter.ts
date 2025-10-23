import { randomUUID } from 'node:crypto';

import { createLogger } from '@packages/logger';
import type { ModelMessage, FinishReason, ToolSet, StreamTextResult, LanguageModelUsage, StepResult } from 'ai';
import type { z } from 'zod';

import type { ChatAgent, ChatCompletionInput, AgentRunResult, ReasoningDetail } from '../agent';
import { PlanActAgent, PlanSchema, actStepSchema } from '../agents';
import { mergeTools, extractToolCallsFromSteps } from '../tools';
import type { OpenAITool, OpenAIToolChoice } from '../tools/types';

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

function formatThinkingBlock(
  plan: z.infer<typeof PlanSchema>,
  actions: z.infer<typeof actStepSchema>[]
): string {
  const planLines =
    plan.steps && plan.steps.length > 0
      ? plan.steps.map((step, index) => {
          const segments = [
            `${index + 1}. ${step.title}`,
            `   Instructions: ${step.instructions}`,
            `   Context: ${step.relevantContext}`
          ];
          return segments.join('\n');
        })
      : ['(no plan steps)'];

  const actionLines =
    actions.length > 0
      ? actions.map((action, index) => {
          const segments = [
            `${index + 1}. Action: ${action.action}`,
            `   Observation: ${action.observation}`
          ];
          if (action.addPlanStepsReason) {
            segments.push(`   Plan Adjustment: ${action.addPlanStepsReason}`);
          }
          return segments.join('\n');
        })
      : ['(no actions recorded)'];

  return [
    '<think>',
    'Plan:',
    planLines.join('\n'),
    '',
    'Actions:',
    actionLines.join('\n'),
    '\n</think>'
  ].join('\n');
}

type PlanActAdapterConfig = {
  model?: string;
  instructions?: string;
  plan?: { steps?: number; tools?: ToolSet };
  act?: { steps?: number; tools?: ToolSet };
};

export function createPlanActChatAdapter(config: PlanActAdapterConfig = {}): ChatAgent {
  const adapter: ChatAgent = {
    async run(input: ChatCompletionInput): Promise<AgentRunResult> {
      logger.info('PlanActAdapter.run called', { model: input.model, messageCount: input.messages.length });

      const model = input.model || config.model; // allow provider-prefixed ids e.g. "openai:gpt-4o-mini"

      try {
        logger.debug('Creating PlanActAgent instance', { model, hasInstructions: Boolean(config.instructions) });

        // Merge client-provided tools with built-in tools
        const mergedTools = mergeTools({
          clientTools: (input.tools as OpenAITool[] | undefined) ?? [],
          enabledBuiltinTools: input.enabled_builtin_tools,
          toolChoice: input.tool_choice as OpenAIToolChoice | undefined,
          parallelToolCalls: input.parallel_tool_calls,
        });

        logger.info('Tools merged for plan-act agent', {
          totalTools: Object.keys(mergedTools.toolSet).length,
          clientTools: mergedTools.clientToolNames.length,
          builtinTools: mergedTools.builtinToolNames.length,
        });

        const agent = new PlanActAgent({
          model,
          instructions: config.instructions,
          // Plan phase gets empty tools to avoid structured output conflict
          plan: { steps: config.plan?.steps },
          // Act phase gets all the tools
          act: {
            steps: config.act?.steps,
            tools: mergedTools.toolSet,
            mergedTools: mergedTools
          }
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

        // Check if plan generation failed (empty plan may indicate model issues)
        if ((plan.steps?.length ?? 0) === 0) {
          logger.warn('Plan phase produced no steps', {
            toolCountInActPhase: Object.keys(mergedTools.toolSet).length,
            model: input.model,
            message: 'Empty plan may indicate model issues - proceeding with act phase anyway'
          });
          // Don't throw error - let act phase handle empty plan gracefully
        }

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

        // Phase 3: final response — collect text, finishReason, and steps
        logger.debug('Starting Response phase');
        const responseStream = agent.runResponsePhase(messages, plan, actions);
        const [text, finishReason, steps]: [string, FinishReason | undefined, Array<StepResult<ToolSet>>] = await Promise.all([
          responseStream.text.catch((err: unknown) => { logger.error('Error getting response text', err instanceof Error ? err : { error: err }); return ''; }),
          responseStream.finishReason.catch((err: unknown) => { logger.error('Error getting finish reason', err instanceof Error ? err : { error: err }); return undefined as FinishReason | undefined; }),
          responseStream.steps.catch((err: unknown) => { logger.error('Error getting steps', err instanceof Error ? err : { error: err }); return [] as Array<StepResult<ToolSet>>; }),
        ]);

        // Extract tool calls from steps
        const toolCalls = extractToolCallsFromSteps(steps);
        logger.debug('Extracted tool calls', { count: toolCalls.length });

        const includeThinkingBlock = typeof input.reasoning_effort !== 'undefined';
        const thinkingBlock = includeThinkingBlock ? formatThinkingBlock(plan, actions) : undefined;
        const responseText = includeThinkingBlock
          ? [thinkingBlock, text].filter((section): section is string => Boolean(section && section.length > 0)).join('\n\n')
          : text;
        logger.info('Response phase completed', { textLength: responseText.length, finishReason, includeThinkingBlock, toolCallCount: toolCalls.length });

        // Format reasoning details from raw model outputs
        const reasoningDetails = formatReasoningDetails(plan, actions);
        logger.debug('Formatted reasoning details', { count: reasoningDetails.length });

        const result = {
          id: randomUUID(),
          created: Math.floor(Date.now() / 1000),
          model: agent.modelId,
          text: responseText,
          finishReason,
          usage: undefined,
          steps,
          reasoningDetails,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        };
        logger.info('PlanActAdapter.run completed successfully', { resultId: result.id, textLength: responseText.length, reasoningCount: reasoningDetails.length, toolCallCount: toolCalls.length });
        return result;
      } catch (error) {
        logger.error('PlanActAdapter.run failed', error instanceof Error ? error : { error });
        throw error;
      }
    },

    stream(input: ChatCompletionInput) {
      logger.info('PlanActAdapter.stream called', { model: input.model, messageCount: input.messages.length });
      const startTime = Date.now();

      const model = input.model || config.model;
      const includeReasoning = typeof input.reasoning_effort !== 'undefined';

      // Create promises for finish reason, usage, and phase coordination
      let resolveFinishReason!: (value: FinishReason | undefined) => void;
      let resolveUsage!: (value: LanguageModelUsage | undefined) => void;
      let resolveReasoningComplete!: () => void;
      let resolvePlanComplete!: (plan: z.infer<typeof PlanSchema>) => void;
      let resolveActComplete!: (actions: z.infer<typeof actStepSchema>[]) => void;

      const finishReasonPromise = new Promise<FinishReason | undefined>((resolve) => {
        resolveFinishReason = resolve;
      });

      const usagePromise = new Promise<LanguageModelUsage | undefined>((resolve) => {
        resolveUsage = resolve;
      });

      const reasoningCompletePromise = new Promise<void>((resolve) => {
        resolveReasoningComplete = resolve;
      });

      const planCompletePromise = new Promise<z.infer<typeof PlanSchema>>((resolve) => {
        resolvePlanComplete = resolve;
      });

      const actCompletePromise = new Promise<z.infer<typeof actStepSchema>[]>((resolve) => {
        resolveActComplete = resolve;
      });

      // Start plan and act phases immediately (not inside a generator)
      // This prevents deadlock when consuming reasoningStream before textStream
      const executionPromise = (async () => {
        try {
          logger.info('Stream: Creating PlanActAgent instance', { model, hasInstructions: Boolean(config.instructions) });

          // Merge client-provided tools with built-in tools
          const mergedTools = mergeTools({
            clientTools: (input.tools as OpenAITool[] | undefined) ?? [],
            enabledBuiltinTools: input.enabled_builtin_tools,
            toolChoice: input.tool_choice as OpenAIToolChoice | undefined,
            parallelToolCalls: input.parallel_tool_calls,
          });

          logger.info('Stream: Tools merged for plan-act agent', {
            totalTools: Object.keys(mergedTools.toolSet).length,
            clientTools: mergedTools.clientToolNames.length,
            builtinTools: mergedTools.builtinToolNames.length,
          });

          const agent = new PlanActAgent({
            model,
            instructions: config.instructions,
            // Plan phase gets empty tools to avoid structured output conflict
            plan: { steps: config.plan?.steps },
            // Act phase gets all the tools
            act: {
              steps: config.act?.steps,
              tools: mergedTools.toolSet,
              mergedTools: mergedTools
            }
          });
          logger.info('Stream: PlanActAgent created', { modelId: agent.modelId, elapsed: Date.now() - startTime });

          const messages = input.messages as Array<ModelMessage>;

          // Phase 1: Plan
          logger.debug('Stream: Starting Plan phase');
          const planStartTime = Date.now();
          const planStream = agent.runPlanPhase(messages);
          let latestValidPlan: z.infer<typeof PlanSchema> | undefined;

          const planPartial = (async () => {
            for await (const partial of planStream.experimental_partialOutputStream as AsyncIterable<unknown>) {
              if (partial && typeof partial === 'object' && 'steps' in partial) {
                latestValidPlan = partial as z.infer<typeof PlanSchema>;
                logger.debug('Stream: Plan partial received', { hasSteps: 'steps' in partial });
              }
            }
          })();

          // Drain plan stream with timeout
          const planTimeout = 120000; // 120 seconds
          const planResult = await Promise.race([
            (async () => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              for await (const _ of planStream.fullStream) {
                // drain
              }
              await planPartial;
              return 'completed';
            })(),
            new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), planTimeout))
          ]);

          if (planResult === 'timeout') {
            logger.error('Stream: Plan phase timed out', { timeout: planTimeout });
            throw new Error(`Plan phase timed out after ${planTimeout / 1000} seconds`);
          }

          const plan = latestValidPlan ?? { steps: [] };
          const planElapsed = Date.now() - planStartTime;
          logger.info('Stream: Plan phase completed', { stepCount: plan.steps?.length ?? 0, elapsed: planElapsed });

          // Check if plan generation failed (empty plan may indicate model issues)
          if ((plan.steps?.length ?? 0) === 0) {
            logger.warn('Stream: Plan phase produced no steps', {
              toolCountInActPhase: Object.keys(mergedTools.toolSet).length,
              model: input.model,
              message: 'Empty plan may indicate model issues - proceeding with act phase anyway'
            });
            // Don't throw error - let act phase handle empty plan gracefully
          }

          // Notify reasoning stream that plan is ready
          resolvePlanComplete(plan);

          // Phase 2: Act
          logger.debug('Stream: Starting Act phase');
          const actStartTime = Date.now();
          const actStream = agent.runActPhase(messages, plan);
          let chunkCount = 0;

          // Drain act stream with timeout
          const actTimeout = 120000; // 120 seconds
          const actResult = await Promise.race([
            (async () => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                for await (const _chunk of actStream) {
                  chunkCount++;
                  if (chunkCount % 10 === 0) {
                    logger.debug(`Stream: Act phase streaming - received ${chunkCount} chunks`);
                  }
                }
                logger.debug(`Stream: Act phase stream completed - total chunks: ${chunkCount}`);
                return 'completed';
              } catch (error) {
                logger.error('Stream: Act phase stream error', error instanceof Error ? error : { error, chunkCount });
                throw error;
              }
            })(),
            new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), actTimeout))
          ]);

          if (actResult === 'timeout') {
            logger.error('Stream: Act phase timed out', { timeout: actTimeout, chunksSoFar: chunkCount });
            throw new Error(`Act phase timed out after ${actTimeout / 1000} seconds`);
          }

          const actions = (actStream as { collectedActions?: z.infer<typeof actStepSchema>[] }).collectedActions ?? [];
          const actElapsed = Date.now() - actStartTime;
          logger.info('Stream: Act phase completed', { actionCount: actions.length, totalChunks: chunkCount, elapsed: actElapsed });

          // Notify reasoning stream that actions are ready
          resolveActComplete(actions);

          return { agent, messages, plan, actions, planElapsed, actElapsed };
        } catch (error) {
          logger.error('Stream: Fatal error in plan/act phases', error instanceof Error ? error : { error });
          resolvePlanComplete({ steps: [] });
          resolveActComplete([]);
          resolveFinishReason('error' as FinishReason);
          resolveUsage(undefined);
          throw error;
        }
      })();

      // Reasoning stream: yields plan + action content as reasoning_content deltas
      const reasoningStream = (async function* () {
        if (!includeReasoning) {
          return; // No reasoning if not requested
        }

        try {
          logger.debug('ReasoningStream: Waiting for plan to complete');
          const plan = await planCompletePromise;
          logger.info('ReasoningStream: Plan received', { stepCount: plan.steps?.length ?? 0 });

          // Stream plan steps as reasoning content
          if (plan.steps && plan.steps.length > 0) {
            for (const step of plan.steps) {
              const reasoning = `Plan: ${step.title}\nInstructions: ${step.instructions}\nContext: ${step.relevantContext}\n\n`;
              yield reasoning;
              logger.debug('ReasoningStream: Yielded plan step', { title: step.title });
            }
          }

          logger.debug('ReasoningStream: Waiting for actions to complete');
          const actions = await actCompletePromise;
          logger.info('ReasoningStream: Actions received', { actionCount: actions.length });

          // Stream actions as reasoning content
          for (const action of actions) {
            let reasoning = `Action: ${action.action}\nObservation: ${action.observation}\n`;
            if (action.addPlanStepsReason) {
              reasoning += `Plan Adjustment: ${action.addPlanStepsReason}\n`;
            }
            reasoning += '\n';
            yield reasoning;
            logger.debug('ReasoningStream: Yielded action', { action: action.action });
          }

          logger.info('ReasoningStream: All reasoning content streamed');
        } catch (error) {
          logger.error('ReasoningStream: Error streaming reasoning', error instanceof Error ? error : { error });
        } finally {
          resolveReasoningComplete();
        }
      })();

      // Text stream: yields final answer content as regular content deltas
      const textStream = (async function* () {
        try {
          // Wait for plan/act phases to complete
          const { agent, messages, plan, actions, planElapsed, actElapsed } = await executionPromise;

          // Wait for reasoning to complete before starting response
          if (includeReasoning) {
            logger.debug('Stream: Waiting for reasoning stream to complete');
            await reasoningCompletePromise;
            logger.info('Stream: Reasoning stream completed');
          }

          // Phase 3: Response - stream deltas in real-time
          logger.debug('Stream: Starting Response phase (real-time streaming)');
          const responseStartTime = Date.now();
          const responseStream = agent.runResponsePhase(messages, plan, actions);

          let totalChars = 0;
          let firstContentYielded = false;

          // Stream the response text deltas as they arrive
          for await (const chunk of responseStream.textStream) {
            if (typeof chunk === 'string' && chunk.length > 0) {
              if (!firstContentYielded) {
                const timeToFirstContent = Date.now() - startTime;
                logger.info('Stream: First content delta yielded', { timeToFirstContent, chunkLength: chunk.length });
                firstContentYielded = true;
              }
              totalChars += chunk.length;
              yield chunk;
            }
          }

          const responseElapsed = Date.now() - responseStartTime;
          logger.info('Stream: Response phase completed', { totalChars, elapsed: responseElapsed });

          // Get finish reason and usage
          const [finishReason] = await Promise.all([
            responseStream.finishReason.catch((err: unknown) => {
              logger.error('Stream: Error getting finish reason', err instanceof Error ? err : { error: err });
              return undefined as FinishReason | undefined;
            })
          ]);

          const totalElapsed = Date.now() - startTime;
          logger.info('Stream: All phases completed', {
            totalElapsed,
            finishReason,
            planTime: planElapsed,
            actTime: actElapsed,
            responseTime: responseElapsed
          });

          // Resolve finish reason and usage for controller
          resolveFinishReason(finishReason ?? 'stop');
          resolveUsage(undefined); // Plan-act doesn't expose usage yet

        } catch (error) {
          logger.error('Stream: Fatal error in response phase', error instanceof Error ? error : { error });
          resolveFinishReason('error' as FinishReason);
          resolveUsage(undefined);
          throw error;
        }
      })();

      return {
        reasoningStream: includeReasoning ? reasoningStream : (async function* () {})(),
        textStream,
        finishReason: finishReasonPromise,
        usage: usagePromise
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any as StreamTextResult<ToolSet, unknown> & { reasoningStream: AsyncIterableIterator<string> };
    }
  };

  return adapter;
}

// Removed: toLanguageModelUsage - no longer used in streaming path
