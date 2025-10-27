import { randomUUID } from 'node:crypto';

import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';

import { getMCPTools } from './mcp-client';

/**
 * Built-in server-side tools
 *
 * These tools execute on the server and can be enabled via API request parameters.
 */

/**
 * MCP tools cache
 * Initialized lazily on first access to avoid startup delays
 */
let mcpToolsCache: ToolSet | null = null;
let mcpToolsInitPromise: Promise<ToolSet> | null = null;

/**
 * Calculator tool - evaluates mathematical expressions safely
 */
export const calculator = tool({
  description: 'Evaluates a mathematical expression and returns the result. Supports basic arithmetic operations (+, -, *, /), parentheses, and common math functions.',
  inputSchema: z.object({
    expression: z.string().describe('The mathematical expression to evaluate (e.g., "2 + 2", "Math.sqrt(16)", "5 * (3 + 2)")'),
  }),
  execute: async ({ expression }) => {
    try {
      // For safety, we'll use Function constructor with limited allowed characters
      // This is still eval, but more controlled - only allows basic math operations
      const allowedExpr = expression
        .replace(/[^\d+\-*/().,\sMath.sqrtpowasbcosintanlogfloorceimaxn]/g, '')
        .trim();

      if (!allowedExpr) {
        throw new Error('Expression contains no valid characters');
      }

      // Evaluate using Function constructor
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
      const result: unknown = Function('"use strict"; return (' + allowedExpr + ')')();

      return Promise.resolve({
        expression,
        result,
        success: true,
      });
    } catch (error) {
      return Promise.resolve({
        expression,
        error: error instanceof Error ? error.message : 'Failed to evaluate expression',
        success: false,
      });
    }
  },
});

/**
 * Get current time tool - returns current timestamp in various formats
 */
export const getCurrentTime = tool({
  description: 'Returns the current date and time in various formats including ISO 8601, Unix timestamp, and human-readable format.',
  inputSchema: z.object({
    timezone: z.string().optional().describe('Optional timezone (e.g., "America/New_York", "Europe/London"). Defaults to UTC.'),
    format: z.enum(['iso', 'unix', 'human', 'all']).optional().describe('Output format: iso (ISO 8601), unix (Unix timestamp), human (readable), all (all formats). Defaults to "all".'),
  }),
  execute: async ({ timezone, format = 'all' }) => {
    const now = new Date();

    const result: {
      iso?: string;
      unix?: number;
      human?: string;
      timezone?: string;
    } = {};

    if (format === 'iso' || format === 'all') {
      result.iso = now.toISOString();
    }

    if (format === 'unix' || format === 'all') {
      result.unix = Math.floor(now.getTime() / 1000);
    }

    if (format === 'human' || format === 'all') {
      result.human = now.toLocaleString('en-US', {
        timeZone: timezone || 'UTC',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
    }

    if (timezone) {
      result.timezone = timezone;
    }

    return Promise.resolve(result);
  },
});

/**
 * Generate UUID tool - creates a new UUID v4
 */
export const generateUUID = tool({
  description: 'Generates a new UUID (Universally Unique Identifier) v4. Useful for creating unique identifiers for entities, sessions, or tracking.',
  inputSchema: z.object({
    count: z.number().int().min(1).max(100).optional().describe('Number of UUIDs to generate (1-100). Defaults to 1.'),
    format: z.enum(['string', 'array']).optional().describe('Output format: string (comma-separated) or array. Defaults to string for count=1, array otherwise.'),
  }),
  execute: async ({ count = 1, format }) => {
    const uuids = Array.from({ length: count }, () => randomUUID());

    // Determine format
    const outputFormat = format || (count === 1 ? 'string' : 'array');

    if (outputFormat === 'string') {
      return Promise.resolve({
        uuids: uuids.join(', '),
        count: uuids.length,
      });
    }

    return Promise.resolve({
      uuids,
      count: uuids.length,
    });
  },
});

/**
 * Schema for a single plan step
 * Matches the structure used in the plan-act agent
 */
const PlanStepSchema = z.object({
  title: z.string().describe('Brief title for this step'),
  instructions: z.string().describe('Detailed instructions for executing this step'),
  relevantContext: z.string().describe('Context or background information relevant to this step'),
  toolStrategy: z.object({
    toolName: z.string().optional().describe('Name of the tool to use for this step (if any)'),
    reason: z.string().optional().describe('Why this tool is better than internal knowledge'),
    fallbackToInternal: z.boolean().optional().describe('If the tool fails, should we fall back to internal knowledge?')
  }).optional().describe('Strategy for using tools in this step')
});

/**
 * Add Plan Steps tool - allows dynamic addition of plan steps during action phase
 *
 * This tool should ONLY be used when unexpected complexity is discovered during execution
 * that was not anticipated in the original planning phase.
 */
export const addPlanSteps = tool({
  description: 'Add new steps to the execution plan when unexpected complexity is discovered. Only use this when you encounter situations not anticipated in the original plan (e.g., missing prerequisites, authentication requirements, or unexpected data structures requiring additional processing).',
  inputSchema: z.object({
    steps: z.array(PlanStepSchema).describe('Array of new plan steps to add to the execution queue'),
    reason: z.string().describe('Explanation of why these new steps are necessary and what unexpected situation prompted their addition')
  }),
  execute: async ({ steps, reason }) => {
    // This tool's execution is primarily for signaling to the agent framework
    // The actual plan modification happens in the agent's action phase loop
    return Promise.resolve({
      added: steps.length,
      reason,
      steps: steps.map(s => s.title),
      message: `Successfully queued ${steps.length} new plan step(s) for execution`
    });
  },
});

/**
 * Default toolset containing all built-in tools
 */
export const defaultToolset: ToolSet = {
  calculator,
  getCurrentTime,
  generateUUID,
  addPlanSteps,
};

export type DefaultToolset = typeof defaultToolset;

/**
 * Get active tools based on configuration
 *
 * This is the synchronous version that includes MCP tools if they've been pre-initialized.
 * For guaranteed MCP tool inclusion, use getActiveToolsAsync instead.
 *
 * @param enabledTools - Array of tool names to enable. If not provided, all tools are enabled.
 * @param includeMCP - Whether to include MCP tools from cache (default: true)
 * @returns ToolSet containing only the enabled tools
 */
export function getActiveTools(enabledTools?: string[], includeMCP = true): ToolSet {
  // Merge built-in and cached MCP tools
  const allTools: ToolSet = includeMCP
    ? { ...defaultToolset, ...getMCPToolsSync() }
    : defaultToolset;

  if (!enabledTools || enabledTools.length === 0) {
    return allTools;
  }

  const active: ToolSet = {};
  for (const toolName of enabledTools) {
    if (toolName in allTools) {
      active[toolName] = allTools[toolName];
    }
  }

  return active;
}

/**
 * Get list of all available built-in tool names
 */
export function getAvailableToolNames(): string[] {
  return Object.keys(defaultToolset);
}

/**
 * Initialize MCP tools (async)
 * This should be called once at application startup
 */
async function initializeMCPTools(): Promise<ToolSet> {
  // If already cached, return immediately
  if (mcpToolsCache !== null) {
    return mcpToolsCache;
  }

  // If initialization is in progress, wait for it
  if (mcpToolsInitPromise !== null) {
    return mcpToolsInitPromise;
  }

  // Start initialization
  mcpToolsInitPromise = getMCPTools();

  try {
    mcpToolsCache = await mcpToolsInitPromise;
    return mcpToolsCache;
  } catch (error) {
    console.error('[Tools] Failed to initialize MCP tools:', error);
    // Return empty toolset on error to avoid breaking the app
    mcpToolsCache = {};
    return mcpToolsCache;
  } finally {
    mcpToolsInitPromise = null;
  }
}

/**
 * Get MCP tools synchronously from cache
 * Returns empty toolset if MCP tools haven't been initialized yet
 */
function getMCPToolsSync(): ToolSet {
  return mcpToolsCache || {};
}

/**
 * Get active tools including MCP tools (async version)
 * This includes both built-in and MCP tools
 *
 * @param enabledTools - Array of tool names to enable. If not provided, all tools are enabled.
 * @returns ToolSet containing enabled built-in and MCP tools
 */
export async function getActiveToolsAsync(enabledTools?: string[]): Promise<ToolSet> {
  // Initialize MCP tools
  const mcpTools = await initializeMCPTools();

  // Merge built-in and MCP tools
  const allTools: ToolSet = {
    ...defaultToolset,
    ...mcpTools,
  };

  // If no filter is provided, return all tools
  if (!enabledTools || enabledTools.length === 0) {
    return allTools;
  }

  // Filter tools based on enabled list
  const active: ToolSet = {};
  for (const toolName of enabledTools) {
    if (toolName in allTools) {
      active[toolName] = allTools[toolName];
    }
  }

  return active;
}

/**
 * Initialize MCP tools in the background
 * This should be called at application startup to pre-load MCP tools
 */
export function initializeMCPToolsInBackground(): void {
  // Start initialization but don't wait for it
  initializeMCPTools().catch(error => {
    console.error('[Tools] Background MCP initialization failed:', error);
  });
}

// Re-export MCP client utilities for cleanup
export { closeMCPClients, mcpClientManager } from './mcp-client';
