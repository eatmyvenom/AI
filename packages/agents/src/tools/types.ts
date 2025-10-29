/**
 * Tool calling types and interfaces
 *
 * This file defines types for OpenAI-compatible tool calling and our internal tool system.
 */

/**
 * OpenAI Function Parameter JSON Schema
 */
export interface OpenAIFunctionParameters {
  type: 'object';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * JSON Schema property definition (subset we support)
 */
export type JSONSchemaProperty =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'number'; description?: string; minimum?: number; maximum?: number }
  | { type: 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; description?: string; items?: JSONSchemaProperty }
  | { type: 'object'; description?: string; properties?: Record<string, JSONSchemaProperty>; required?: string[] };

/**
 * OpenAI Function Definition
 */
export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: OpenAIFunctionParameters;
  strict?: boolean;
}

/**
 * OpenAI Tool Definition
 */
export interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

/**
 * OpenAI Tool Choice
 */
export type OpenAIToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

/**
 * Tool execution mode
 */
export enum ToolExecutionMode {
  /** Tool executes on server (built-in and MCP tools) */
  SERVER = 'server',
}

/**
 * Tool call from model (OpenAI format)
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Tool result message (OpenAI format)
 */
export interface ToolResultMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
}

/**
 * Assistant message with tool calls (OpenAI format)
 */
export interface AssistantMessageWithToolCalls {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
}

/**
 * Internal tool metadata
 */
export interface ToolMetadata {
  name: string;
  executionMode: ToolExecutionMode;
  originalDefinition?: OpenAITool;
}

/**
 * Tool conversion result
 */
export interface ConvertedTool {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any; // AI SDK Tool type - using any to avoid circular dependency with 'ai' package
  metadata: ToolMetadata;
}

/**
 * Base message type for all conversation messages
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * System message
 */
export interface SystemMessage {
  role: 'system';
  content: string;
}

/**
 * User message
 */
export interface UserMessage {
  role: 'user';
  content: string;
}

/**
 * Assistant message (may include tool calls)
 */
export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
}

/**
 * Tool result message
 */
export interface ToolMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
}

/**
 * Union type for all message types
 */
export type ConversationMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
