import { createLogger } from '@packages/logger';
import { Experimental_Agent as Agent, ModelMessage, Output, stepCountIs, ToolSet, type LanguageModel } from 'ai';
import { z } from 'zod';

import { resolveLanguageModel } from '../models';

const logger = createLogger('agents:plan-act');

export const PlanSchema = z.object({
    steps: z.array(z.object({
        title: z.string(),
        instructions: z.string(),
        relevantContext: z.string()
    }))
});

const PlanStepsSchema = PlanSchema.shape.steps;
type PlanStep = z.infer<typeof PlanStepsSchema>[number];

type PartialActStep = {
    action?: string;
    observation?: string;
    addPlanSteps?: (Partial<PlanStep> | undefined)[] | undefined;
    addPlanStepsReason?: string;
};

export const actStepSchema = z.object({
    action: z.string(),
    observation: z.string(),
    addPlanSteps: PlanStepsSchema.optional(),
    addPlanStepsReason: z.string().optional().describe("Required if addPlanSteps is provided. Explain why these new steps are necessary.")
});

export interface PlanActAgentConfig {
    instructions?: string;  // Base instructions (fallback for all phases)
    model?: string | LanguageModel;
    plan?: {
        steps?: number;
        tools?: ToolSet;
        instructions?: string;  // Plan phase-specific instructions
    };
    act?: {
        steps?: number;
        tools?: ToolSet;
        instructions?: string;  // Act phase-specific instructions
    };
    response?: {
        instructions?: string;  // Response phase-specific instructions
    };
}

export class PlanActAgent {
    static DEFAULT_INSTRUCTIONS = "You are a Plan-and-Act agent. Use the tools to answer the user's question.";

    static PLAN_PHASE_INSTRUCTIONS = `You are in the PLANNING phase of a Plan-and-Act agent.

TASK: Analyze the user's query and create an appropriate execution plan.

COMPLEXITY ASSESSMENT:
- Simple queries (basic math, definitions, single facts): Create 1 step
  Example: "What is 2+2?" → [{ title: "Calculate sum", instructions: "Add 2+2 and return result", relevantContext: "Basic arithmetic" }]

- Moderate queries (2-3 related lookups, basic multi-step reasoning): Create 2-3 steps
  Example: "What are the benefits of React vs Vue?" → 2 steps (gather React info, gather Vue info)

- Complex queries (research, analysis, multi-tool coordination): Create 3-5 steps
  Example: "Build me a deployment pipeline" → Multiple distinct steps

STEP QUALITY GUIDELINES:
- Each step = ONE distinct action or tool call
- Be specific: "Search AWS docs for Lambda pricing" NOT "Gather information"
- Include the purpose in relevantContext: "Need pricing data for comparison"
- Steps execute sequentially, so order matters

IMPORTANT:
- More steps ≠ better quality
- For simple queries, 1 well-defined step is better than 3 vague ones
- If unsure, err on the side of fewer steps

OUTPUT: Array of steps with title, instructions, and relevantContext for each.`;

    static ACT_PHASE_INSTRUCTIONS = `You are in the ACTION phase of a Plan-and-Act agent.

TASK: Execute the current plan step by taking ONE action and recording what you observe.

OUTPUT FORMAT:
{
  "action": "What you did (e.g., 'Calculated 2+2', 'Called search API with query X')",
  "observation": "What you learned or produced (e.g., 'Result is 4', 'Found 3 relevant documents')",
  "addPlanSteps": [] or undefined (READ BELOW - usually leave empty!),
  "addPlanStepsReason": "Required if adding steps - explain why"
}

CRITICAL: When to use addPlanSteps

DEFAULT BEHAVIOR: Leave addPlanSteps EMPTY (undefined or [])
This field is for UNEXPECTED situations only.

✅ ADD STEPS ONLY IF:
1. You discovered unexpected complexity
   Example: "Tool returned 50 results when we expected 5, need separate analysis step"

2. You hit a blocker
   Example: "API requires authentication token, need step to obtain token first"

3. You found a missing prerequisite
   Example: "User asked to deploy but no build exists, need build step"

❌ DO NOT ADD STEPS IF:
- You successfully completed the current step → just record observation
- The observation contains enough info to continue → leave empty
- You're following a pattern → each step is independent
- You think you "should" add more steps → only add if truly necessary

EXAMPLES:

Simple query execution (DEFAULT - most common):
{
  "action": "Calculated 2+2 using basic arithmetic",
  "observation": "The result is 4",
  "addPlanSteps": undefined
}

Unexpected complexity discovered (RARE):
{
  "action": "Searched pricing docs",
  "observation": "Found 12 different pricing tiers, each requiring separate analysis",
  "addPlanSteps": [
    { "title": "Analyze standard tier", "instructions": "Extract standard tier pricing", "relevantContext": "Most commonly used tier" }
  ],
  "addPlanStepsReason": "Discovered 12 pricing tiers that were not anticipated in original plan, need separate analysis for most common tier"
}

REMEMBER: If in doubt, leave addPlanSteps empty. It's better to execute the plan as-is than to add unnecessary complexity.`;

    static RESPONSE_PHASE_INSTRUCTIONS = `You are in the RESPONSE phase of a Plan-and-Act agent.

TASK: Synthesize the plan and action results into a clear, natural answer for the user.

GUIDELINES:
- For simple queries: Direct, concise answer (1-2 sentences)
  Example query: "What is 2+2?" → "2 + 2 = 4"

- For complex queries: Structured answer with supporting details
  Example query: "Compare AWS vs GCP" → Summary with key differences and recommendation

- Be conversational, not robotic
  ✅ "2 + 2 equals 4"
  ❌ "Based on my action execution, I determined that 2 + 2 equals 4"

- Don't reveal internal process
  ❌ "In my planning phase, I created 3 steps..."
  ✅ Just provide the answer naturally

- Use observations, but don't quote them verbatim
  Synthesize information, don't just copy/paste

The context from planning and actions is provided below. Use it to inform your response, but write naturally as if answering the user directly.`;

    static DEFAULT_PLAN_TOOLS: ToolSet = {};
    static DEFAULT_ACT_TOOLS: ToolSet = {};
    static DEFAULT_PLAN_STEPS = 5;
    static DEFAULT_ACT_STEPS = 5;

    private readonly resolvedModel: LanguageModel;
    private readonly resolvedModelId: string;

    constructor(private config: PlanActAgentConfig = {}) {
        logger.debug('PlanActAgent constructor called', {
            model: typeof config?.model === 'string' ? config.model : typeof config?.model,
            hasInstructions: Boolean(config?.instructions),
            planSteps: config?.plan?.steps,
            actSteps: config?.act?.steps
        });

        try {
            const { model, id } = resolveLanguageModel(config?.model);
            logger.info('PlanActAgent model resolved', { modelId: id });

            this.resolvedModel = model;
            this.resolvedModelId = id;
        } catch (error) {
            logger.error('Failed to resolve model in PlanActAgent constructor', error instanceof Error ? error : { error });
            throw error;
        }
    }

    run(input: ModelMessage[]) {
        const pipeline = async function* (this: PlanActAgent) {
            const planStream = this.runPlanPhase(input);
            let resolvedPlan: z.infer<typeof PlanSchema> | undefined;

            const planCollector = (async () => {
                for await (const partial of planStream.experimental_partialOutputStream) {
                    if (!partial) {
                        continue;
                    }

                    const parsedPlan = PlanSchema.safeParse(partial);
                    if (parsedPlan.success) {
                        resolvedPlan = parsedPlan.data;
                    }
                }
            })();

            try {
                for await (const chunk of planStream.fullStream) {
                    yield chunk;
                }
            } finally {
                await planCollector;
            }

            const plan = resolvedPlan ?? PlanSchema.parse({ steps: [] });

            const actStream = this.runActPhase(input, plan);
            for await (const chunk of actStream) {
                yield chunk;
            }

            const actions = actStream.collectedActions ?? [];
            const responseStream = this.runResponsePhase(input, plan, actions);

            for await (const chunk of responseStream.fullStream) {
                yield chunk;
            }
        };

        return pipeline.call(this);
    }

    runPlanPhase(input: ModelMessage[], ) {
        const planAgent = new Agent({
            model: this.model,
            system: this.planInstructions,
            tools: this.planTools,
            stopWhen: stepCountIs(this.planSteps),
            experimental_output: Output.object({schema: PlanSchema}),
        });

        return planAgent.stream({
            prompt: [...input],
        });
    }

    runSingleAction(
        agent: Agent<ToolSet, z.infer<typeof actStepSchema>, PartialActStep>,
        input: ModelMessage[], planStep: z.infer<typeof PlanSchema>['steps'][number],
        previousActions?: z.infer<typeof actStepSchema>[]
    ) {
        return agent.stream({
            prompt: [...input, ...PlanActAgent.actStepsToMessage(previousActions || []), PlanActAgent.planStepToMessage(planStep)],
        });
    }

    runActPhase(input: ModelMessage[], plan: z.infer<typeof PlanSchema>) {
        const actAgent = new Agent({
            model: this.model,
            system: this.actInstructions,
            tools: this.actTools,
            stopWhen: stepCountIs(this.actSteps),
            experimental_output: Output.object({schema: actStepSchema}),
        });

        const planQueue = [...plan.steps];
        const previousActions: z.infer<typeof actStepSchema>[] = [];
        const MAX_ACT_ITERATIONS = this.actSteps * 2; // Prevent infinite loops from dynamic step additions
        let iterationCount = 0;

        const streamRunner = async function* (this: PlanActAgent) {
            while (planQueue.length > 0 && iterationCount < MAX_ACT_ITERATIONS) {
                iterationCount++;
                logger.debug(`Act phase iteration ${iterationCount}/${MAX_ACT_ITERATIONS}`, { queueLength: planQueue.length });

                const currentStep = planQueue.shift()!;
                const actionStream = this.runSingleAction(actAgent, input, currentStep, previousActions);

                let lastAction: z.infer<typeof actStepSchema> | undefined;
                const partialCollector = (async () => {
                    for await (const partial of actionStream.experimental_partialOutputStream) {
                        if (partial && partial.action && partial.observation) {
                            const additions = PlanActAgent.toPlanSteps(partial.addPlanSteps);
                            const reason = partial.addPlanStepsReason;

                            if (additions.length) {
                                // Log when steps are added dynamically
                                if (reason) {
                                    logger.info(`Dynamic steps added to plan (${additions.length} steps)`, {
                                        reason,
                                        newSteps: additions.map(s => s.title)
                                    });
                                } else {
                                    logger.warn(`Dynamic steps added WITHOUT reason (${additions.length} steps)`, {
                                        newSteps: additions.map(s => s.title)
                                    });
                                }

                                for (let index = additions.length - 1; index >= 0; index -= 1) {
                                    planQueue.unshift(additions[index]);
                                }
                            }

                            lastAction = {
                                action: partial.action,
                                observation: partial.observation,
                                ...(additions.length ? {
                                    addPlanSteps: additions,
                                    ...(reason ? { addPlanStepsReason: reason } : {})
                                } : {}),
                            };
                        }
                    }
                })();

                try {
                    for await (const chunk of actionStream.fullStream) {
                        yield chunk;
                    }
                } finally {
                    await partialCollector;
                }

                if (lastAction) {
                    previousActions.push(lastAction);
                }
            }

            if (planQueue.length > 0) {
                logger.warn(`Act phase reached maximum iterations (${MAX_ACT_ITERATIONS}), ${planQueue.length} steps remaining in queue`);
            }
        };

        const stream = streamRunner.call(this);
        return Object.assign(stream, { collectedActions: previousActions });
    }

    private static toPlanSteps(candidate: unknown): PlanStep[] {
        if (!candidate) {
            return [];
        }

        const result = PlanStepsSchema.safeParse(candidate);
        return result.success ? result.data : [];
    }

    static planStepToMessage(step: z.infer<typeof PlanSchema>['steps'][number]): ModelMessage {
        return {
            role: 'system',
            content: `Plan Step: ${step.title}\nInstructions: ${step.instructions}\nRelevant Context: ${step.relevantContext}`
        };
    }

    static actStepToMessage(step: z.infer<typeof actStepSchema>): ModelMessage {
        return {
            // Maybe this should be a combo of "assistant" and "tool"?
            role: 'assistant',
            // TODO: Watch for issues with actions after the first one trying to emulate this format
            content: `Action taken: ${step.action}\nObservations: ${step.observation}`
        };
    }

    static actStepsToMessage(steps: z.infer<typeof actStepSchema>[]): ModelMessage[] {
        // Long way becuase apparently just putting in the function reference causes `this` issues
        return steps.map((step) => PlanActAgent.actStepToMessage(step));
    }

    runResponsePhase(
        input: ModelMessage[],
        plan: z.infer<typeof PlanSchema>,
        actions: z.infer<typeof actStepSchema>[]
    ) {
        const responseAgent = new Agent({
            model: this.model,
            system: this.responseInstructions,
            stopWhen: stepCountIs(1),
        });

        const planMessages = plan?.steps?.length
            ? plan.steps.map((step) => PlanActAgent.planStepToMessage(step))
            : [];
        const actionMessages = actions?.length
            ? PlanActAgent.actStepsToMessage(actions)
            : [];

        const contextPrelude: ModelMessage | undefined =
            planMessages.length || actionMessages.length
                ? {
                      role: 'system',
                      content: 'Context from prior planning and actions is provided below. Use it to craft the final response.',
                  }
                : undefined;

        const finalInstruction: ModelMessage = {
            role: 'system',
            content:
                'Provide the final assistant answer to the user based on the conversation and the above plan and actions. Do not call additional tools.',
        };

        return responseAgent.stream({
            prompt: [
                // save context by not including the full conversation history
                ...input.slice(-1),
                ...(contextPrelude ? [contextPrelude] : []),
                ...planMessages,
                ...actionMessages,
                finalInstruction,
            ],
        });
    }

    get instructions() {
        return this.config.instructions || PlanActAgent.DEFAULT_INSTRUCTIONS;
    }

    get planInstructions() {
        return this.config.plan?.instructions || this.config.instructions || PlanActAgent.PLAN_PHASE_INSTRUCTIONS;
    }

    get actInstructions() {
        return this.config.act?.instructions || this.config.instructions || PlanActAgent.ACT_PHASE_INSTRUCTIONS;
    }

    get responseInstructions() {
        return this.config.response?.instructions || this.config.instructions || PlanActAgent.RESPONSE_PHASE_INSTRUCTIONS;
    }

    get planTools() {
        return this.config.plan?.tools || PlanActAgent.DEFAULT_PLAN_TOOLS;
    }

    get planSteps() {
        return this.config.plan?.steps || PlanActAgent.DEFAULT_PLAN_STEPS;
    }

    get actSteps() {
        return this.config.act?.steps || PlanActAgent.DEFAULT_ACT_STEPS;
    }

    get actTools() {
        return this.config.act?.tools || PlanActAgent.DEFAULT_ACT_TOOLS;
    }

    get model() {
        return this.resolvedModel;
    }

    get modelId() {
        return this.resolvedModelId;
    }
}
