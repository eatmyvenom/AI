/**
 * Tool result processing utilities
 *
 * Handles parsing and validating tool results from conversation messages.
 */

import { createLogger } from '@packages/logger';
import type { ToolCall, ToolResultMessage } from './types';

const logger = createLogger('agents:tool-results');

/**
 * Extract tool calls from an assistant message
 */
export function extractToolCallsFromMessage(message: any): ToolCall[] {
  if (!message || message.role !== 'assistant') {
    return [];
  }

  if (!message.tool_calls || !Array.isArray(message.tool_calls)) {
    return [];
  }

  const toolCalls: ToolCall[] = [];

  for (const toolCall of message.tool_calls) {
    if (toolCall.type === 'function' && toolCall.function) {
      toolCalls.push({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      });
    }
  }

  logger.debug('Extracted tool calls from message', { count: toolCalls.length });
  return toolCalls;
}

/**
 * Extract tool result messages from conversation history
 */
export function extractToolResults(messages: any[]): ToolResultMessage[] {
  const results: ToolResultMessage[] = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      results.push({
        role: 'tool',
        content: message.content,
        tool_call_id: message.tool_call_id,
      });
    }
  }

  logger.debug('Extracted tool results from messages', { count: results.length });
  return results;
}

/**
 * Match tool results with their corresponding tool calls
 */
export interface ToolCallWithResult {
  toolCall: ToolCall;
  result?: ToolResultMessage;
}

export function matchToolCallsWithResults(
  toolCalls: ToolCall[],
  toolResults: ToolResultMessage[]
): ToolCallWithResult[] {
  const resultsMap = new Map<string, ToolResultMessage>();

  for (const result of toolResults) {
    resultsMap.set(result.tool_call_id, result);
  }

  return toolCalls.map((toolCall) => ({
    toolCall,
    result: resultsMap.get(toolCall.id),
  }));
}

/**
 * Check if all tool calls have corresponding results
 */
export function allToolCallsHaveResults(matched: ToolCallWithResult[]): boolean {
  return matched.every((item) => item.result !== undefined);
}

/**
 * Get tool calls that are missing results
 */
export function getMissingResults(matched: ToolCallWithResult[]): ToolCall[] {
  return matched.filter((item) => !item.result).map((item) => item.toolCall);
}

/**
 * Validate that tool result content is valid JSON or string
 */
export function validateToolResultContent(content: string): { valid: boolean; parsed?: any; error?: string } {
  try {
    // Try parsing as JSON first
    const parsed = JSON.parse(content);
    return { valid: true, parsed };
  } catch {
    // If not JSON, treat as plain string
    if (typeof content === 'string' && content.length > 0) {
      return { valid: true, parsed: content };
    }

    return { valid: false, error: 'Tool result content is empty or invalid' };
  }
}

/**
 * Check if a conversation contains any tool-related messages
 */
export function conversationHasToolMessages(messages: any[]): boolean {
  return messages.some((msg) => {
    if (msg.role === 'tool') return true;
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) return true;
    return false;
  });
}

/**
 * Find the last assistant message with tool calls that need results
 */
export function findPendingToolCalls(messages: any[]): ToolCall[] {
  // Go through messages in reverse to find the most recent assistant message with tool calls
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      const toolCalls = extractToolCallsFromMessage(message);

      // Check if we have results for these tool calls in subsequent messages
      const laterMessages = messages.slice(i + 1);
      const results = extractToolResults(laterMessages);
      const matched = matchToolCallsWithResults(toolCalls, results);
      const missing = getMissingResults(matched);

      if (missing.length > 0) {
        logger.info('Found pending tool calls', { count: missing.length, toolCallIds: missing.map((tc) => tc.id) });
        return missing;
      }

      // If all tool calls from this message have results, continue searching backwards
      break;
    }
  }

  return [];
}
