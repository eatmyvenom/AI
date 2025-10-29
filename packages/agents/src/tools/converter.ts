/**
 * Tool converter - OpenAI format to AI SDK format
 *
 * Converts OpenAI tool definitions to AI SDK tool definitions for server-side execution.
 */

import { createLogger } from '@packages/logger';
import { tool } from 'ai';

import { convertFunctionParametersToZod, validateJsonSchema } from './schema-converter';
import type { OpenAITool, ConvertedTool, ToolMetadata, ToolCall } from './types';
import { ToolExecutionMode as ExecutionMode } from './types';

const logger = createLogger('agents:tool-converter');

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
 * Convert AI SDK tool call to OpenAI format
 *
 * AI SDK format: { type: 'tool-call', toolCallId: 'x', toolName: 'calc', input: {...} }
 * OpenAI format: { id: 'x', type: 'function', function: { name: 'calc', arguments: '{...}' }}
 */
export function convertAISDKToolCallToOpenAI(toolCall: {
  toolCallId: string;
  toolName: string;
  input: unknown;
}): ToolCall {
  return {
    id: toolCall.toolCallId,
    type: 'function',
    function: {
      name: toolCall.toolName,
      arguments: JSON.stringify(toolCall.input),
    },
  };
}

/**
 * Extract tool calls from AI SDK StepResult array and convert to OpenAI format
 *
 * @param steps - Array of StepResult from AI SDK
 * @returns Array of OpenAI-format tool calls
 */
export function extractToolCallsFromSteps(steps: Array<{ toolCalls?: Array<{
  toolCallId: string;
  toolName: string;
  input: unknown;
}> }>): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const step of steps) {
    if (step.toolCalls && step.toolCalls.length > 0) {
      for (const toolCall of step.toolCalls) {
        toolCalls.push(convertAISDKToolCallToOpenAI(toolCall));
      }
    }
  }

  logger.debug('Extracted tool calls from steps', {
    stepCount: steps.length,
    toolCallCount: toolCalls.length,
  });

  return toolCalls;
}
