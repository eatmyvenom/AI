import { Experimental_Agent as Agent, ModelMessage, Output, stepCountIs, ToolSet } from 'ai';
import { z } from 'zod';

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
};

export const actStepSchema = z.object({
    action: z.string(),
    observation: z.string(),
    addPlanSteps: PlanStepsSchema.optional()
});

export interface PlanActAgentConfig {
    instructions?: string;
    model?: string;
    plan?: {
        steps?: number;
        tools?: ToolSet;
    };
    act?: {
        steps?: number;
        tools?: ToolSet;
    }
}

export class PlanActAgent {
    static DEFAULT_MODEL = "gpt-5";
    static DEFAULT_INSTRUCTIONS = "You are a Plan-and-Act agent. Use the tools to answer the user's question.";
    static DEFAULT_PLAN_TOOLS: ToolSet = {};
    static DEFAULT_ACT_TOOLS: ToolSet = {};
    static DEFAULT_PLAN_STEPS = 5;
    static DEFAULT_ACT_STEPS = 5;

    constructor(private config: PlanActAgentConfig) {}

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
            system: this.instructions,
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
            system: this.instructions,
            tools: this.actTools,
            stopWhen: stepCountIs(this.actSteps),
            experimental_output: Output.object({schema: actStepSchema}),
        });

        const planQueue = [...plan.steps];
        const previousActions: z.infer<typeof actStepSchema>[] = [];

        const streamRunner = async function* (this: PlanActAgent) {
            while (planQueue.length > 0) {
                const currentStep = planQueue.shift()!;
                const actionStream = this.runSingleAction(actAgent, input, currentStep, previousActions);

                let lastAction: z.infer<typeof actStepSchema> | undefined;
                const partialCollector = (async () => {
                    for await (const partial of actionStream.experimental_partialOutputStream) {
                        if (partial && partial.action && partial.observation) {
                            const additions = PlanActAgent.toPlanSteps(partial.addPlanSteps);

                            if (additions.length) {
                                for (let index = additions.length - 1; index >= 0; index -= 1) {
                                    planQueue.unshift(additions[index]);
                                }
                            }

                            lastAction = {
                                action: partial.action,
                                observation: partial.observation,
                                ...(additions.length ? { addPlanSteps: additions } : {}),
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
            system: this.instructions,
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
        return this.config.model || PlanActAgent.DEFAULT_MODEL;
    }
}
