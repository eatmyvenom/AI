/**
 * Tool merger - prepares server-side (MCP) tools
 *
 * Handles merging built-in tools while respecting tool_choice preferences.
 */

import { createLogger } from '@packages/logger';
import { getActiveTools } from '@packages/tools';
import type { ToolSet } from 'ai';

import type { OpenAIToolChoice, ToolMetadata } from './types';
import { ToolExecutionMode } from './types';

const logger = createLogger('agents:tool-merger');

/**
 * Tool merge result with metadata
 */
export interface MergedTools {
  /** Combined toolset for AI SDK */
  toolSet: ToolSet;
  /** Metadata for each tool */
  metadata: Map<string, ToolMetadata>;
  /** List of built-in tool names */
  builtinToolNames: string[];
}

/**
 * Options for merging tools
 */
export interface MergeToolsOptions {
  /** Built-in tool names to enable (empty = all disabled, undefined = all enabled) */
  enabledBuiltinTools?: string[];
  /** Tool choice preference */
  toolChoice?: OpenAIToolChoice;
  /** Whether to allow parallel tool calls */
  parallelToolCalls?: boolean;
}

/**
 * Merge server-side built-in tools
 *
 * Priority:
 * 1. tool_choice filters available tools
 * 2. Built-in tools are filtered by enabledBuiltinTools list
 */
export function mergeTools(options: MergeToolsOptions): MergedTools {
  const {
    enabledBuiltinTools,
    toolChoice,
  } = options;

  logger.debug('Merging tools', {
    enabledBuiltinTools,
    toolChoice,
  });

  const result: MergedTools = {
    toolSet: {},
    metadata: new Map(),
    builtinToolNames: [],
  };

  // Get built-in tools (pass enabledBuiltinTools to filter)
  const builtinTools = getActiveTools(enabledBuiltinTools);
  const builtinToolNames = Object.keys(builtinTools);
  logger.info('Built-in tools available', { count: builtinToolNames.length, tools: builtinToolNames });

  // Track which tools to include based on tool_choice
  const shouldIncludeTool = (toolName: string): boolean => {
    if (!toolChoice || toolChoice === 'auto') {
      return true; // Include all tools
    }

    if (toolChoice === 'none') {
      return false; // No tools
    }

    if (toolChoice === 'required') {
      return true; // Include all tools (model must use at least one)
    }

    // Specific tool required
    if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
      return toolName === toolChoice.function.name;
    }

    return true;
  };

  // Add built-in tools (respect tool_choice filters)
  for (const [toolName, tool] of Object.entries(builtinTools)) {
    if (!shouldIncludeTool(toolName)) {
      logger.debug('Skipping built-in tool due to tool_choice', { toolName });
      continue;
    }

    result.toolSet[toolName] = tool;
    result.metadata.set(toolName, {
      name: toolName,
      executionMode: ToolExecutionMode.SERVER,
    });
    result.builtinToolNames.push(toolName);

    logger.debug('Added built-in tool', { toolName });
  }

  const totalTools = Object.keys(result.toolSet).length;
  logger.info('Tool merge complete', {
    totalTools,
    builtinTools: result.builtinToolNames.length,
  });

  // Validate tool_choice if specific tool was requested
  if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
    const requestedTool = toolChoice.function.name;
    if (!result.toolSet[requestedTool]) {
      logger.error('Requested tool not found', { requestedTool, availableTools: Object.keys(result.toolSet) });
      throw new Error(`Tool "${requestedTool}" specified in tool_choice not found in available tools`);
    }
  }

  return result;
}

/**
 * Get metadata for a specific tool
 */
export function getToolMetadata(merged: MergedTools, toolName: string): ToolMetadata | undefined {
  return merged.metadata.get(toolName);
}
