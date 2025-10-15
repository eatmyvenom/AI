/**
 * Tool calling types and interfaces
 *
 * This file defines types for OpenAI-compatible tool calling and our internal tool system.
 */

import type { z } from 'zod';

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
  /** Tool executes on server (built-in tools) */
  SERVER = 'server',
  /** Tool execution requires client to execute and send results back */
  CLIENT = 'client',
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
  tool: any; // AI SDK Tool type - using any to avoid circular dependency issues
  metadata: ToolMetadata;
}
