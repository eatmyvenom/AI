/**
 * Tool converter - OpenAI format to AI SDK format
 *
 * Converts OpenAI tool definitions to AI SDK tool definitions with proper execution modes.
 */

import { tool, dynamicTool } from 'ai';
import { createLogger } from '@packages/logger';
import { convertFunctionParametersToZod, validateJsonSchema } from './schema-converter';
import type { OpenAITool, ToolExecutionMode, ConvertedTool, ToolMetadata } from './types';
import { ToolExecutionMode as ExecutionMode } from './types';

const logger = createLogger('agents:tool-converter');

/**
 * Error thrown when tool execution is requested but tool requires client-side execution
 */
export class ClientExecutionRequiredError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly toolCallId: string,
  ) {
    super(`Tool "${toolName}" requires client-side execution. Tool call ID: ${toolCallId}`);
    this.name = 'ClientExecutionRequiredError';
  }
}

/**
 * Convert OpenAI tool to AI SDK tool with client-side execution mode
 *
 * For client-provided tools, the execute function is a placeholder that marks
 * the tool call for client execution.
 */
export function convertClientTool(openAITool: OpenAITool): ConvertedTool {
  const { function: func } = openAITool;

  logger.debug('Converting client tool', { name: func.name });

  // Validate the JSON Schema
  const validation = validateJsonSchema(func.parameters);
  if (!validation.valid) {
    logger.error('Invalid JSON Schema for client tool', {
      name: func.name,
      errors: validation.errors,
    });
    throw new Error(`Invalid JSON Schema for tool "${func.name}": ${validation.errors.join(', ')}`);
  }

  // Convert parameters to Zod schema
  const inputSchema = convertFunctionParametersToZod(func.parameters);

  // Create metadata
  const metadata: ToolMetadata = {
    name: func.name,
    executionMode: ExecutionMode.CLIENT,
    originalDefinition: openAITool,
  };

  // Use dynamicTool for client tools since they don't have execute functions
  // The execute function throws an error to signal client execution is needed
  const convertedTool = dynamicTool({
    description: func.description || `Client-side tool: ${func.name}`,
    inputSchema,
    execute: async (input, { toolCallId }) => {
      // This should never be called in normal flow - the tool call should be
      // intercepted before execution and sent to client
      logger.error('Client tool execute called - this should not happen', {
        toolName: func.name,
        toolCallId,
      });
      throw new ClientExecutionRequiredError(func.name, toolCallId || 'unknown');
    },
  });

  logger.info('Client tool converted successfully', { name: func.name });

  return {
    name: func.name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: convertedTool as any,
    metadata,
  };
}

/**
 * Convert OpenAI tool to AI SDK tool with server-side execution
 *
 * For server-side tools (built-in), the execute function actually performs the action.
 */
export function convertServerTool(
  openAITool: OpenAITool,
  executeFunction: (input: unknown) => Promise<unknown>,
): ConvertedTool {
  const { function: func } = openAITool;

  logger.debug('Converting server tool', { name: func.name });

  // Validate the JSON Schema
  const validation = validateJsonSchema(func.parameters);
  if (!validation.valid) {
    logger.error('Invalid JSON Schema for server tool', {
      name: func.name,
      errors: validation.errors,
    });
    throw new Error(`Invalid JSON Schema for tool "${func.name}": ${validation.errors.join(', ')}`);
  }

  // Convert parameters to Zod schema
  const inputSchema = convertFunctionParametersToZod(func.parameters);

  // Create metadata
  const metadata: ToolMetadata = {
    name: func.name,
    executionMode: ExecutionMode.SERVER,
    originalDefinition: openAITool,
  };

  // Use standard tool for server tools with actual execute function
  const convertedTool = tool({
    description: func.description || `Server-side tool: ${func.name}`,
    inputSchema,
    execute: executeFunction,
  });

  logger.info('Server tool converted successfully', { name: func.name });

  return {
    name: func.name,
    tool: convertedTool,
    metadata,
  };
}

/**
 * Convert array of OpenAI tools to AI SDK tools
 *
 * All tools are assumed to be client-side unless explicitly provided with execute functions.
 */
export function convertOpenAITools(openAITools: OpenAITool[]): ConvertedTool[] {
  logger.info('Converting OpenAI tools', { count: openAITools.length });

  const converted: ConvertedTool[] = [];

  for (const openAITool of openAITools) {
    try {
      // Client-side tools (no execute function)
      const convertedTool = convertClientTool(openAITool);
      converted.push(convertedTool);
    } catch (error) {
      logger.error('Failed to convert tool', {
        toolName: openAITool.function.name,
        error: error instanceof Error ? error.message : String(error),
      });
      // Skip invalid tools rather than failing the entire request
    }
  }

  logger.info('Tool conversion complete', {
    total: openAITools.length,
    converted: converted.length,
    failed: openAITools.length - converted.length,
  });

  return converted;
}

/**
 * Check if a tool requires client-side execution
 */
export function requiresClientExecution(metadata: ToolMetadata): boolean {
  return metadata.executionMode === ExecutionMode.CLIENT;
}
