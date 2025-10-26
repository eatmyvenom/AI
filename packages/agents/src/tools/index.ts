/**
 * Tool calling utilities
 *
 * This module provides utilities for OpenAI-compatible tool calling:
 * - Type definitions for OpenAI tool format
 * - JSON Schema to Zod conversion
 * - Tool conversion (OpenAI → AI SDK format)
 * - Tool merging (client + built-in tools)
 * - Tool result processing
 */

// Types
export * from './types';

// Schema conversion
export * from './schema-converter';

// Tool conversion
export * from './converter';

// Tool merging
export * from './merger';

// Tool results
export * from './results';

// Re-export commonly used types for convenience
export type { ToolMetadata } from './types';
