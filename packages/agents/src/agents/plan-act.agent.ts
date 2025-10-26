import { createLogger } from '@packages/logger';
import { Experimental_Agent as Agent, ModelMessage, Output, stepCountIs, ToolSet, type LanguageModel } from 'ai';
import { z } from 'zod';

import { resolveLanguageModel } from '../models';
import type { MergedTools, ToolMetadata } from '../tools';
import { ClientExecutionRequiredError } from '../tools/converter';

const logger = createLogger('agents:plan-act');

export const PlanSchema = z.object({
    steps: z.array(z.object({
        title: z.string(),
        instructions: z.string(),
        relevantContext: z.string(),
        toolStrategy: z.object({
            toolName: z.string().optional().describe("Name of the tool to use for this step (if any)"),
            reason: z.string().optional().describe("Why this tool is better than internal knowledge"),
            fallbackToInternal: z.boolean().optional().describe("If the tool fails, should we fall back to internal knowledge?")
        }).optional().describe("Strategy for using tools in this step")
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
        availableTools?: ToolMetadata[];  // List of available tools for planning (no access, just metadata)
    };
    act?: {
        steps?: number;
        tools?: ToolSet;
        instructions?: string;  // Act phase-specific instructions
        mergedTools?: MergedTools;  // Tool metadata for execution detection
    };
    response?: {
        instructions?: string;  // Response phase-specific instructions
    };
}

export class PlanActAgent {
    static DEFAULT_INSTRUCTIONS = "You are a Plan-and-Act agent. Use the tools to answer the user's question.";

    static PLAN_PHASE_INSTRUCTIONS = `You are in the PLANNING phase of a Plan-and-Act agent.

TASK: Analyze the user's query and create an appropriate execution plan that intelligently uses available tools.

AVAILABLE TOOLS CONTEXT:
You have access to a LIST of tools that will be available in the action phase, but you CANNOT use them directly during planning. Use this list to plan tool usage strategically.

TOOL SELECTION STRATEGY:
CRITICAL: Prefer tools over internal knowledge when tools provide superior information:

1. Web Search Tools (e.g., tavily, search_web, search):
   ✅ Always use for: Current events, real-time data, recent facts, trending topics
   ✅ Always use for: Factual queries requiring up-to-date information
   ✅ Always use for: News, market data, weather, sports scores
   ❌ Avoid for: Mathematics,逻辑推理, creative writing, code examples
   Reason: Web search provides current, accurate data vs potentially outdated internal knowledge

2. Calculator Tools (e.g., calculator, compute):
   ✅ Always use for: Mathematical calculations, numerical computations
   ✅ Always use for: Complex arithmetic, percentages, statistical calculations
   Reason: Guaranteed accuracy vs human error potential

3. Time/Date Tools (e.g., getCurrentTime, time):
   ✅ Always use for: Current time, timestamps, scheduling queries
   Reason: Provides accurate, timezone-aware current information

4. File/System Tools (e.g., readFile, writeFile, bash):
   ✅ Use when: Query involves reading files, system operations, code analysis
   Reason: Direct access to actual files/system state vs assumptions

5. API/Web Tools (e.g., fetch, api_call):
   ✅ Use when: Need specific external data, service integrations
   Reason: Real-time data from authoritative sources

PLANNING GUIDELINES:

COMPLEXITY ASSESSMENT:
- Simple queries (basic math, definitions with internal knowledge): Create 1 step
  Example: "What is 2+2?" → [{ title: "Calculate sum", instructions: "Add 2+2 using calculator", relevantContext: "Basic arithmetic", toolStrategy: { toolName: "calculator", reason: "Guaranteed accuracy for mathematical calculations", fallbackToInternal: true } }]

- Moderate queries (2-3 related lookups, basic multi-step reasoning): Create 2-3 steps
  Example: "What are the benefits of React vs Vue?" → 2 steps (search current React info, search current Vue info)

- Complex queries (research, analysis, multi-tool coordination): Create 3-5 steps
  Example: "What's the current stock price of Tesla and how has it trended?" → Multiple steps with web search

TOOL STRATEGY REQUIREMENTS:
For each step that should use a tool, include toolStrategy with:
- toolName: Exact name of the tool from the available tools list
- reason: Why this tool is superior to internal knowledge
- fallbackToInternal: If tool fails, should we use internal knowledge?

INTERNAL KNOWLEDGE ONLY SCENARIOS:
- Creative writing, brain teasers, hypothetical scenarios
- Logic puzzles, reasoning problems
- General concepts, historical knowledge (not requiring current data)
- Code examples, tutorials (unless referencing current libs)

STEP QUALITY GUIDELINES:
- Each step = ONE distinct action or tool call
- Be specific: "Search web for 'current React best practices 2025'" NOT "Gather React information"
- Include the purpose in relevantContext
- Explicitly justify tool choices in toolStrategy.reason
- Steps execute sequentially, order matters

CONCLUSION:
Your plan should make clear WHEN and WHY to use tools. When tools provide superior information, explicitly plan to use them. Only rely on internal knowledge when tools aren't available or aren't advantageous.

OUTPUT: Array of steps with title, instructions, relevantContext, and optional toolStrategy for each.`;

    static ACT_PHASE_INSTRUCTIONS = `You are in the ACTION phase of a Plan-and-Act agent.

TASK: Execute the current plan step by taking ONE action and recording what you observe.

CRITICAL TOOL STRATEGY GUIDANCE:
The planning phase determined the optimal tool usage strategy. You MUST follow it:

✅ IF plan step includes toolStrategy:
- Execute the EXACT tool specified in toolStrategy.toolName
- Do not substitute with other tools or internal knowledge
- The reason field tells you WHY this tool was chosen - trust that reasoning
- If tool fails, only use fallbackToInternal=true to try internal knowledge

❌ DO NOT IGNORE TOOL STRATEGY unless:
- Specified tool is not actually available (check your tool list)
- Tool throws an error AND fallbackToInternal=false
- The tool is clearly mismatched to the query (e.g., calculator for web search)

OUTPUT FORMAT:
{
  "action": "What you did (e.g., 'Calculated 2+2 using calculator', 'Called tavily web search with query X')",
  "observation": "What you learned or produced (e.g., 'Result is 4', 'Found 3 relevant documents')",
  "addPlanSteps": [] or undefined (READ BELOW - usually leave empty!),
  "addPlanStepsReason": "Required if adding steps - explain why"
}

TOOL EXECUTION EXAMPLES:
Following tool strategy (DEFAULT - preferred when specified):
{
  "action": "Used tavily to search for 'current Tesla stock price'",
  "observation": "TSLA is trading at $242.18 as of market close today, up 2.3% from yesterday",
  "addPlanSteps": undefined
}

Internal knowledge fallback (when tool fails and fallbackToInternal=true):
{
  "action": "Tavily search failed, used internal knowledge about capital cities",
  "observation": "The capital of France is Paris",
  "addPlanSteps": undefined
}

CRITICAL: When to use addPlanSteps

DEFAULT BEHAVIOR: Leave addPlanSteps EMPTY (undefined or [])
This field is for UNEXPECTED situations only.

✅ ADD STEPS ONLY IF:
1. You discovered unexpected complexity (not anticipated in planning)
   Example: "Tool returned 50 results when we expected 5, need separate analysis step"

2. You hit a blocker not foreseen in planning
   Example: "API requires authentication token, need step to obtain token first"

3. You found a missing prerequisite
   Example: "User asked to deploy but no build exists, need build step"

❌ DO NOT ADD STEPS IF:
- You successfully completed the current step → just record observation
- The observation contains enough info to continue → leave empty
- You're following a pattern → each step is independent
- The planned tool strategy worked as expected → no need to modify plan

REMEMBER: The planner chose tools strategically. Follow that strategy unless there's a compelling reason not to. It's better to execute the planned tool strategy than to second-guess it.`;

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
        // Warn if plan tools are configured (they shouldn't be used)
        if (config?.plan?.tools && Object.keys(config.plan.tools).length > 0) {
            logger.warn('Plan phase tools provided - these will be ignored to avoid conflict with structured output', {
                planToolCount: Object.keys(config.plan.tools).length,
                note: 'Plan phase uses only structured output, Act phase receives all tools'
            });
        }

        logger.debug('PlanActAgent constructor called', {
            model: typeof config?.model === 'string' ? config.model : typeof config?.model,
            hasInstructions: Boolean(config?.instructions),
            planSteps: config?.plan?.steps,
            actSteps: config?.act?.steps,
            actToolCount: Object.keys(config?.act?.tools || {}).length
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
            // Extract tool metadata for planning phase
            const availableTools = this.extractAvailableTools();

            const planStream = this.runPlanPhase(input, availableTools);
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

    runPlanPhase(input: ModelMessage[], availableTools?: ToolMetadata[]) {
        // Build enhanced system message with available tools context
        let planSystemMessage = this.planInstructions;

        if (availableTools && availableTools.length > 0) {
            const toolsList = availableTools.map(tool =>
                `- ${tool.name}: ${this.getToolDescription(tool)}`
            ).join('\n');

            planSystemMessage += `\n\nAVAILABLE TOOLS FOR ACTION PHASE:\n${toolsList}\n\nRemember: You CANNOT use these tools now in planning phase, but you can plan to use them in the action phase using toolStrategy.`;
        }

        const planAgent = new Agent({
            model: this.model,
            system: planSystemMessage,
            // Remove tools from plan phase to avoid conflict with structured output
            // Tools will be available in act phase only
            stopWhen: stepCountIs(this.planSteps),
            experimental_output: Output.object({schema: PlanSchema}),
        });

        // Filter out system messages from input since the agent already has a system message
        const filteredInput = input.filter(msg => msg.role !== 'system');

        return planAgent.stream({
            prompt: [...filteredInput],
        });
    }

    runSingleAction(
        agent: Agent<ToolSet, z.infer<typeof actStepSchema>, PartialActStep>,
        input: ModelMessage[], planStep: z.infer<typeof PlanSchema>['steps'][number],
        previousActions?: z.infer<typeof actStepSchema>[]
    ) {
        // Filter out system messages from input since the agent already has a system message
        const filteredInput = input.filter(msg => msg.role !== 'system');

        return agent.stream({
            prompt: [...filteredInput, ...PlanActAgent.actStepsToMessage(previousActions || []), PlanActAgent.planStepToMessage(planStep)],
        });
    }

    runActPhase(input: ModelMessage[], plan: z.infer<typeof PlanSchema>) {
        const actAgent = new Agent({
            model: this.model,
            system: this.actInstructions,
            tools: this.actTools,
            stopWhen: stepCountIs(this.actSteps),
            // Remove structured output to avoid tools + structured output conflict
            // Let agent generate natural text responses instead
        });

        const planQueue = [...plan.steps];
        const previousActions: z.infer<typeof actStepSchema>[] = [];
        const MAX_ACT_ITERATIONS = this.actSteps * 2; // Prevent infinite loops from dynamic step additions
        let iterationCount = 0;

        const streamRunner = async function* (this: PlanActAgent) {
            // If no plan steps were generated, create a default action to respond directly
            if (planQueue.length === 0) {
                logger.debug('No plan steps generated - will proceed directly to response phase');
                return; // Skip act phase entirely
            }

            while (planQueue.length > 0 && iterationCount < MAX_ACT_ITERATIONS) {
                iterationCount++;
                logger.debug(`Act phase iteration ${iterationCount}/${MAX_ACT_ITERATIONS}`, { queueLength: planQueue.length });

                const currentStep = planQueue.shift()!;
                const actionStream = this.runSingleAction(actAgent, input, currentStep, previousActions);

                let lastAction: z.infer<typeof actStepSchema> | undefined;
                let streamError: ClientExecutionRequiredError | Error | undefined;

                // Since we removed structured output, we need to extract action-observation from text
                const textCollector = (async () => {
                    let fullText = '';
                    for await (const chunk of actionStream.textStream) {
                        if (typeof chunk === 'string' && chunk.length > 0) {
                            fullText += chunk;
                        }
                    }

                    // Parse the response to extract action and observation
                    if (fullText) {
                        // Simple pattern matching - look for action/observation patterns
                        const actionMatch = fullText.match(/action[:\s]*([^.]*?)(?:\n|$)/im) ||
                                        fullText.match(/i["']?([^"']*)["']?[^:]*action/im) ||
                                        fullText.match(/^([^.]*?)(?=\n|m\.)/);

                        const obsMatch = fullText.match(/observation[:\s]*([^.]*?)(?:\n|$)/im) ||
                                     fullText.match(/observation[:\s]*([^.]*?)(?:\n|$)/im) ||
                                     fullText.match(/result[:\s]*([^.]*?)(?:\n|$)/im);

                        const action = actionMatch?.[1]?.trim() || 'Action taken by agent';
                        const observation = obsMatch?.[1]?.trim() || fullText.trim();

                        lastAction = {
                            action,
                            observation,
                        };

                        logger.debug('Parsed action from text response', {
                            action,
                            observation: observation.substring(0, 100) + (observation.length > 100 ? '...' : '')
                        });
                    }
                })();

                try {
                    for await (const chunk of actionStream.fullStream) {
                        yield chunk;
                    }
                } catch (error) {
                    // Capture error for processing after stream collection completes
                    if (error instanceof ClientExecutionRequiredError) {
                        streamError = error;
                        logger.info('Client tool execution required', {
                            toolName: error.toolName,
                            toolCallId: error.toolCallId
                        });
                    } else {
                        streamError = error instanceof Error ? error : new Error(String(error));
                    }
                } finally {
                    await textCollector;
                }

                // If client tool execution was required, create an action that reflects this
                if (streamError instanceof ClientExecutionRequiredError) {
                    lastAction = {
                        action: `Attempted to call client tool: ${streamError.toolName} (${streamError.toolCallId})`,
                        observation: `Client tool requires execution on client side. Tool: ${streamError.toolName}. This tool call needs to be sent to the client for execution.`,
                    };
                    logger.info('Created client tool placeholder action', { toolName: streamError.toolName });
                } else if (streamError && !lastAction) {
                    // For other errors, if we don't have an action yet, log but continue
                    logger.warn('Stream error occurred but action collection may have succeeded', {
                        error: streamError instanceof Error ? streamError.message : String(streamError)
                    });
                } else if (!lastAction) {
                    // If we couldn't parse action from text, create a generic one
                    lastAction = {
                        action: 'Processed plan step',
                        observation: 'Action completed (details not explicitly parsed from text response)'
                    };
                    logger.warn('Could not parse structured action from text response, using generic action');
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

    // NOTE: toPlanSteps removed since we no longer use structured output with addPlanSteps

    static planStepToMessage(step: z.infer<typeof PlanSchema>['steps'][number]): ModelMessage {
        return {
            role: 'user',
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
        // Build a single consolidated system message with all context
        const contextParts: string[] = [this.responseInstructions];

        if (plan?.steps?.length || actions?.length) {
            contextParts.push('\nContext from prior planning and actions is provided below. Use it to craft the final response.\n');
        }

        if (plan?.steps?.length) {
            contextParts.push('Plan Steps:');
            plan.steps.forEach((step, idx) => {
                contextParts.push(`${idx + 1}. ${step.title}`);
                contextParts.push(`   Instructions: ${step.instructions}`);
                contextParts.push(`   Relevant Context: ${step.relevantContext}`);
            });
        }

        if (actions?.length) {
            contextParts.push('\nActions Taken:');
            actions.forEach((action, idx) => {
                contextParts.push(`${idx + 1}. Action: ${action.action}`);
                contextParts.push(`   Observations: ${action.observation}`);
            });
        }

        contextParts.push('\nProvide the final assistant answer to the user based on the conversation and the above plan and actions. Do not call additional tools.');

        const consolidatedSystemMessage = contextParts.join('\n');

        const responseAgent = new Agent({
            model: this.model,
            system: consolidatedSystemMessage,
            stopWhen: stepCountIs(1),
        });

        // Filter out system messages from input since the agent already has a system message
        const filteredInput = input.slice(-1).filter(msg => msg.role !== 'system');

        return responseAgent.stream({
            prompt: [
                // save context by not including the full conversation history
                ...filteredInput,
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
        // Plan phase does not use tools to avoid conflict with structured output
        return PlanActAgent.DEFAULT_PLAN_TOOLS;
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

    extractAvailableTools(): ToolMetadata[] {
        // Extract tool metadata from merged tools for planning phase
        const mergedTools = this.config.act?.mergedTools;
        if (!mergedTools) {
            return [];
        }

        const allTools: ToolMetadata[] = [];

        // Add client tools
        for (const clientToolName of mergedTools.clientToolNames) {
            const metadata = mergedTools.metadata.get(clientToolName);
            if (metadata) {
                allTools.push(metadata);
            }
        }

        // Add built-in tools (including MCP tools)
        for (const builtinToolName of mergedTools.builtinToolNames) {
            const metadata = mergedTools.metadata.get(builtinToolName);
            if (metadata) {
                allTools.push(metadata);
            }
        }

        return allTools;
    }

    getToolDescription(tool: ToolMetadata): string {
        // Try to extract description from the original definition
        if (tool.originalDefinition?.function?.description) {
            return tool.originalDefinition.function.description;
        }

        // Fallback descriptions based on tool name patterns
        const name = tool.name.toLowerCase();
        if (name.includes('search') || name.includes('tavily') || name.includes('web')) {
            return 'Web search tool for current information';
        }
        if (name.includes('calc') || name.includes('compute')) {
            return 'Mathematical calculator for accurate computations';
        }
        if (name.includes('time') || name.includes('date')) {
            return 'Current time and date information';
        }
        if (name.includes('file') || name.includes('read') || name.includes('write')) {
            return 'File system access tool';
        }
        if (name.includes('api') || name.includes('fetch')) {
            return 'External API/data access tool';
        }

        return 'Available tool for action phase';
    }

    get model() {
        return this.resolvedModel;
    }

    get modelId() {
        return this.resolvedModelId;
    }
}
