/**
 * Tool merger - combines client-provided and built-in tools
 *
 * Handles merging client tools with server-side built-in tools, respecting
 * tool_choice preferences and handling name conflicts.
 */

import type { ToolSet } from 'ai';
import { createLogger } from '@packages/logger';
import { getActiveTools } from '@packages/tools';
import { convertOpenAITools } from './converter';
import type { OpenAITool, OpenAIToolChoice, ConvertedTool, ToolMetadata } from './types';

const logger = createLogger('agents:tool-merger');

/**
 * Tool merge result with metadata
 */
export interface MergedTools {
  /** Combined toolset for AI SDK */
  toolSet: ToolSet;
  /** Metadata for each tool */
  metadata: Map<string, ToolMetadata>;
  /** List of client tool names */
  clientToolNames: string[];
  /** List of built-in tool names */
  builtinToolNames: string[];
}

/**
 * Options for merging tools
 */
export interface MergeToolsOptions {
  /** Client-provided tools (OpenAI format) */
  clientTools?: OpenAITool[];
  /** Built-in tool names to enable (empty = all disabled, undefined = all enabled) */
  enabledBuiltinTools?: string[];
  /** Tool choice preference */
  toolChoice?: OpenAIToolChoice;
  /** Whether to allow parallel tool calls */
  parallelToolCalls?: boolean;
}

/**
 * Merge client-provided tools with built-in server-side tools
 *
 * Priority:
 * 1. Client-provided tools take precedence over built-in tools with the same name
 * 2. tool_choice filters available tools
 * 3. Built-in tools are filtered by enabledBuiltinTools list
 */
export function mergeTools(options: MergeToolsOptions): MergedTools {
  const {
    clientTools = [],
    enabledBuiltinTools,
    toolChoice,
  } = options;

  logger.debug('Merging tools', {
    clientToolCount: clientTools.length,
    enabledBuiltinTools,
    toolChoice,
  });

  const result: MergedTools = {
    toolSet: {},
    metadata: new Map(),
    clientToolNames: [],
    builtinToolNames: [],
  };

  // Convert client tools
  let convertedClientTools: ConvertedTool[] = [];
  if (clientTools.length > 0) {
    convertedClientTools = convertOpenAITools(clientTools);
    logger.info('Converted client tools', { count: convertedClientTools.length });
  }

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

  // Add client tools (they take precedence)
  for (const converted of convertedClientTools) {
    if (!shouldIncludeTool(converted.name)) {
      logger.debug('Skipping client tool due to tool_choice', { toolName: converted.name });
      continue;
    }

    result.toolSet[converted.name] = converted.tool;
    result.metadata.set(converted.name, converted.metadata);
    result.clientToolNames.push(converted.name);

    logger.debug('Added client tool', { toolName: converted.name });
  }

  // Add built-in tools (skip if client tool with same name exists)
  for (const [toolName, tool] of Object.entries(builtinTools)) {
    if (result.toolSet[toolName]) {
      logger.warn('Skipping built-in tool - name conflict with client tool', { toolName });
      continue;
    }

    if (!shouldIncludeTool(toolName)) {
      logger.debug('Skipping built-in tool due to tool_choice', { toolName });
      continue;
    }

    result.toolSet[toolName] = tool;
    result.metadata.set(toolName, {
      name: toolName,
      executionMode: 'server' as any,
    });
    result.builtinToolNames.push(toolName);

    logger.debug('Added built-in tool', { toolName });
  }

  const totalTools = Object.keys(result.toolSet).length;
  logger.info('Tool merge complete', {
    totalTools,
    clientTools: result.clientToolNames.length,
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
 * Check if any client tools are present in the merged result
 */
export function hasClientTools(merged: MergedTools): boolean {
  return merged.clientToolNames.length > 0;
}

/**
 * Get metadata for a specific tool
 */
export function getToolMetadata(merged: MergedTools, toolName: string): ToolMetadata | undefined {
  return merged.metadata.get(toolName);
}

/**
 * Check if a tool requires client-side execution
 */
export function isClientTool(merged: MergedTools, toolName: string): boolean {
  return merged.clientToolNames.includes(toolName);
}
